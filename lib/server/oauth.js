// OAuth 2.1 authorisation server for the MCP endpoint, so a Claude connector
// (claude.ai / Desktop / mobile, or Claude Code) can act for a doddl person.
//
// Flow: Claude registers itself (DCR, public client) -> sends the person to
// /oauth/authorize -> they sign in with Microsoft (existing MSAL app) and
// click Allow -> /api/oauth/approve issues a one-time code bound to the PKCE
// challenge -> Claude swaps it at /api/oauth/token for a 1-hour access token
// and a rotating 30-day refresh token.
//
// Requirements followed: claude.com/docs/connectors/building/authentication
// (401 + resource_metadata, S256 PKCE, form-urlencoded token endpoint,
// invalid_grant on bad refresh, refresh-token rotation, Claude callback URL
// and port-agnostic loopback redirects for Claude Code).

import crypto from 'crypto'
import { sha256Hex, newSecret, ACCESS_TOKEN_PREFIX, REFRESH_TOKEN_PREFIX } from './credentials'

export const ACCESS_TTL_S  = 60 * 60
export const REFRESH_TTL_S = 30 * 24 * 60 * 60
export const CODE_TTL_S    = 5 * 60

const HOSTED_CALLBACKS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback']
const LOOPBACK_HOSTS   = ['localhost', '127.0.0.1', '[::1]']

export function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '')
  const host  = req.headers['x-forwarded-host'] || req.headers.host
  const proto = req.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https')
  return `${String(proto).split(',')[0]}://${String(host).split(',')[0]}`
}

export function protectedResourceMetadata(base) {
  return {
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: ['pm'],
    bearer_methods_supported: ['header'],
    resource_name: 'doddl PM',
  }
}

export function authorizationServerMetadata(base) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['pm', 'offline_access'],
  }
}

// Only Claude's hosted callback and loopback redirects may register, so the
// consent page can never be used to send a code to an arbitrary site.
export function isAllowedRedirect(uri) {
  let u
  try { u = new URL(uri) } catch { return false }
  if (HOSTED_CALLBACKS.includes(uri)) return true
  return u.protocol === 'http:' && LOOPBACK_HOSTS.includes(u.hostname) && !u.username && !u.password
}

// Exact match, except loopback redirects ignore the port (RFC 8252 §7.3).
export function redirectMatches(registered, requested) {
  if (!Array.isArray(registered)) return false
  if (registered.includes(requested)) return true
  let r
  try { r = new URL(requested) } catch { return false }
  if (r.protocol !== 'http:' || !LOOPBACK_HOSTS.includes(r.hostname)) return false
  return registered.some((reg) => {
    try {
      const g = new URL(reg)
      return g.protocol === 'http:' && LOOPBACK_HOSTS.includes(g.hostname) && g.hostname === r.hostname && g.pathname === r.pathname
    } catch { return false }
  })
}

export function pkceS256(verifier) {
  return crypto.createHash('sha256').update(String(verifier)).digest('base64url')
}

export function validVerifier(v) {
  return typeof v === 'string' && /^[A-Za-z0-9\-._~]{43,128}$/.test(v)
}

export class OAuthError extends Error {
  constructor(code, description, status = 400) {
    super(description)
    this.code = code
    this.status = status
  }
}

// ─── DCR ────────────────────────────────────────────────────────────────────

export async function registerClient(db, body = {}) {
  const uris = body.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be a non-empty array')
  }
  const bad = uris.filter((u) => !isAllowedRedirect(u))
  if (bad.length) throw new OAuthError('invalid_redirect_uri', `Redirect URI not allowed: ${bad.join(', ')}`)
  if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none') {
    throw new OAuthError('invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none") are supported')
  }
  const client = {
    client_id: `dpc_${crypto.randomBytes(16).toString('hex')}`,
    client_name: String(body.client_name || 'Claude').slice(0, 100),
    redirect_uris: uris,
  }
  const { error } = await db.from('oauth_clients').insert([client])
  if (error) throw new OAuthError('server_error', error.message, 500)
  return {
    ...client,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
}

export async function getClient(db, clientId) {
  if (!clientId || typeof clientId !== 'string') return null
  const { data } = await db.from('oauth_clients').select('client_id, client_name, redirect_uris').eq('client_id', clientId).maybeSingle()
  return data || null
}

// ─── authorise ──────────────────────────────────────────────────────────────

