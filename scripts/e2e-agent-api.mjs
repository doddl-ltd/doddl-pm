// scripts/e2e-agent-api.mjs — end-to-end checks of the agent REST API, MCP and
// OAuth endpoints against a running deployment backed by the STAGING database.
// Creates a few "[e2e test]" rows there. Refuses production.
//
//   PM_KEY=<pm-agent-key-claude-agents from Key Vault> \
//   BASE=https://doddl-pm-git-staging-d0ddls-projects.vercel.app node scripts/e2e-agent-api.mjs
const BASE = process.env.BASE || 'http://localhost:3000'
if (/doddl-pm\.vercel\.app/.test(BASE)) throw new Error('e2e writes test rows: run against staging or local only')
const KEY = process.env.PM_KEY
if (!KEY) throw new Error('PM_KEY not set')
const results = []
const check = (name, ok, detail = '') => { results.push({ ok, name, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`) }

async function call(method, path, { body, auth = true, headers = {}, form } = {}) {
  const h = { ...headers }
  if (auth) h.authorization = `Bearer ${KEY}`
  let payload
  if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString() }
  else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body) }
  const r = await fetch(BASE + path, { method, headers: h, body: payload })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: r.status, json, text, headers: r.headers }
}

const stamp = Date.now()

// ── auth basics
let r = await call('GET', '/api/agent/projects', { auth: false })
check('agent API rejects missing credential', r.status === 401)
r = await call('GET', '/api/agent/projects', { headers: { authorization: 'Bearer dpm_forged' }, auth: false })
check('agent API rejects forged key', r.status === 401)
r = await call('GET', '/api/agent/projects?people=1')
check('list projects + people', r.status === 200 && r.json.projects.length > 0 && r.json.people.some(p => p.name === 'Laura'), `${r.json?.projects?.length} projects`)
const project = r.json.projects.find(p => p.status === 'active') || r.json.projects[0]

// ── create / idempotency / validation
const ref = `e2e-${stamp}`
r = await call('POST', '/api/agent/tasks', { body: { title: `[e2e test] ${stamp}`, project: project.name, assigned_to: 'claude', external_ref: ref, progress: 20 } })
check('create task', r.status === 201 && r.json.created && r.json.task.status === 'in_progress' && r.json.task.assigned_to === 'Claude', `status=${r.json?.task?.status} assignee=${r.json?.task?.assigned_to}`)
const taskId = r.json?.task?.id
r = await call('POST', '/api/agent/tasks', { body: { title: `[e2e test] duplicate`, project: project.name, external_ref: ref } })
check('create with same external_ref returns existing', r.status === 200 && r.json.created === false && r.json.task.id === taskId)
r = await call('POST', '/api/agent/tasks', { body: { title: 'no project' } })
check('create without project rejected', r.status === 400, r.json?.error)
r = await call('POST', '/api/agent/tasks', { body: { title: 'bad assignee', project: project.name, assigned_to: 'Bob' } })
check('unknown assignee rejected', r.status === 400, r.json?.error)

// ── done needs evidence
r = await call('PATCH', `/api/agent/tasks?id=${taskId}`, { body: { status: 'done' } })
check('done without evidence rejected', r.status === 422, r.json?.error)
r = await call('PATCH', `/api/agent/tasks?id=${taskId}`, { body: { status: 'done', evidence: ['D0DDL/doddl-pm@c6ac006'], note: 'Verified in e2e run' } })
check('done with evidence accepted', r.status === 200 && r.json.status === 'done' && r.json.progress === 100, `status=${r.json?.status} progress=${r.json?.progress}`)
r = await call('POST', '/api/agent/links', { body: { task_id: taskId, url: 'https://doddl-pm.vercel.app', label: 'live app' } })
check('add link', r.status === 201 && r.json.length === 2)
r = await call('GET', `/api/agent/tasks?id=${taskId}`)
const hist = r.json?.recent_history || []
check('task detail has links, note and history with agent actor', r.status === 200 && r.json.links.length === 2 && r.json.recent_comments.length === 1 && hist.some(h => h.actor === 'agent:claude-agents'),
  `links=${r.json?.links?.length} comments=${r.json?.recent_comments?.length} actors=${[...new Set(hist.map(h => h.actor))].join(',')}`)
r = await call('GET', `/api/agent/lookup?task_id=${taskId}`)
check('lookup route exists (briefing compat)', r.status === 200 && r.json.id === taskId)
r = await call('GET', `/api/agent/tasks?q=${encodeURIComponent('[e2e test]')}&include_done=true`)
check('find tasks by text', r.status === 200 && r.json.tasks.some(t => t.id === taskId), `total=${r.json?.total}`)

// ── approvals: decided tasks are immutable, artefact types validated
r = await call('POST', '/api/agent/artefacts', { body: { title: `[e2e test] approval ${stamp}`, project: project.name, artefact_type: 'copy', artefact: { title: 'Stage 3 bundle', description: 'Copy here' } } })
check('submit for approval (new task)', r.status === 200 && r.json.task_type === 'approval', r.json?.error)
r = await call('POST', '/api/agent/artefacts', { body: { task_id: taskId, artefact_type: 'nonsense', artefact: {} } })
check('unknown artefact type rejected', r.status === 400)

// ── inbox
const inboxRef = `e2e-meeting-${stamp}`
r = await call('POST', '/api/agent/inbox', { body: { source: 'meeting', source_ref: inboxRef, title: `[e2e test] weekly sync ${stamp}`, summary: 'Agreed to test the triage flow.', participants: ['jon@doddl.com', 'laura@doddl.com'], proposed_actions: [{ kind: 'create_task', title: '[e2e test] follow-up', owner_email: 'laura@doddl.com', due_date: '2026-10-21' }] } })
check('capture inbox item', r.status === 201 && r.json.created, r.json?.error)
const inboxId = r.json?.id
r = await call('POST', '/api/agent/inbox', { body: { source: 'meeting', source_ref: inboxRef, title: 'dup' } })
check('capture is idempotent on source_ref', r.status === 200 && r.json.created === false && r.json.id === inboxId)
r = await call('GET', '/api/agent/inbox?status=new')
const item = r.json?.items?.find(i => i.id === inboxId)
check('owner_email resolved to person', item && item.proposed_actions[0].assigned_to === 'Laura')
r = await call('PATCH', `/api/agent/inbox?id=${inboxId}`, { body: { decision: 'accept' } })
check('agent key without inbox:triage cannot triage', r.status === 403)

// ── intake + proxy auth
r = await call('POST', '/api/tasks', { auth: false, body: { title: 'x' } })
check('email intake requires key', r.status === 401)
r = await call('GET', '/api/db/rest/v1/tasks?select=id&limit=1', { auth: false })
check('db proxy requires Microsoft token', r.status === 401)
r = await call('GET', '/api/db/rest/v1/tasks?select=id&limit=1', { headers: { authorization: `Bearer ${KEY}` }, auth: false })
check('db proxy rejects agent keys', r.status === 401)
r = await call('GET', '/api/triage', { auth: false })
check('triage API requires Microsoft token', r.status === 401)

// ── MCP
r = await call('POST', '/api/mcp', { auth: false, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, headers: { accept: 'application/json, text/event-stream' } })
const www = r.headers.get('www-authenticate') || ''
check('MCP 401 carries resource_metadata', r.status === 401 && www.includes(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/api/mcp"`), www)
const mcpHeaders = { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }
r = await call('POST', '/api/mcp', { headers: mcpHeaders, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } } })
check('MCP initialize', r.status === 200 && r.json?.result?.serverInfo?.name === 'doddl-pm' && (r.json.result.instructions || '').includes('evidence'), r.text.slice(0, 120))
r = await call('POST', '/api/mcp', { headers: mcpHeaders, body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } })
const tools = (r.json?.result?.tools || []).map(t => t.name)
check('MCP tools/list scoped to key', tools.includes('create_task') && tools.includes('submit_for_approval') && !tools.includes('triage_inbox_item'), tools.join(','))
r = await call('POST', '/api/mcp', { headers: mcpHeaders, body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'find_tasks', arguments: { q: '[e2e test]', include_done: true } } } })
const found = JSON.parse(r.json?.result?.content?.[0]?.text || '{}')
check('MCP find_tasks', r.status === 200 && found.tasks?.some(t => t.id === taskId), `total=${found.total}`)
r = await call('POST', '/api/mcp', { headers: mcpHeaders, body: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'update_task', arguments: { task_id: taskId, status: 'not_started' } } } })
const upd = JSON.parse(r.json?.result?.content?.[0]?.text || '{}')
check('MCP update_task reopens a done task', upd.status === 'not_started' && upd.progress === 0, `status=${upd.status} progress=${upd.progress}`)
r = await call('POST', '/api/mcp', { headers: mcpHeaders, body: { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'create_task', arguments: { title: 'x' } } } })
check('MCP tool errors come back as isError, not a crash', r.status === 200 && r.json?.result?.isError === true, r.json?.result?.content?.[0]?.text)

