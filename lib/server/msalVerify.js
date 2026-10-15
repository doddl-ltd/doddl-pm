// Server-side verification of the Microsoft (MSAL) ID token the browser sends
// to /api/db, /api/triage, /api/oauth/approve and the other user-facing API
// routes. The anon Supabase key no longer grants anything (migration 17), so
// this check is what stands between the internet and the PM data.
//
// Verifies: RS256 signature against the tenant's published keys, audience =
// our SPA client id, issuer + tid = the doddl tenant, and expiry.

import crypto from 'crypto'
import { MSAL_CONFIG } from '../msal'
import { getDisplayName } from '../team'

const CLOCK_SKEW_S = 120
const JWKS_TTL_MS = 60 * 60 * 1000

let jwksCache = { at: 0, keys: [] }

async function fetchJwks(fetchImpl = fetch) {
  const url = `https://login.microsoftonline.com/${MSAL_CONFIG.tenantId}/discovery/v2.0/keys`
  const resp = await fetchImpl(url)
  if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`)
  const body = await resp.json()
  return body.keys || []
}

async function getKey(kid, { fetchImpl, jwks } = {}) {
  if (jwks) return jwks.find(k => k.kid === kid) || null
  const fresh = Date.now() - jwksCache.at < JWKS_TTL_MS
  let key = fresh ? jwksCache.keys.find(k => k.kid === kid) : null
  if (!key) {
    // Unknown kid: Microsoft rotates keys, so refresh once before giving up.
    jwksCache = { at: Date.now(), keys: await fetchJwks(fetchImpl) }
    key = jwksCache.keys.find(k => k.kid === kid) || null
  }
  return key
}

function b64urlJson(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

// Returns { email, name, oid } or throws an Error whose .status is 401.
// opts.jwks / opts.now / opts.clientId / opts.tenantId exist for tests.
export async function verifyIdToken(token, opts = {}) {
  const fail = (msg) => { const e = new Error(msg); e.status = 401; throw e }
  if (!token || typeof token !== 'string') fail('Missing bearer token')
  const parts = token.split('.')
  if (parts.length !== 3) fail('Malformed token')

  let header, claims
  try { header = b64urlJson(parts[0]); claims = b64urlJson(parts[1]) } catch { fail('Malformed token') }
  if (header.alg !== 'RS256' || !header.kid) fail('Unsupported token algorithm')

  const jwk = await getKey(header.kid, opts)
  if (!jwk) fail('Unknown signing key')
  const publicKey = crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' })
  const ok = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'))
  if (!ok) fail('Bad token signature')

  const clientId = opts.clientId || MSAL_CONFIG.clientId
  const tenantId = opts.tenantId || MSAL_CONFIG.tenantId
  const now = Math.floor((opts.now || Date.now()) / 1000)
  if (claims.aud !== clientId) fail('Token audience mismatch')
  if (claims.tid !== tenantId) fail('Token tenant mismatch')
  if (claims.iss !== `https://login.microsoftonline.com/${tenantId}/v2.0`) fail('Token issuer mismatch')
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) fail('Token expired')
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > now) fail('Token not yet valid')

  const email = String(claims.preferred_username || claims.email || claims.upn || '').toLowerCase()
  if (!email) fail('Token has no user identity')
  return { email, name: getDisplayName(email) || claims.name || email, oid: claims.oid || null }
}

export function bearerFrom(req) {
  const h = req.headers.authorization
  if (!h || typeof h !== 'string') return null
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

// Convenience for API routes: verifies the caller or sends 401 and returns null.
export async function requireUser(req, res) {
  try {
    return await verifyIdToken(bearerFrom(req))
  } catch (e) {
    res.status(e.status || 401).json({ error: e.message || 'Unauthorised' })
    return null
  }
}
