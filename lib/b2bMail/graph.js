// Microsoft Graph for B2B outreach mail (docs/b2b-campaigns/OUTREACH-MAIL.md "Mailboxes").
// Delegated OAuth 2.0 (authorization code + PKCE) against the doddl tenant, single-tenant Entra app
// "doddl PM outreach"; scopes offline_access User.Read Mail.Send Mail.ReadWrite. The person signs in AS the trade
// mailbox. Refresh tokens are stored encrypted (crypto.js); access tokens are cached in memory only.
//
// Every message call sends Prefer: IdType="ImmutableId" so a message keeps its id when it moves from Drafts to
// Sent Items (createReply on step 1 needs it).
//
// Env (read, never created here): B2B_MAIL_CLIENT_ID, B2B_MAIL_CLIENT_SECRET, B2B_MAIL_TENANT_ID (falls back to
// NEXT_PUBLIC_AZURE_TENANT_ID), B2B_PUBLIC_BASE_URL.
import { mailError } from './crypto'

export const SCOPES = ['offline_access', 'User.Read', 'Mail.Send', 'Mail.ReadWrite']
const GRAPH = 'https://graph.microsoft.com/v1.0'
const IMMUTABLE = 'IdType="ImmutableId"'

export function mailConfig(env = process.env) {
  const missing = []
  const clientId = env.B2B_MAIL_CLIENT_ID || ''
  const clientSecret = env.B2B_MAIL_CLIENT_SECRET || ''
  const tenant = env.B2B_MAIL_TENANT_ID || env.NEXT_PUBLIC_AZURE_TENANT_ID || ''
  const base = String(env.B2B_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  if (!clientId) missing.push('B2B_MAIL_CLIENT_ID')
  if (!clientSecret) missing.push('B2B_MAIL_CLIENT_SECRET')
  if (!tenant) missing.push('B2B_MAIL_TENANT_ID')
  if (!base) missing.push('B2B_PUBLIC_BASE_URL')
  if (!env.B2B_MAIL_TOKEN_KEY) missing.push('B2B_MAIL_TOKEN_KEY')
  return { clientId, clientSecret, tenant, base, redirectUri: base ? `${base}/api/b2b/mailboxes/callback` : '', missing, ready: !missing.length }
}

export function requireConfig(env = process.env) {
  const c = mailConfig(env)
  if (!c.ready) throw mailError(503, `Outreach mail is not set up yet: ${c.missing.join(', ')} ${c.missing.length === 1 ? 'is' : 'are'} missing in the Vercel environment`)
  return c
}

export function authorizeUrl(cfg, { state, challenge, loginHint } = {}) {
  const q = new URLSearchParams({
    client_id: cfg.clientId, response_type: 'code', redirect_uri: cfg.redirectUri, response_mode: 'query',
    scope: SCOPES.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  })
  if (loginHint) q.set('login_hint', loginHint)
  return `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/authorize?${q}`
}

/** The page a Global Admin opens once to grant consent for the whole tenant. */
export function adminConsentUrl(cfg) {
  if (!cfg.clientId || !cfg.tenant) return null
  const q = new URLSearchParams({ client_id: cfg.clientId, scope: SCOPES.filter(s => s !== 'offline_access').map(s => `https://graph.microsoft.com/${s}`).join(' ') })
  if (cfg.redirectUri) q.set('redirect_uri', cfg.redirectUri)
  return `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/v2.0/adminconsent?${q}`
}

/** Microsoft's "consent needed" errors (AADSTS65001 user/admin consent, AADSTS90094 admin approval required). */
export function needsAdminConsent(err) {
  const s = `${(err && err.code) || ''} ${(err && err.message) || ''} ${(err && err.description) || ''}`
  return /AADSTS(65001|90094|90008)|consent_required|admin_consent/i.test(s)
}

async function tokenCall(cfg, body, fetchImpl) {
  const r = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: SCOPES.join(' '), ...body }).toString(),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const e = mailError(r.status === 400 || r.status === 401 ? 401 : 502, `Microsoft sign-in failed: ${j.error || r.status}${j.error_description ? ` (${String(j.error_description).split('\r\n')[0].slice(0, 200)})` : ''}`)
    e.code = j.error || null
    e.description = j.error_description || ''
    e.reconnect = ['invalid_grant', 'interaction_required', 'unauthorized_client'].includes(j.error)
    throw e
  }
  return { access_token: j.access_token, refresh_token: j.refresh_token || null, expires_in: Number(j.expires_in) || 3600 }
}

export function exchangeCode(cfg, { code, verifier }, fetchImpl = fetch) {
  return tokenCall(cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, code_verifier: verifier }, fetchImpl)
}