// ── OAuth discovery / DCR / token
r = await call('GET', '/.well-known/oauth-protected-resource/api/mcp', { auth: false })
check('protected resource metadata', r.status === 200 && r.json.resource === `${BASE}/api/mcp` && r.json.authorization_servers[0] === BASE)
r = await call('GET', '/.well-known/oauth-authorization-server', { auth: false })
check('authorization server metadata', r.status === 200 && r.json.code_challenge_methods_supported?.[0] === 'S256' && r.json.registration_endpoint)
r = await call('POST', '/api/oauth/register', { auth: false, body: { client_name: 'e2e', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] } })
check('DCR registers Claude callback', r.status === 201 && r.json.client_id?.startsWith('dpc_'))
const clientId = r.json?.client_id
r = await call('POST', '/api/oauth/register', { auth: false, body: { client_name: 'evil', redirect_uris: ['https://evil.example/cb'] } })
check('DCR refuses foreign redirect', r.status === 400 && r.json.error === 'invalid_redirect_uri')
r = await call('POST', '/api/oauth/token', { auth: false, form: { grant_type: 'authorization_code', code: 'dpk_nope', client_id: clientId, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' } })
check('token endpoint: bad code -> invalid_grant (form-encoded)', r.status === 400 && r.json.error === 'invalid_grant')
r = await call('POST', '/api/oauth/token', { auth: false, form: { grant_type: 'refresh_token', refresh_token: 'dpr_nope' } })
check('token endpoint: bad refresh -> invalid_grant', r.status === 400 && r.json.error === 'invalid_grant')
r = await call('GET', `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent('https://evil.example/cb')}&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256`, { auth: false })
check('consent page refuses mismatched redirect (no redirect issued)', r.status === 200 && r.text.includes('redirect_uri does not match'))

const failed = results.filter(x => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
console.log(`created on staging: task ${taskId}, inbox ${inboxId}`)
process.exit(failed.length ? 1 : 0)
