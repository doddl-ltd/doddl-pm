import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dueChip, groupMine, rowFlags, canVote, packTotals, lineTally, money, batchText, ruleNote, whoText, trail } from '../lib/approvalsUi.js'

const now = new Date('2026-11-04T09:00:00Z')
const H = 3600_000

test('dueChip: ok, warn under 12h, overdue with reminder, escalated counts to expiry', () => {
  assert.deepEqual(dueChip({ due_at: new Date(now.getTime() + 20 * H).toISOString() }, now), { text: 'Due in 20h', tone: 'ok' })
  assert.deepEqual(dueChip({ due_at: new Date(now.getTime() + 8 * H).toISOString() }, now), { text: 'Due in 8h', tone: 'warn' })
  assert.deepEqual(dueChip({ due_at: new Date(now.getTime() - 23 * H).toISOString(), overdue: true, reminded_at: 'x' }, now), { text: 'Overdue 23h · reminded', tone: 'bad' })
  assert.deepEqual(dueChip({ due_at: 'x', escalated_to: 'Jon', expires_at: new Date(now.getTime() + 23 * H).toISOString() }, now), { text: 'Expires in 23h', tone: 'bad' })
  assert.equal(dueChip({ decision: 'approved' }, now), null)
})

test('groupMine: escalated first, areas in rule order, other last, oldest first', () => {
  const rules = [{ area: 'amazon_ads', label: 'Amazon ads' }, { area: 'website', label: 'Website' }]
  const rows = [
    { id: 'w2', approval_area: 'website', created_at: '2026-11-04T08:00:00Z' },
    { id: 'old', approval_area: null, created_at: '2026-11-01T08:00:00Z' },
    { id: 'w1', approval_area: 'website', created_at: '2026-11-03T08:00:00Z' },
    { id: 'a1', approval_area: 'amazon_ads', created_at: '2026-11-04T07:00:00Z' },
    { id: 'e1', approval_area: 'email', escalated_to_me: true, created_at: '2026-11-02T07:00:00Z' },
  ]
  const g = groupMine(rows, rules)
  assert.deepEqual(g.map(x => x.area), ['Escalated to you', 'Amazon ads', 'Website', 'Other approvals'])
  assert.deepEqual(g[2].items.map(r => r.id), ['w1', 'w2'])
})

test('rowFlags: pack, preview, two approvers, escalated', () => {
  assert.deepEqual(rowFlags({ artefact_type: 'pack' }), ['Pack'])
  assert.deepEqual(rowFlags({ artefact_type: 'email', escalated_to_me: true, approvers: ['Laura'] }), ['Was Laura’s', 'Preview'])
  assert.deepEqual(rowFlags({ artefact_type: 'copy', approvers: ['Laura', 'Jon'], votes: [{ voter: 'Laura', vote: 'approved' }] }), ['Preview', '1 of 2 approved'])
})

test('canVote: approvers, escalated backup, pre-v2 anyone, already voted, decided', () => {
  const base = { task_type: 'approval', approvers: ['Laura', 'Jon'], votes: [] }
  assert.equal(canVote(base, 'jon'), true)
  assert.equal(canVote(base, 'Cat'), false)
  assert.equal(canVote({ ...base, escalated_to: 'Cat' }, 'Cat'), true)
  assert.equal(canVote({ ...base, votes: [{ voter: 'Jon' }] }, 'Jon'), false)
  assert.equal(canVote({ task_type: 'approval', approvers: null }, 'Anyone'), true)
  assert.equal(canVote({ ...base, decision: 'approved' }, 'Jon'), false)
})

test('packTotals and lineTally follow the ticks', () => {
  const a = { groups: [{ name: 'B', lines: [
    { id: 'b1', weekly_delta: { currency: 'GBP', amount: 42 } },
    { id: 'b2', weekly_delta: { currency: 'USD', amount: 35 } },
    { id: 'b3', weekly_delta: { currency: 'GBP', amount: -42 } },
  ] }] }
  assert.deepEqual(packTotals(a, { b1: 'approved', b2: 'approved', b3: 'approved' }), { GBP: 0, USD: 35 })
  assert.deepEqual(packTotals(a, { b1: 'approved', b2: 'rejected', b3: 'rejected' }), { GBP: 42 })
  assert.deepEqual(lineTally({ b1: 'approved', b2: 'rejected', b3: 'edited', 'b3:edit': '£5' }), { yes: 2, no: 1 })
  assert.equal(money(-42, 'GBP'), '−£42')
  assert.equal(money(35.5, 'USD'), '+$35.50')
})

test('rule text', () => {
  assert.equal(batchText({ batch_mode: 'daily', reply_by: '17:00:00' }), 'Daily, reply by 17:00')
  assert.equal(batchText({ batch_mode: 'weekly', batch_day: 'wed' }), 'Weekly, Wed')
  assert.equal(ruleNote({ approver: 'Jon', backup: 'Chris', batch_mode: 'weekly' }), 'Jon · backup Chris · weekly pack')
  assert.equal(whoText(['Laura', 'Jon'], 'jon'), 'Laura, you')
})

test('trail orders the clock and votes', () => {
  const t = trail({ agent_id: 'a', created_at: '2026-11-01T00:00:00Z', reminded_at: '2026-11-02T00:00:00Z', votes: [{ voter: 'Jon', vote: 'approved', at: '2026-11-03T00:00:00Z' }] })
  assert.deepEqual(t.map(x => x.text), ['a raised it', 'Reminder sent (24 hours)', 'Jon: approved'])
})