export function validateAuthorizeParams(p, client) {
  if (!client) throw new OAuthError('invalid_client', 'Unknown client. Remove and re-add the connector.')
  if (!redirectMatches(client.redirect_uris, p.redirect_uri)) throw new OAuthError('invalid_request', 'redirect_uri does not match the registered client')
  if (p.response_type !== 'code') throw new OAuthError('unsupported_response_type', 'response_type must be "code"')
  if (p.code_challenge_method !== 'S256' || !p.code_challenge || !/^[A-Za-z0-9\-_]{43}$/.test(p.code_challenge)) {
    throw new OAuthError('invalid_request', 'PKCE S256 code_challenge is required')
  }
}

export async function issueCode(db, user, p) {
  const code = newSecret('dpk_')
  const { error } = await db.from('oauth_codes').insert([{
    code_hash: sha256Hex(code),
    client_id: p.client_id,
    redirect_uri: p.redirect_uri,
    code_challenge: p.code_challenge,
    scope: p.scope || 'pm',
    resource: p.resource || null,
    user_name: user.name,
    user_email: user.email,
    expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
  }])
  if (error) throw new OAuthError('server_error', error.message, 500)
  await db.from('oauth_clients').update({ last_used_at: new Date().toISOString() }).eq('client_id', p.client_id)
  return code
}

// ─── token ──────────────────────────────────────────────────────────────────

async function mintTokens(db, { client_id, user_name, user_email, scope, family_id }) {
  const access = newSecret(ACCESS_TOKEN_PREFIX)
  const refresh = newSecret(REFRESH_TOKEN_PREFIX)
  const now = Date.now()
  const common = { client_id, user_name, user_email, scope: scope || 'pm', family_id }
  const { error } = await db.from('oauth_tokens').insert([
    { ...common, token_hash: sha256Hex(access), kind: 'access', expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString() },
    { ...common, token_hash: sha256Hex(refresh), kind: 'refresh', expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString() },
  ])
  if (error) throw new OAuthError('server_error', error.message, 500)
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: common.scope }
}

export async function exchangeCode(db, b) {
  if (!b.code || !b.client_id || !b.redirect_uri) throw new OAuthError('invalid_request', 'code, client_id and redirect_uri are required')
  if (!validVerifier(b.code_verifier)) throw new OAuthError('invalid_grant', 'code_verifier is missing or malformed')
  // Single use: only the request that flips used_at gets the row back.
  const { data: rows, error } = await db.from('oauth_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code_hash', sha256Hex(b.code)).is('used_at', null)
    .select('client_id, redirect_uri, code_challenge, scope, user_name, user_email, expires_at')
  if (error) throw new OAuthError('server_error', error.message, 500)
  const row = rows && rows[0]
  if (!row) throw new OAuthError('invalid_grant', 'Authorization code is invalid or already used')
  if (new Date(row.expires_at) <= new Date()) throw new OAuthError('invalid_grant', 'Authorization code expired')
  if (row.client_id !== b.client_id || row.redirect_uri !== b.redirect_uri) throw new OAuthError('invalid_grant', 'Code was issued to a different client or redirect_uri')
  if (pkceS256(b.code_verifier) !== row.code_challenge) throw new OAuthError('invalid_grant', 'PKCE verification failed')
  return mintTokens(db, { ...row, client_id: b.client_id, family_id: crypto.randomUUID() })
}

export async function refreshTokens(db, b) {
  if (!b.refresh_token) throw new OAuthError('invalid_request', 'refresh_token is required')
  const hash = sha256Hex(b.refresh_token)
  const { data: row, error } = await db.from('oauth_tokens')
    .select('client_id, family_id, user_name, user_email, scope, expires_at, rotated_at, revoked_at')
    .eq('token_hash', hash).eq('kind', 'refresh').maybeSingle()
  if (error) throw new OAuthError('server_error', error.message, 500)
  if (!row || row.revoked_at) throw new OAuthError('invalid_grant', 'Refresh token is invalid')
  if (b.client_id && b.client_id !== row.client_id) throw new OAuthError('invalid_grant', 'Refresh token was issued to a different client')
  if (row.rotated_at) {
    // A rotated token came back: assume theft and kill the whole family.
    await db.from('oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('family_id', row.family_id).is('revoked_at', null)
    throw new OAuthError('invalid_grant', 'Refresh token was already used')
  }
  if (new Date(row.expires_at) <= new Date()) throw new OAuthError('invalid_grant', 'Refresh token expired')
  const { data: flipped } = await db.from('oauth_tokens')
    .update({ rotated_at: new Date().toISOString() })
    .eq('token_hash', hash).is('rotated_at', null).select('token_hash')
  if (!flipped || !flipped.length) throw new OAuthError('invalid_grant', 'Refresh token was already used')
  return mintTokens(db, row)
}
