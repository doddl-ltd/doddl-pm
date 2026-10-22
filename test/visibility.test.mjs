import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withVisibility, visibilityFetch, viewerFor, VISIBILITY_TABLES } from '../lib/server/visibility.js'

test('withVisibility: reads, updates and deletes on rule tables get the filter', () => {
  assert.equal(withVisibility('tasks', 'GET', 'select=*'), 'select=*&pm_visible=is.true')
  assert.equal(withVisibility('tasks', 'GET', ''), 'pm_visible=is.true')
  assert.equal(withVisibility('inbox_items', 'HEAD', 'id=eq.1'), 'id=eq.1&pm_visible=is.true')
  assert.equal(withVisibility('projects', 'PATCH', 'id=eq.1'), 'id=eq.1&pm_visible=is.true')
  assert.equal(withVisibility('tasks', 'POST', ''), '')
  assert.equal(withVisibility('people', 'GET', 'select=name'), 'select=name')
  for (const t of ['projects', 'tasks', 'task_groups', 'comments', 'task_links', 'task_history', 'notifications', 'inbox_items']) assert.ok(VISIBILITY_TABLES.has(t), t)
})

test('visibilityFetch: supabase-js calls get the filter, other URLs do not', async () => {
  const seen = []
  const f = visibilityFetch(async (url, init) => { seen.push({ url, method: init.method }); return new Response('[]') })
  await f('https://db.example/rest/v1/tasks?select=id&id=eq.1', { method: 'GET' })
  await f('https://db.example/rest/v1/tasks', { method: 'POST' })
  await f('https://db.example/rest/v1/people?select=name', { method: 'GET' })
  await f('https://db.example/rest/v1/rpc/backup_before_migration', { method: 'POST' })
  await f('https://db.example/rest/v1/projects?id=eq.1', { method: 'PATCH' })
  assert.equal(seen[0].url, 'https://db.example/rest/v1/tasks?select=id&id=eq.1&pm_visible=is.true')
  assert.equal(seen[1].url, 'https://db.example/rest/v1/tasks')
  assert.equal(seen[2].url, 'https://db.example/rest/v1/people?select=name')
  assert.equal(seen[3].url, 'https://db.example/rest/v1/rpc/backup_before_migration')
  assert.equal(seen[4].url, 'https://db.example/rest/v1/projects?id=eq.1&pm_visible=is.true')
})

test('viewerFor: a signed-in person or a Claude connector acting for one; agent keys see everything', () => {
  assert.equal(viewerFor({ user: { name: 'Laura' } }), 'Laura')
  assert.equal(viewerFor({ principal: { kind: 'oauth', on_behalf_of: 'Cat' } }), 'Cat')
  assert.equal(viewerFor({ principal: { kind: 'agent_key', agent_id: 'claude-agents' } }), null)
  assert.equal(viewerFor({}), null)
})