export function refreshAccess(cfg, refreshToken, fetchImpl = fetch) {
  return tokenCall(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetchImpl)
}

// In-memory access-token cache: mailbox id -> { token, exp }. Lost on cold start, which only costs a refresh.
const cache = new Map()
export function clearTokenCache(id) { if (id) cache.delete(id); else cache.clear() }

/**
 * A Graph client for one mailbox. getRefresh() returns the decrypted refresh token; onRotate(newRefresh) stores a
 * rotated one. Errors carry .status and .reconnect (401 on refresh -> the mailbox must be reconnected).
 */
export function graphClient({ cfg, mailboxId, getRefresh, onRotate, fetchImpl = fetch, now = () => Date.now() }) {
  async function token() {
    const hit = cache.get(mailboxId)
    if (hit && hit.exp > now() + 60_000) return hit.token
    const t = await refreshAccess(cfg, await getRefresh(), fetchImpl)
    cache.set(mailboxId, { token: t.access_token, exp: now() + t.expires_in * 1000 })
    if (t.refresh_token && onRotate) await onRotate(t.refresh_token)
    return t.access_token
  }
  async function call(method, path, { body, headers = {}, raw = false } = {}) {
    const url = path.startsWith('http') ? path : `${GRAPH}${path}`
    let r = await fetchImpl(url, {
      method, headers: { authorization: `Bearer ${await token()}`, prefer: IMMUTABLE, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (r.status === 401) {
      cache.delete(mailboxId)
      r = await fetchImpl(url, { method, headers: { authorization: `Bearer ${await token()}`, prefer: IMMUTABLE, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
    }
    if (raw) return r
    const text = await r.text()
    const j = text ? (() => { try { return JSON.parse(text) } catch { return { raw: text } } })() : {}
    if (!r.ok) {
      const e = mailError(r.status >= 500 ? 502 : r.status, `Microsoft Graph ${method} ${path.split('?')[0]}: ${r.status} ${(j.error && (j.error.code || j.error.message)) || ''}`.trim())
      e.graphStatus = r.status
      e.reconnect = r.status === 401
      throw e
    }
    return j
  }
  return {
    call,
    me: () => call('GET', '/me?$select=id,mail,userPrincipalName,displayName'),
    /** Draft a new message: { id, internetMessageId, conversationId }. */
    createDraft: ({ to, toName, subject, html }) => call('POST', '/me/messages', {
      body: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to, ...(toName ? { name: toName } : {}) } }] },
    }),
    /** A threaded reply draft on an earlier message (step 2 / 3), body replaced with ours. */
    createReplyDraft: async (firstGraphId, { html }) => {
      const d = await call('POST', `/me/messages/${encodeURIComponent(firstGraphId)}/createReply`, { body: {} })
      await call('PATCH', `/me/messages/${encodeURIComponent(d.id)}`, { body: { body: { contentType: 'HTML', content: html } } })
      return d
    },
    /** A reply draft a person finishes and sends from Outlook ("Draft in Outlook"). */
    createReplyForPerson: async (inboundGraphId, { text }) => {
      const d = await call('POST', `/me/messages/${encodeURIComponent(inboundGraphId)}/createReply`, { body: { comment: text || '' } })
      return { id: d.id, webLink: d.webLink || null }
    },
    getMessage: (id) => call('GET', `/me/messages/${encodeURIComponent(id)}?$select=id,internetMessageId,conversationId,webLink`),
    send: (id) => call('POST', `/me/messages/${encodeURIComponent(id)}/send`),
    /** One page of the Inbox delta: { messages, next, delta }. next = continue this sync, delta = the link for next time. */
    inboxDelta: async (link, { since } = {}) => {
      const first = `/me/mailFolders/inbox/messages/delta?$select=subject,from,receivedDateTime,conversationId,internetMessageId,isRead${since ? `&$filter=receivedDateTime+ge+${encodeURIComponent(since)}` : ''}`
      const j = await call('GET', link || first, { headers: { prefer: `${IMMUTABLE}, odata.maxpagesize=50` } })
      return { messages: (j.value || []).filter(m => !m['@removed']), next: j['@odata.nextLink'] || null, delta: j['@odata.deltaLink'] || null }
    },
    /** Headers and the reply text of one inbound message. */
    inboundDetail: (id) => call('GET', `/me/messages/${encodeURIComponent(id)}?$select=id,subject,from,receivedDateTime,conversationId,internetMessageId,internetMessageHeaders,uniqueBody,body`, {
      headers: { prefer: `${IMMUTABLE}, outlook.body-content-type="text"` },
    }),
  }
}
