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

test('GET forwards the query unchanged with service key and actor', async () => {
  const calls = []
  const res = fakeRes()
  await proxyWith(calls)(fakeReq({ method: 'GET', url: '/api/db/rest/v1/tasks?select=*,projects(name)&order=created_at.asc' }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(calls[0].url, 'https://db.example/rest/v1/tasks?select=*,projects(name)&order=created_at.asc')
  assert.equal(calls[0].headers.authorization, 'Bearer service')
  assert.equal(calls[0].headers['x-doddl-actor'], 'Laura')
})

test('DELETE on tasks becomes a soft delete', async () => {
  const calls = []
  const res = fakeRes()
  await proxyWith(calls, () => '[{"id":"a"}]')(fakeReq({ method: 'DELETE', url: '/api/db/rest/v1/tasks?id=eq.a' }), res)
  assert.equal(res.statusCode, 204)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'PATCH')
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
