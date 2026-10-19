// scripts/prod-smoke.mjs — READ-ONLY smoke test of a deployed doddl-pm (safe on production).
//   PM_KEY=<pm-agent-key-claude-agents> BASE=https://doddl-pm.vercel.app node scripts/prod-smoke.mjs
// No writes: GETs, the MCP handshake + read tools, and unauthenticated probes only.
const BASE = process.env.BASE || 'https://doddl-pm.vercel.app'
const KEY = process.env.PM_KEY
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`) }
const get = async (path, auth = true, headers = {}) => {
  const r = await fetch(BASE + path, { headers: { ...(auth && KEY ? { authorization: `Bearer ${KEY}` } : {}), ...headers } })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* html */ }
  return { status: r.status, json, text, headers: r.headers }
}
const mcp = async (body) => {
  const r = await fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => null) }
}

let r = await get('/', false)
check('home page serves', r.status === 200 && r.text.includes('__NEXT_DATA__'))
r = await get('/.well-known/oauth-authorization-server', false)
check('OAuth metadata', r.status === 200 && r.json.issuer === BASE, r.json && r.json.issuer)
r = await get('/.well-known/oauth-protected-resource/api/mcp', false)
check('protected resource metadata', r.status === 200 && r.json.resource === `${BASE}/api/mcp`)
const unauth = await fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
check('MCP challenges unauthenticated callers', unauth.status === 401 && (unauth.headers.get('www-authenticate') || '').includes('resource_metadata='))
r = await get('/api/db/rest/v1/tasks?select=id&limit=1', false)
check('DB proxy refuses without Microsoft sign-in', r.status === 401)
r = await get('/api/triage', false)
check('triage API refuses without sign-in', r.status === 401)
r = await get('/api/audit-log', false)
check('audit log refuses without sign-in', r.status === 401)
const intake = await fetch(`${BASE}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":"smoke"}' })
check('email intake refuses without key', intake.status === 401)

if (KEY) {
  r = await get('/api/agent/projects?people=1')
  check('agent key: projects + people', r.status === 200 && r.json.projects.length > 0, `${r.json?.projects?.length} projects, ${r.json?.people?.length} people`)
  r = await get('/api/agent/tasks?limit=5')
  check('agent key: open tasks', r.status === 200 && typeof r.json.total === 'number', `${r.json?.total} open tasks`)
  r = await get('/api/agent/inbox?status=new')
  check('agent key: inbox readable', r.status === 200, `${r.json?.total} new items`)
  const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prod-smoke', version: '1' } } })
  check('MCP initialize', init.status === 200 && init.json?.result?.serverInfo?.name === 'doddl-pm')
  const list = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  check('MCP tools/list', (list.json?.result?.tools || []).length >= 10, `${(list.json?.result?.tools || []).length} tools`)
  const find = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_projects', arguments: {} } })
  const projects = JSON.parse(find.json?.result?.content?.[0]?.text || '[]')
  check('MCP list_projects returns live data', Array.isArray(projects) && projects.length > 0, `${projects.length} projects`)
}
console.log(failed ? `\n${failed} FAILURE(S)` : '\nALL OK')
process.exit(failed ? 1 : 0)
