import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanRequest, planFor, stepsFor, missingIn, waitingOn, allowedOps, TYPES } from '../lib/pm/requestTypes.js'
import { createRequest, actOnRequest, updateFromHq, suggestFromHq } from '../lib/pm/requests.js'

test('every type has a form ending in Check and send; one-off-only types ignore ongoing', () => {
  for (const k of Object.keys(TYPES)) {
    assert.equal(stepsFor(k, 'one').at(-1)[0], 'Check and send')
    if (TYPES[k].oneOnly) assert.deepEqual(stepsFor(k, 'on'), stepsFor(k, 'one'))
    else assert.ok(stepsFor(k, 'on').some(([n]) => n === 'How it runs'), k)
  }
})

test('cleanRequest: required answers, choices only from the options, optional fields allowed empty', () => {
  assert.throws(() => cleanRequest({ kind: 'report', mode: 'one', fields: {} }), /required/)
  assert.throws(() => cleanRequest({ kind: 'nope' }), /kind must be/)
  assert.throws(() => cleanRequest({ kind: 'report', mode: 'one', fields: { q: 'x', period: 'Forever', for: 'Me' } }), /choose from the options/)
  const r = cleanRequest({ kind: 'report', mode: 'on', fields: { q: 'Margin by channel', lives: 'Hub dashboard tile, Weekly email', for: 'Me', cad: 'Daily', owner: 'Laura', review: 'Quarter', junk: 'x' } })
  assert.equal(r.mode, 'on')
  assert.equal(r.fields.junk, undefined)
  assert.equal(r.fields.alert, undefined)
  assert.equal(cleanRequest({ kind: 'page', mode: 'on', fields: { q: 'Guide', mkt: 'UK', from: 'Menu' } }).mode, 'one')
  assert.equal(missingIn(stepsFor('amazon', 'on')[0], { kind: 'Buy Box', mkt: 'UK' }).length, 0)
  assert.equal(cleanRequest({ kind: 'amazon', mode: 'on', fields: { kind: 'Buy Box', mkt: 'UK', cad: 'Daily', owner: 'HQ', review: 'Quarter' } }).title, 'Amazon: Buy Box')
})

test('planFor writes the running details for ongoing work', () => {
  const p = Object.fromEntries(planFor({ kind: 'campaign', mode: 'on', fields: { budget: '25', cad: 'Live', owner: 'Jon', review: 'Month' } }))
  assert.equal(p.Spend, '£25 a day until stopped')
  assert.equal(p.Owner, 'Jon')
  assert.equal(p['Review every'], 'Month')
  assert.match(Object.fromEntries(planFor({ kind: 'ip', mode: 'one', fields: {} }))['Filing or letters'], /patent attorney/)
})

test('waitingOn and allowedOps follow the stage', () => {
  assert.deepEqual(waitingOn({ stage: 'plan_approval' }), ['Plan to approve', 'warn'])
  assert.deepEqual(waitingOn({ stage: 'running', paused: true }), ['Paused', 'grey'])
  assert.ok(allowedOps({ stage: 'running' }).includes('change_request'))
  assert.ok(!allowedOps({ stage: 'in_progress' }).includes('approve'))
})

function fakeDb() {
  const rows = []
  let n = 0
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  return { rows, from() {
    const q = { f: {}, patch: null, ins: null }
    const match = (r) => Object.entries(q.f).every(([k, v]) => r[k] === v)
    const api = {
      select() { return api }, eq(k, v) { q.f[k] = v; return api }, order() { return api }, limit() { return api },
      insert(r) { q.ins = r; return api }, update(p) { q.patch = p; return api },
      async maybeSingle() { return { data: rows.find(match) || null } },
      async single() {
        if (q.ins) { const r = { id: id(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), paused: false, ...q.ins }; rows.push(r); return { data: r } }
        const r = rows.find(match); Object.assign(r, q.patch); return { data: r }
      },
      then(res) { res({ data: rows.filter(match) }) },
    }
    return api
  } }
}

test('the loop: ask → plan → approve → made → approve → running → change request → retire', async () => {
  const db = fakeDb()
  const jon = { name: 'Jon' }
  let r = await createRequest(db, jon, { kind: 'report', mode: 'on', fields: { q: 'Margin by channel', lives: 'Hub dashboard tile', for: 'Me', cad: 'Daily', owner: 'Laura', review: 'Quarter' } })
  assert.equal(r.stage, 'plan_approval')
  assert.equal(r.owner, 'Laura')
  assert.ok(r.plan.length > 3)
  await assert.rejects(actOnRequest(db, jon, { id: r.id, op: 'park' }), /Add a note/)
  r = await actOnRequest(db, jon, { id: r.id, op: 'approve' })
  assert.equal(r.stage, 'in_progress')
  await assert.rejects(actOnRequest(db, jon, { id: r.id, op: 'approve' }), /not possible/)
  await updateFromHq(db, { updates: [{ id: r.id, op: 'made', output: { summary: 'The tile, on a preview link', link: 'https://example.com/x' } }] })
  r = await actOnRequest(db, jon, { id: r.id, op: 'approve' })
  assert.equal(r.stage, 'running')
  assert.match(r.next_review, /^\d{4}-\d{2}-\d{2}$/)
  const c = await actOnRequest(db, jon, { id: r.id, op: 'change_request', note: 'Add Amazon EU' })
  assert.equal(c.stage, 'asked')
  assert.equal(c.parent_id, r.id)
  r = await actOnRequest(db, jon, { id: r.id, op: 'retire', note: 'Replaced' })
  assert.equal(r.stage, 'closed')
  assert.ok(r.log.length >= 5)
})

test('HQ suggestions wait for a person; accept drafts the plan', async () => {
  const db = fakeDb()
  let s = await suggestFromHq(db, { suggest: { kind: 'campaign', mode: 'one', title: 'Cut the toddler UGC ad set by 20%', why: 'CPA over target 3 weeks', from: 'Monday ads review' } })
  assert.equal(s.stage, 'suggested')
  s = await actOnRequest(db, { name: 'Jon' }, { id: s.id, op: 'accept' })
  assert.equal(s.stage, 'plan_approval')
  const res = await updateFromHq(db, { updates: [{ id: s.id, op: 'results', results: 'x' }] })
  assert.equal(res.results[0].skipped, 'not live')
})
