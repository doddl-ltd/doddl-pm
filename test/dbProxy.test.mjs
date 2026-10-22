import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { routeFor, rewriteBody, hasRowFilter, createDbProxy } from '../lib/server/dbProxy.js'

const user = { name: 'Laura', email: 'laura@doddl.com' }

test('allowlist: tables, methods, rpc and schemas', () => {
  assert.equal(routeFor('GET', ['rest', 'v1', 'tasks']).table, 'tasks')
  assert.equal(routeFor('DELETE', ['rest', 'v1', 'tasks']).softDelete, true)
  assert.throws(() => routeFor('DELETE', ['rest', 'v1', 'comments']), /not allowed/)
  assert.throws(() => routeFor('GET', ['rest', 'v1', 'agent_keys']), /not available/)
  assert.throws(() => routeFor('GET', ['rest', 'v1', 'api_clean']), /not available/)
  assert.throws(() => routeFor('POST', ['rest', 'v1', 'rpc', 'exec_sql']), /Not found/)
  assert.throws(() => routeFor('GET', ['auth', 'v1', 'users']), /Not found/)
  assert.throws(() => routeFor('GET', ['rest', 'v1', 'tasks'], { 'accept-profile': 'storage' }), /public schema/)
  assert.throws(() => routeFor('PATCH', ['rest', 'v1', 'inbox_items']), /not allowed/)
})

test('bodies: decision_by, comment author and link author are the signed-in person', () => {
  const t = JSON.parse(rewriteBody('tasks', Buffer.from(JSON.stringify({ decision: 'approved', decision_by: 'Jon' })), user))
  assert.equal(t.decision_by, 'Laura')
  const c = JSON.parse(rewriteBody('comments', Buffer.from(JSON.stringify([{ body: 'hi', author: 'Jon' }])), user))
  assert.equal(c[0].author, 'Laura')
  const l = JSON.parse(rewriteBody('task_links', Buffer.from(JSON.stringify({ url: 'x', added_by: 'Jon' })), user))
  assert.equal(l.added_by, 'Laura')
  const plain = JSON.parse(rewriteBody('tasks', Buffer.from(JSON.stringify({ status: 'done' })), user))
  assert.equal(plain.decision_by, undefined)
  assert.throws(() => rewriteBody('tasks', Buffer.from('not json'), user), /JSON/)
})

test('hasRowFilter', () => {
  assert.equal(hasRowFilter('id=eq.1'), true)
  assert.equal(hasRowFilter('select=*&order=created_at.asc'), false)
  assert.equal(hasRowFilter(''), false)
  assert.equal(hasRowFilter('project_id=eq.x&select=id'), true)
})

function fakeReq({ method, url, headers = {}, body }) {
  const r = Readable.from(body ? [Buffer.from(body)] : [])
  const path = url.split('?')[0].replace('/api/db/', '').split('/')
  return Object.assign(r, { method, url, headers: { authorization: 'Bearer t', ...headers }, query: { path } })
}

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined }
  res.status = (c) => { res.statusCode = c; return res }
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v }
  res.send = (b) => { res.body = b; return res }
  res.json = (b) => { res.body = b; return res }
  res.end = () => res
  return res
}

function proxyWith(calls, responder) {
  return createDbProxy({
    verifyUser: async (req) => {
      if (req.headers.authorization !== 'Bearer t') { const e = new Error('nope'); e.status = 401; throw e }
      return user
    },
    supabaseUrl: 'https://db.example',
    serviceKey: 'service',
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init })
      const body = responder ? responder(url, init) : '[]'
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
}

