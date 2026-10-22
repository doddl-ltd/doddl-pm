import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureVisibility } from '../lib/pm/ops.js'
import { visibleForItem, taskVisibleTo, projectVisibleTo } from '../lib/pm/autoTriage.js'

// people lookup only: db.from('people').select('name').ilike('email', e).maybeSingle()
const PEOPLE = { 'jon@doddl.com': 'Jon', 'laura@doddl.com': 'Laura', 'catherine@doddl.com': 'Cat' }
const fakeDb = {
  from: () => ({
    select: () => ({
      ilike: (_col, email) => ({ maybeSingle: async () => ({ data: PEOPLE[String(email).toLowerCase()] ? { name: PEOPLE[String(email).toLowerCase()] } : null, error: null }) }),
    }),
  }),
}
const agent = { kind: 'agent_key', agent_id: 'doddl-transcribe', actor: 'agent:doddl-transcribe' }

test('capture defaults: meetings are for the people in them, Teams / e-mail for the person who pushed them', async () => {
  assert.deepEqual(await captureVisibility(fakeDb, agent, { source: 'meeting', participants: ['jon@doddl.com', 'Laura@doddl.com'], payload: { organizer_email: 'jon@doddl.com' } }), ['Jon', 'Laura'])
  assert.deepEqual(await captureVisibility(fakeDb, agent, { source: 'email', participants: ['jon@doddl.com', 'laura@doddl.com'], payload: { flagged_by: 'laura@doddl.com' } }), ['Laura'])
  assert.deepEqual(await captureVisibility(fakeDb, agent, { source: 'teams', participants: ['jon@doddl.com', 'catherine@doddl.com'], payload: { captured_by: 'catherine@doddl.com' } }), ['Cat'])
  // Power Automate intake names its person in participants.
  assert.deepEqual(await captureVisibility(fakeDb, agent, { source: 'email', participants: ['jon@doddl.com'], payload: {} }), ['Jon'])
  // A person's Claude chat: only them. Agents: everyone (tasks follow their project).
  assert.deepEqual(await captureVisibility(fakeDb, { kind: 'oauth', on_behalf_of: 'Laura' }, { source: 'agent', payload: {} }), ['Laura'])
  assert.equal(await captureVisibility(fakeDb, agent, { source: 'agent', payload: {} }), null)
  // Nobody we know: empty list = only whoever a task is assigned to.
  assert.deepEqual(await captureVisibility(fakeDb, agent, { source: 'teams', payload: { captured_by: 'someone@else.com' } }), [])
})

test('rules mirror the database: owner and members see a private project, the assignee always sees their task', () => {
  const priv = { id: 'p1', is_private: true, owner: 'Jon', members: ['Laura'] }
  assert.equal(projectVisibleTo(priv, 'jon'), true)
  assert.equal(projectVisibleTo(priv, 'Laura'), true)
  assert.equal(projectVisibleTo(priv, 'Cat'), false)
  assert.equal(projectVisibleTo({ id: 'p2', is_private: false }, 'Cat'), true)
  assert.equal(taskVisibleTo({ assigned_to: 'Cat', visible_to: ['Jon'] }, priv, 'Cat'), true)
  assert.equal(taskVisibleTo({ assigned_to: null, visible_to: ['Jon', 'Laura'] }, null, 'Laura'), true)
  assert.equal(taskVisibleTo({ assigned_to: null, visible_to: ['Jon', 'Laura'] }, null, 'Cat'), false)
})

test('auto-filing only offers Claude what everyone on the item can see', () => {
  const projects = [{ id: 'open', is_private: false }, { id: 'hr', is_private: true, owner: 'Jon', members: [] }]
  const tasks = [
    { id: 't-open', project_id: 'open', visible_to: null },
    { id: 't-hr', project_id: 'hr', visible_to: null },
    { id: 't-meeting', project_id: 'open', visible_to: ['Jon', 'Laura'] },
  ]
  // An agent's item (everyone sees it): nothing restricted.
  let out = visibleForItem({ visible_to: null }, projects, tasks)
  assert.deepEqual(out.projects.map(p => p.id), ['open'])
  assert.deepEqual(out.tasks.map(t => t.id), ['t-open'])
  // Jon's own chat: his private project and his meeting task too.
  out = visibleForItem({ visible_to: ['Jon'] }, projects, tasks)
  assert.deepEqual(out.projects.map(p => p.id), ['open', 'hr'])
  assert.deepEqual(out.tasks.map(t => t.id), ['t-open', 't-hr', 't-meeting'])
  // Laura's chat: the meeting task (she was there), not Jon's private project.
  out = visibleForItem({ visible_to: ['Laura'] }, projects, tasks)
  assert.deepEqual(out.projects.map(p => p.id), ['open'])
  assert.deepEqual(out.tasks.map(t => t.id), ['t-open', 't-meeting'])
})
