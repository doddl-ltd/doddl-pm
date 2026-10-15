// /api/db proxy: the browser's supabase-js client talks to PostgREST through
// this route instead of directly with the public anon key (lib/supabase.js).
// Each request must carry a valid Microsoft ID token for the doddl tenant.
//
// What it enforces on top of PostgREST:
//   - table allowlist + per-table methods; no RPC, no other schemas
//   - DELETE on projects / tasks / task_groups becomes a soft delete
//     (archived_at = now); deleting a group moves its tasks to "ungrouped",
//     matching the old ON DELETE SET NULL behaviour
//   - decision_by and comment authors are the signed-in person, not whatever
//     the browser sent
//   - every write is stamped with x-doddl-actor for task_history

const TABLES = {
  tasks:         ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
  projects:      ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
  task_groups:   ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
  comments:      ['GET', 'HEAD', 'POST'],
  notifications: ['GET', 'HEAD', 'POST', 'PATCH'],
  people:        ['GET', 'HEAD'],
  task_links:    ['GET', 'HEAD', 'POST'],
  task_history:  ['GET', 'HEAD'],
  inbox_items:   ['GET', 'HEAD'],
}
const SOFT_DELETE = new Set(['tasks', 'projects', 'task_groups'])
const FORWARD_REQUEST_HEADERS = ['accept', 'content-type', 'prefer', 'range', 'range-unit', 'x-client-info']
const FORWARD_RESPONSE_HEADERS = ['content-type', 'content-range', 'preference-applied', 'location']
const MAX_BODY_BYTES = 1_000_000

export class ProxyError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

// path: array after /api/db, e.g. ['rest', 'v1', 'tasks']
export function routeFor(method, pathParts, headers = {}) {
  const parts = Array.isArray(pathParts) ? pathParts : [pathParts]
  if (parts.length !== 3 || parts[0] !== 'rest' || parts[1] !== 'v1') throw new ProxyError(404, 'Not found')
  const table = parts[2]
  const allowed = TABLES[table]
  if (!allowed) throw new ProxyError(403, `Table "${table}" is not available`)
  if (!allowed.includes(method)) throw new ProxyError(405, `${method} is not allowed on ${table}`)
  for (const h of ['accept-profile', 'content-profile']) {
    if (headers[h] && headers[h] !== 'public') throw new ProxyError(403, 'Only the public schema is available')
  }
  return { table, softDelete: method === 'DELETE' && SOFT_DELETE.has(table) }
}

// Rewrite a JSON write body for the signed-in user. Returns a string.
export function rewriteBody(table, rawBody, user) {
  if (!rawBody || !rawBody.length) return rawBody
  let parsed
  try { parsed = JSON.parse(rawBody.toString('utf8')) } catch { throw new ProxyError(400, 'Body must be JSON') }
  const fix = (row) => {
    if (!row || typeof row !== 'object') return row
    const out = { ...row }
    if (table === 'tasks' && Object.prototype.hasOwnProperty.call(out, 'decision') && out.decision != null) {
      out.decision_by = user.name
    }
    if (table === 'comments') out.author = user.name
    if (table === 'task_links') out.added_by = user.name
    return out
  }
  return JSON.stringify(Array.isArray(parsed) ? parsed.map(fix) : fix(parsed))
}

// True when the query string has at least one row filter (not just select/order/...).
const NON_FILTER_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'])
export function hasRowFilter(query) {
  if (!query) return false
  for (const [k, v] of new URLSearchParams(query)) {
    if (!NON_FILTER_PARAMS.has(k) && v !== '') return true
  }
  return false
}

function pickHeaders(src, names) {
  const out = {}
  for (const n of names) if (src[n] != null) out[n] = Array.isArray(src[n]) ? src[n].join(', ') : String(src[n])
  return out
}

async function readRaw(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new ProxyError(413, 'Body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

// deps: { verifyUser(req) -> {name,email}, supabaseUrl, serviceKey, fetchImpl }
export function createDbProxy(deps) {
  const fetchImpl = deps.fetchImpl || fetch

  async function upstream(method, table, query, headers, body) {
    return fetchImpl(`${deps.supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ''}`, { method, headers, body })
  }

  return async function handler(req, res) {
    try {
      const user = await deps.verifyUser(req)
      const route = routeFor(req.method, req.query.path, req.headers)
      // req.url keeps the browser's PostgREST query string exactly as sent.
      const qIndex = req.url.indexOf('?')
      const query = qIndex === -1 ? '' : req.url.slice(qIndex + 1)
      if ((req.method === 'PATCH' || req.method === 'DELETE') && !hasRowFilter(query)) {
        throw new ProxyError(400, `Refusing an unfiltered ${req.method === 'PATCH' ? 'update' : 'delete'}`)
      }

      const headers = {
        ...pickHeaders(req.headers, FORWARD_REQUEST_HEADERS),
        apikey: deps.serviceKey,
        authorization: `Bearer ${deps.serviceKey}`,
        'x-doddl-actor': user.name,
      }

      let method = req.method
      let body = ['POST', 'PATCH'].includes(method) ? await readRaw(req) : undefined
      if (body) body = rewriteBody(route.table, body, user)

      if (route.softDelete) {
        method = 'PATCH'
        headers['content-type'] = 'application/json'
        headers.prefer = 'return=representation'
        body = JSON.stringify({ archived_at: new Date().toISOString() })
      }

      const up = await upstream(method, route.table, query, headers, body)
      const text = await up.text()

      if (route.softDelete && up.ok && route.table === 'task_groups') {
        // Old behaviour: tasks.group_id ON DELETE SET NULL -> tasks become ungrouped.
        const ids = JSON.parse(text || '[]').map((g) => g.id).filter(Boolean)
        if (ids.length) {
          await upstream('PATCH', 'tasks', `group_id=in.(${ids.join(',')})`, {
            ...headers, prefer: 'return=minimal',
          }, JSON.stringify({ group_id: null }))
        }
      }

      for (const [k, v] of Object.entries(pickHeaders(Object.fromEntries(up.headers.entries()), FORWARD_RESPONSE_HEADERS))) {
        res.setHeader(k, v)
      }
      res.setHeader('Cache-Control', 'no-store')
      // supabase-js treats a soft delete like the delete it asked for.
      if (route.softDelete && up.ok) return res.status(204).end()
      return res.status(up.status).send(text)
    } catch (e) {
      const status = e.status || 500
      if (status >= 500) console.error('db proxy error:', e)
      return res.status(status).json({ message: status >= 500 ? 'Proxy error' : e.message, code: `PROXY_${status}` })
    }
  }
}
