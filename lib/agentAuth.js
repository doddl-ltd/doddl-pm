// Auth + rate limit + audit wrapper for the agent API and the MCP endpoint.
//
// Callers authenticate with a bearer credential that identifies them
// (lib/server/credentials.js): a per-agent key or an OAuth access token.
// The old shared AGENT_SERVICE_KEY + self-declared X-Agent-Id is accepted
// only while LEGACY_AGENT_SERVICE_KEY=enabled, and is tagged "legacy:" in
// the audit log so it is easy to see who still uses it.

import { adminClient } from './server/admin'
import { bearerFrom } from './server/msalVerify'
import { resolveBearer, hasScope, constantTimeEqual } from './server/credentials'

const RATE_LIMIT_PER_MINUTE = 60
const RATE_LIMIT_WINDOW_MS  = 60_000
const MAX_AGENT_ID_LEN      = 128

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (fwd && typeof fwd === 'string') return fwd.split(',')[0].trim()
  return req.socket?.remoteAddress || null
}

function pathOnly(reqUrl) {
  if (!reqUrl) return null
  const i = reqUrl.indexOf('?')
  return i === -1 ? reqUrl : reqUrl.slice(0, i)
}

function legacyPrincipal(req, token) {
  if (process.env.LEGACY_AGENT_SERVICE_KEY !== 'enabled') return null
  const expected = process.env.AGENT_SERVICE_KEY
  if (!expected || !constantTimeEqual(token, expected)) return null
  const raw = req.headers['x-agent-id']
  const id = (Array.isArray(raw) ? raw[0] : raw || '').trim()
  if (!id || id.length > MAX_AGENT_ID_LEN) return null
  return {
    kind: 'legacy',
    agent_id: `legacy:${id}`,
    actor: `legacy:${id}`,
    scopes: ['tasks:read', 'tasks:write', 'inbox:write', 'approvals:write'],
    on_behalf_of: null,
  }
}

export async function authenticateAgent(req, db) {
  const token = bearerFrom(req)
  if (!token) return null
  return (await resolveBearer(token, db)) || legacyPrincipal(req, token)
}

async function isUnderRateLimit(db, agent_id) {
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  const { count, error } = await db
    .from('agent_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agent_id)
    .gte('created_at', cutoff)
  if (error) {
    console.error('Rate limit check failed; failing open:', error.message)
    return true
  }
  return (count ?? 0) < RATE_LIMIT_PER_MINUTE
}

// Two-phase audit logging: an in-flight row (status_code = 0) is written
// before the handler runs, so concurrent bursts count each other for rate
// limiting, then finalised once. The append-only trigger (migration 16)
// permits exactly that one update.
async function insertInFlight(db, agent_id, entry) {
  try {
    const { data, error } = await db.from('agent_audit_log').insert([{
      agent_id,
      method:       entry.method,
      path:         entry.path,
      status_code:  0,
      request_body: entry.request_body ?? null,
      ip_address:   entry.ip_address   ?? null,
      user_agent:   entry.user_agent   ?? null,
    }]).select('id').single()
    if (error) { console.error('Pre-audit insert failed:', error.message); return null }
    return data?.id || null
  } catch (e) {
    console.error('Pre-audit insert threw:', e?.message || e)
    return null
  }
}

async function finalizeInFlight(db, id, status_code, response_body) {
  if (!id) return
  try {
    const { error } = await db.from('agent_audit_log')
      .update({ status_code, response_body: response_body ?? null })
      .eq('id', id)
    if (error) console.error('Audit finalize failed:', error.message)
  } catch (e) {
    console.error('Audit finalize threw:', e?.message || e)
  }
}

// Wrap an API handler with auth + scope check + rate limit + audit logging.
// Handler signature: async (req, res, principal) => void
// options.scope       scope the principal must hold (e.g. 'tasks:write')
// options.onUnauthorised(req, res) lets the MCP route answer with its own
//                     401 + WWW-Authenticate challenge.
export function withAgentAuth(handler, options = {}) {
  return async function wrapped(req, res) {
    const auditDb = adminClient('agent-auth')
    const principal = await authenticateAgent(req, auditDb)
    if (!principal) {
      // Unauthenticated requests are intentionally NOT audited — keeps the table clean
      if (options.onUnauthorised) return options.onUnauthorised(req, res)
      return res.status(401).json({ error: 'Missing or invalid credential. Use "Authorization: Bearer <agent key or OAuth token>".' })
    }
    if (options.scope && !hasScope(principal, options.scope)) {
      return res.status(403).json({ error: `This credential lacks the "${options.scope}" scope` })
    }

    const auditId = await insertInFlight(auditDb, principal.agent_id, {
      method:       req.method,
      path:         pathOnly(req.url),
      request_body: req.body || null,
      ip_address:   getClientIp(req),
      user_agent:   req.headers['user-agent'] || null,
    })

    if (!(await isUnderRateLimit(auditDb, principal.agent_id))) {
      const body = { error: 'Rate limit exceeded', limit: RATE_LIMIT_PER_MINUTE, windowSeconds: RATE_LIMIT_WINDOW_MS / 1000 }
      await finalizeInFlight(auditDb, auditId, 429, body)
      return res.status(429).json(body)
    }

    // Capture status/body for the audit log by wrapping res.status/res.json
    let capturedStatus = 200
    let capturedBody   = null
    const origStatus = res.status.bind(res)
    const origJson   = res.json.bind(res)
    res.status = (code) => { capturedStatus = code; return origStatus(code) }
    res.json   = (body) => { capturedBody = body;  return origJson(body) }

    try {
      await handler(req, res, principal)
    } catch (e) {
      console.error('Agent handler threw:', e)
      if (!res.headersSent) {
        capturedStatus = e.status || 500
        capturedBody   = { error: e.expose ? e.message : 'Internal server error' }
        res.status(capturedStatus).json(capturedBody)
      }
    }

    await finalizeInFlight(auditDb, auditId, capturedStatus || res.statusCode, capturedBody)
  }
}
