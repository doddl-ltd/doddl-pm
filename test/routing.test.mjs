import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeFor, meetingGroupName, meetingGroupPosition, routedOps } from '../lib/pm/routing.js'

test('meetings, Teams messages and flagged e-mails have fixed homes; chats and agents do not', () => {
  assert.equal(routeFor({ source: 'meeting' }).project, 'Meeting Note Actions')
  assert.equal(routeFor({ source: 'meeting' }).groupPerItem, true)
  assert.equal(routeFor({ source: 'teams' }).project, 'Adhoc Teams / Emails Tasks')
  assert.equal(routeFor({ source: 'email' }).project, 'Adhoc Teams / Emails Tasks')
  assert.equal(routeFor({ source: 'chat' }), null)
  assert.equal(routeFor({ source: 'agent' }), null)
})

test('meeting group name = UK date of the meeting + its calendar title', () => {
  const item = { occurred_at: '2026-10-21T23:30:00Z', title: 'Sage launch and Black Friday', payload: { subject: 'Product & marketing  weekly' } }
  assert.equal(meetingGroupName(item), '22 Oct 2026 · Product & marketing weekly', 'UK date (BST) and tidied title')
  assert.equal(meetingGroupName({ occurred_at: '2026-12-01T10:00:00Z', title: 'Notes title' }), '1 Dec 2026 · Notes title')
  assert.ok(meetingGroupPosition({ occurred_at: '2026-10-22T09:00:00Z' }) < meetingGroupPosition({ occurred_at: '2026-10-21T09:00:00Z' }), 'newer meetings sort first')
})

test('routed actions keep real owners and valid dates only', () => {
  const ops = routedOps({ title: 'Weekly' }, [
    { title: 'Send the spec sheet', assigned_to: 'laura', due_date: '2026-10-24' },
    { title: 'Book the shoot', assigned_to: 'Somebody Else', due_date: 'Friday' },
    { title: '' },
  ], ['Jon', 'Laura'], 'Filed to X')
  assert.deepEqual(ops.map(o => [o.op, o.title, o.assigned_to, o.due_date]), [
    ['create', 'Send the spec sheet', 'Laura', '2026-10-24'],
    ['create', 'Book the shoot', null, null],
    ['create', 'Weekly', null, null],
  ])
  assert.ok(ops.every(o => o.confidence === 1 && o.reason === 'Filed to X'))
})