test('GET forwards the query with service key, actor, viewer and the visibility filter', async () => {
  const calls = []
  const res = fakeRes()
  await proxyWith(calls)(fakeReq({ method: 'GET', url: '/api/db/rest/v1/tasks?select=*,projects(name)&order=created_at.asc' }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(calls[0].url, 'https://db.example/rest/v1/tasks?select=*,projects(name)&order=created_at.asc&pm_visible=is.true')
  assert.equal(calls[0].headers.authorization, 'Bearer service')
  assert.equal(calls[0].headers['x-doddl-actor'], 'Laura')
  assert.equal(calls[0].headers['x-doddl-viewer'], 'Laura')
})

test('who sees what: a browser cannot choose the viewer, and tables without rules are unfiltered', async () => {
  const calls = []
  await proxyWith(calls)(fakeReq({ method: 'GET', url: '/api/db/rest/v1/notifications?select=*', headers: { 'x-doddl-viewer': 'Jon' } }), fakeRes())
  assert.equal(calls[0].headers['x-doddl-viewer'], 'Laura')
  assert.match(calls[0].url, /pm_visible=is\.true$/)
  await proxyWith(calls)(fakeReq({ method: 'GET', url: '/api/db/rest/v1/people?select=name' }), fakeRes())
  assert.equal(calls[1].url, 'https://db.example/rest/v1/people?select=name')
  await proxyWith(calls)(fakeReq({ method: 'PATCH', url: '/api/db/rest/v1/tasks?id=eq.a', body: '{"status":"done"}' }), fakeRes())
  assert.equal(calls[2].url, 'https://db.example/rest/v1/tasks?id=eq.a&pm_visible=is.true')
})

test('who sees what: new tasks and comments only where you can see', async () => {
  // The parent lookup returns nothing: the project / task is not visible to Laura.
  let calls = []
  let res = fakeRes()
  await proxyWith(calls, (url) => (url.includes('/projects?') ? '[]' : '[{"id":"t1"}]'))(
    fakeReq({ method: 'POST', url: '/api/db/rest/v1/tasks', body: JSON.stringify({ title: 'x', project_id: 'p-private' }) }), res)
  assert.equal(res.statusCode, 403)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://db.example/rest/v1/projects?select=id&id=in.(p-private)&pm_visible=is.true')
  assert.equal(calls[0].headers['x-doddl-viewer'], 'Laura')

  calls = []
  res = fakeRes()
  await proxyWith(calls, (url) => (url.includes('/tasks?') ? '[]' : '[]'))(
    fakeReq({ method: 'POST', url: '/api/db/rest/v1/comments', body: JSON.stringify({ task_id: 't-hidden', body: 'hi' }) }), res)
  assert.equal(res.statusCode, 403)

  // Visible project: the insert goes through.
  calls = []
  res = fakeRes()
  await proxyWith(calls, (url) => (url.includes('/projects?') ? '[{"id":"p1"}]' : '[{"id":"t1"}]'))(
    fakeReq({ method: 'POST', url: '/api/db/rest/v1/tasks', body: JSON.stringify({ title: 'x', project_id: 'p1' }) }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(calls[1].method, 'POST')
})

test("who sees what: only a project's owner changes who sees it", async () => {
  const owner = (name) => (url, init) => (init.method === 'GET' ? JSON.stringify([{ id: 'p1', owner: name }]) : '[{"id":"p1"}]')
  let calls = []
  let res = fakeRes()
  await proxyWith(calls, owner('Jon'))(fakeReq({ method: 'PATCH', url: '/api/db/rest/v1/projects?id=eq.p1&select=*', body: '{"is_private":true}' }), res)
  assert.equal(res.statusCode, 403)
  assert.equal(calls[0].url, 'https://db.example/rest/v1/projects?id=eq.p1&select=id%2Cowner&pm_visible=is.true')
  calls = []
  res = fakeRes()
  await proxyWith(calls, owner('laura'))(fakeReq({ method: 'PATCH', url: '/api/db/rest/v1/projects?id=eq.p1', body: '{"is_private":true,"members":["Cat"]}' }), res)
  assert.equal(res.statusCode, 200)
  // Other project edits are not the owner's alone.
  calls = []
  res = fakeRes()
  await proxyWith(calls, owner('Jon'))(fakeReq({ method: 'PATCH', url: '/api/db/rest/v1/projects?id=eq.p1', body: '{"due_date":"2026-12-01"}' }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(calls.length, 1)
})

test('a new private project always includes the person creating it', () => {
  const p = JSON.parse(rewriteBody('projects', Buffer.from(JSON.stringify({ name: 'HR', is_private: true, owner: 'Jon', members: ['Cat'] })), user))
  assert.deepEqual(p.members, ['Cat', 'Laura'])
  const mine = JSON.parse(rewriteBody('projects', Buffer.from(JSON.stringify({ name: 'Mine', is_private: true })), user))
  assert.equal(mine.owner, 'Laura')
  assert.deepEqual(mine.members, [])
  const open = JSON.parse(rewriteBody('projects', Buffer.from(JSON.stringify({ name: 'Open' })), user))
  assert.equal(open.members, undefined)
})

test('DELETE on tasks becomes a soft delete of visible rows only', async () => {
  const calls = []
  const res = fakeRes()
  await proxyWith(calls, () => '[{"id":"a"}]')(fakeReq({ method: 'DELETE', url: '/api/db/rest/v1/tasks?id=eq.a' }), res)
  assert.equal(res.statusCode, 204)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'PATCH')
  assert.equal(calls[0].url, 'https://db.example/rest/v1/tasks?id=eq.a&pm_visible=is.true')
  assert.ok(JSON.parse(calls[0].body).archived_at)
})

test('DELETE on a group archives it and ungroups its tasks', async () => {
  const calls = []
  await proxyWith(calls, () => '[{"id":"g1"}]')(fakeReq({ method: 'DELETE', url: '/api/db/rest/v1/task_groups?id=eq.g1' }), fakeRes())
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url, 'https://db.example/rest/v1/tasks?group_id=in.(g1)')
  assert.deepEqual(JSON.parse(calls[1].body), { group_id: null })
})

test('refuses unfiltered updates/deletes and missing auth', async () => {
  const calls = []
  let res = fakeRes()
  await proxyWith(calls)(fakeReq({ method: 'DELETE', url: '/api/db/rest/v1/tasks?select=*' }), res)
  assert.equal(res.statusCode, 400)
  res = fakeRes()
  await proxyWith(calls)(fakeReq({ method: 'PATCH', url: '/api/db/rest/v1/tasks', body: '{"status":"done"}' }), res)
  assert.equal(res.statusCode, 400)
  res = fakeRes()
  await proxyWith(calls)(fakeReq({ method: 'GET', url: '/api/db/rest/v1/tasks', headers: { authorization: 'Bearer forged' } }), res)
  assert.equal(res.statusCode, 401)
  assert.equal(calls.length, 0)
})
