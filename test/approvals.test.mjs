import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  voterRole, validateVote, deriveOutcome, tally, pendingVoters, clockStep, dueAt, planSubmission, approversFor,
  expiresAtFor, weeklySpend, londonWallToUtc, londonParts, buildInbox, summaryByPerson, validateRuleChange,
  describeRuleChange, isRuleAdmin, validateAnchor, normaliseLines,
} from '../lib/pm/approvals.js'

const H = 3600_000
const T0 = new Date('2026-11-02T09:00:00Z')
const at = (h) => new Date(T0.getTime() + h * H)
const vote = (voter, v, extra = {}) => ({ voter, vote: v, at: at(1).toISOString(), ...extra })

const RULES = {
  amazon_ads: { area: 'amazon_ads', label: 'Amazon ads', approver: 'Jon', backup: 'Chris', second_approver: null, spend_threshold_weekly: 500, threshold_currency: 'GBP', threshold_also_needs: 'Chris', batch_mode: 'weekly', spend_applies: true, batchable: true },
  app_recipes: { area: 'app_recipes', label: 'App recipes', approver: null, backup: 'Laura', second_approver: 'Jon', batch_mode: 'off', batchable: true },
  email: { area: 'email', label: 'Email (Klaviyo)', approver: 'Laura', backup: 'Jon', second_approver: null, batch_mode: 'off', batchable: true },
  comments_dms: { area: 'comments_dms', label: 'Comments and DMs', approver: 'Laura', backup: 'Cathy', batch_mode: 'daily', reply_by: '17:00:00', batchable: true },
  amazon_listings: { area: 'amazon_listings', label: 'Amazon listings', approver: 'Jon', backup: 'Laura', batch_mode: 'single', batchable: false, note: 'Always single: one product per card.' },
}

// ─── who may vote ───────────────────────────────────────────────────────────

test('voterRole: approver, second approver, escalated backup; pre-v2 approvals stay open to anyone', () => {
  const t = { approvers: ['Laura', 'Jon'], escalated_to: null }
  assert.equal(voterRole(t, 'laura'), 'approver')
  assert.equal(voterRole(t, 'Jon'), 'second')
  assert.equal(voterRole(t, 'Cat'), null)
  assert.equal(voterRole({ ...t, escalated_to: 'Cat' }, 'Cat'), 'backup')
  assert.equal(voterRole({ approvers: null }, 'Anyone'), 'any')
  assert.equal(voterRole({ approvers: [] }, 'Anyone'), 'any')
})

// ─── outcomes ───────────────────────────────────────────────────────────────

test('deriveOutcome: mixed lines are partially_approved; all turned down is rejected; edits upgrade approved', () => {
  assert.equal(deriveOutcome({ outcome: 'approved', lines: { a: 'approved', b: 'rejected' } }), 'partially_approved')
  assert.equal(deriveOutcome({ outcome: 'approved', lines: { a: 'push', b: 'keep' } }), 'partially_approved')
  assert.equal(deriveOutcome({ outcome: 'approved', lines: { a: 'rejected' } }), 'rejected')
  assert.equal(deriveOutcome({ outcome: 'approved', lines: { a: 'approved' } }), 'approved')
  assert.equal(deriveOutcome({ outcome: 'approved', lines: { a: 'edited', 'a:edit': { caption: 'x' } } }), 'approved_with_edits')
  assert.equal(deriveOutcome({ outcome: 'approved', edits: { headline: 'New' } }), 'approved_with_edits')
  assert.equal(deriveOutcome({ outcome: 'partially_approved', lines: { a: 'approved' } }), 'approved')
  assert.equal(deriveOutcome({ outcome: 'rejected', lines: { a: 'approved' } }), 'rejected', 'a whole-card rejection stands')
  assert.equal(deriveOutcome({ outcome: 'revision_requested' }), 'revision_requested')
})

test('validateVote: reasons, notes, edits and line ids are checked; old values behave as before', () => {
  assert.deepEqual(validateVote({ outcome: 'approved' }), { vote: 'approved', notes: null, edits: null, lines: null, reject_reason: null })
  assert.equal(validateVote({ outcome: 'approved', notes: '  ok  ' }).notes, 'ok')
  assert.throws(() => validateVote({ outcome: 'yes' }), /outcome must be one of/)
  assert.throws(() => validateVote({ outcome: 'expired' }), /outcome must be one of/, 'only the clock expires')
  assert.throws(() => validateVote({ outcome: 'rejected' }), /reject_reason/)
  assert.equal(validateVote({ outcome: 'rejected', notes: 'no' }).reject_reason, 'other')
  assert.equal(validateVote({ outcome: 'rejected', reject_reason: 'off_brand' }).reject_reason, 'off_brand')
  assert.throws(() => validateVote({ outcome: 'rejected', reject_reason: 'meh' }), /reject_reason must be one of/)
  assert.throws(() => validateVote({ outcome: 'revision_requested' }), /needs notes/)
  assert.equal(validateVote({ outcome: 'revision_requested', notes: 'Lead with the spoon' }).vote, 'revision_requested')
  assert.throws(() => validateVote({ outcome: 'approved_with_edits' }), /needs edits/)
  assert.equal(validateVote({ outcome: 'approved_with_edits', edits: { scope: 'organic' } }).vote, 'approved_with_edits')
  assert.throws(() => validateVote({ outcome: 'approved', lines: { x: 'approved' } }, ['a']), /No line "x"/)
  assert.throws(() => validateVote({ outcome: 'approved', lines: { a: 'maybe' } }, ['a']), /must be one of/)
  assert.throws(() => validateVote({ outcome: 'approved', edits: 'nope' }), /edits must be an object/)
  const v = validateVote({ outcome: 'approved', lines: { a: 'approved', b: 'rejected', 'a:edit': { caption: 'x' } } }, ['a', 'b'])
  assert.equal(v.vote, 'partially_approved')
  assert.deepEqual(v.lines, { a: 'approved', b: 'rejected', 'a:edit': { caption: 'x' } })
  assert.equal(normaliseLines({}, []), null)
})

// ─── votes ──────────────────────────────────────────────────────────────────

test('tally: one approver decides alone; pre-v2 tasks are decided by the single vote', () => {
  const t = tally({ approvers: ['Jon'] }, [vote('Jon', 'approved', { notes: 'Go' })])
  assert.deepEqual([t.decided, t.decision, t.decision_by, t.decision_notes], [true, 'approved', 'Jon', 'Go'])
  assert.equal(tally({ approvers: null }, [vote('Laura', 'approved')]).decision, 'approved')
  assert.equal(tally({ approvers: null }, []).decided, false)
})

test('tally: two approvers — the decision waits for both; any send-back or rejection decides at once', () => {
  const task = { approvers: ['Laura', 'Jon'] }
  const one = tally(task, [vote('Laura', 'approved')])
  assert.deepEqual([one.decided, one.waiting_on], [false, ['Jon']])
  const both = tally(task, [vote('Laura', 'approved'), vote('Jon', 'approved_with_edits', { edits: { title: 'B' } })])
  assert.deepEqual([both.decided, both.decision, both.decision_by, both.decision_edits], [true, 'approved_with_edits', 'Laura, Jon', { title: 'B' }])
  const back = tally(task, [vote('Laura', 'revision_requested', { notes: 'Too long' })])
  assert.deepEqual([back.decided, back.decision, back.decision_by, back.decision_notes], [true, 'revision_requested', 'Laura', 'Too long'])
  const rej = tally(task, [vote('Laura', 'approved'), vote('Jon', 'rejected', { reject_reason: 'evidence' })])
  assert.deepEqual([rej.decision, rej.reject_reason], ['rejected', 'evidence'])
})

test('tally: the escalated backup answers for the first approver, never twice', () => {
  const task = { approvers: ['Laura', 'Jon'], escalated_to: 'Cat' }
  assert.equal(tally(task, [vote('Cat', 'approved')]).decided, false)
  assert.equal(tally(task, [vote('Cat', 'approved'), vote('Jon', 'approved')]).decided, true)
  // Backup who is also the second approver: one vote fills one slot only.
  const t2 = { approvers: ['Laura', 'Jon'], escalated_to: 'Jon' }
  const r = tally(t2, [vote('Jon', 'approved')])
  assert.deepEqual([r.decided, r.waiting_on], [false, ['Laura']])
})

test('tally: line decisions merge — a line goes ahead only if nobody turned it down', () => {
  const task = { approvers: ['Laura', 'Jon'] }
  const r = tally(task, [
    vote('Laura', 'approved', { lines: { a: 'approved', b: 'approved' } }),
    vote('Jon', 'partially_approved', { lines: { a: 'approved', b: 'rejected', 'a:edit': { caption: 'x' } } }),
  ])
  assert.equal(r.decision, 'partially_approved')
  assert.deepEqual(r.line_decisions, { a: 'approved', b: 'rejected', 'a:edit': { caption: 'x' } })
  assert.equal(r.decision_notes, null)
})

test('pendingVoters: includes the escalated backup alongside the original approver', () => {
  assert.deepEqual(pendingVoters({ approvers: ['Laura'], escalated_to: 'Jon' }, []), ['Laura', 'Jon'])
  assert.deepEqual(pendingVoters({ approvers: ['Laura', 'Jon'] }, [vote('Laura', 'approved')]), ['Jon'])
  assert.deepEqual(pendingVoters({ approvers: null, assigned_to: 'Cat' }, []), ['Cat'])
  assert.deepEqual(pendingVoters({ approvers: ['Jon'] }, [vote('Jon', 'approved')]), [])
})

// ─── submit ─────────────────────────────────────────────────────────────────

test('approversFor / planSubmission: approver from the rules, second approver, spend threshold', () => {
  assert.deepEqual(approversFor(RULES.amazon_ads), ['Jon'])
  assert.deepEqual(approversFor(RULES.amazon_ads, { weekly_spend: 600 }), ['Jon', 'Chris'])
  assert.deepEqual(approversFor(RULES.amazon_ads, { weekly_spend: 500 }), ['Jon'])
  assert.deepEqual(approversFor(RULES.app_recipes), ['Jon'], 'no approver set: the second approver still approves')
  assert.deepEqual(approversFor(RULES.email, { assigned_to: 'Cat' }), ['Cat'])
  const p = planSubmission({ rule: RULES.email, area: 'email', artefact_type: 'email', artefact: {} }, T0)
  assert.deepEqual([p.approval_area, p.approvers, p.assigned_to, p.expires_at], ['email', ['Laura'], 'Laura', at(72).toISOString()])
  const legacy = planSubmission({ assigned_to: 'Jon' }, T0)
  assert.deepEqual([legacy.approval_area, legacy.approvers, legacy.assigned_to, legacy.expires_at], [null, null, 'Jon', at(72).toISOString()])
  assert.throws(() => planSubmission({ rule: { ...RULES.app_recipes, second_approver: null }, area: 'app_recipes' }, T0), /Nobody approves/)
})

test('weeklySpend: positive deltas in the threshold currency', () => {
  const pack = { groups: [{ name: 'Budgets', lines: [
    { id: 'a', weekly_delta: { currency: 'GBP', amount: 300 } },
    { id: 'b', weekly_delta: { currency: 'GBP', amount: -50 } },
    { id: 'c', weekly_delta: { currency: 'USD', amount: 900 } },
    { id: 'd', weekly_delta: { currency: 'GBP', amount: 250 } },
  ] }] }
  assert.equal(weeklySpend('pack', pack, 'GBP'), 550)
  assert.equal(weeklySpend('email', pack, 'GBP'), 0)
  const p = planSubmission({ rule: RULES.amazon_ads, area: 'amazon_ads', artefact_type: 'pack', artefact: pack }, T0)
  assert.deepEqual(p.approvers, ['Jon', 'Chris'])
})

test('expiresAtFor: 72h by default, the reply-by time for daily packs (UK time), or what the agent asked', () => {
  assert.equal(expiresAtFor(null, T0).toISOString(), at(72).toISOString())
  // Mon 2 Nov 09:00 UTC (GMT): reply by 17:00 the same day.
  assert.equal(expiresAtFor(RULES.comments_dms, T0).toISOString(), '2026-11-02T17:00:00.000Z')
  // Submitted after 17:00: tomorrow's 17:00.
  assert.equal(expiresAtFor(RULES.comments_dms, new Date('2026-11-02T18:30:00Z')).toISOString(), '2026-11-03T17:00:00.000Z')
  // British Summer Time: 17:00 UK = 16:00 UTC.
  assert.equal(expiresAtFor(RULES.comments_dms, new Date('2026-07-01T08:00:00Z')).toISOString(), '2026-07-01T16:00:00.000Z')
  assert.equal(expiresAtFor(null, T0, at(10).toISOString()).toISOString(), at(10).toISOString())
  assert.throws(() => expiresAtFor(null, T0, at(-1).toISOString()), /in the future/)
  assert.throws(() => expiresAtFor(null, T0, 'soon'), /ISO/)
})

test('London time helpers', () => {
  assert.equal(londonWallToUtc('2026-11-06', '08:00').toISOString(), '2026-11-06T08:00:00.000Z')
  assert.equal(londonWallToUtc('2026-06-06', '08:00').toISOString(), '2026-06-06T07:00:00.000Z')
  assert.deepEqual(londonParts('2026-06-06T07:30:00Z'), { date: '2026-06-06', hour: 8, minute: 30 })
  assert.deepEqual(londonParts('2026-11-06T23:30:00Z'), { date: '2026-11-06', hour: 23, minute: 30 })
})

// ─── the clock ──────────────────────────────────────────────────────────────

test('clockStep: nothing before 24h, remind at 24h, escalate to the backup at 48h, expire at 72h', () => {
  const t = { created_at: T0.toISOString(), expires_at: at(72).toISOString(), approvers: ['Laura'], reminded_at: null, escalated_at: null }
  const rule = RULES.email
  assert.deepEqual(clockStep(t, rule, at(23)), { expire: false, remind: false, escalate_to: null })
  assert.deepEqual(clockStep(t, rule, at(24)), { expire: false, remind: true, escalate_to: null })
  assert.deepEqual(clockStep({ ...t, reminded_at: at(24).toISOString() }, rule, at(30)), { expire: false, remind: false, escalate_to: null })
  assert.deepEqual(clockStep({ ...t, reminded_at: at(24).toISOString() }, rule, at(48)), { expire: false, remind: false, escalate_to: 'Jon' })
  assert.deepEqual(clockStep(t, rule, at(49)), { expire: false, remind: true, escalate_to: 'Jon' }, 'a missed run catches up')
  assert.deepEqual(clockStep({ ...t, escalated_at: at(48).toISOString(), reminded_at: at(24).toISOString() }, rule, at(60)), { expire: false, remind: false, escalate_to: null })
  assert.equal(clockStep(t, rule, at(72)).expire, true)
})

test('clockStep: no backup or the backup already approves means no escalation; daily packs expire at reply-by', () => {
  const t = { created_at: T0.toISOString(), expires_at: at(72).toISOString(), approvers: ['Jon'] }
  assert.equal(clockStep(t, null, at(50)).escalate_to, null)
  assert.equal(clockStep({ ...t, approvers: ['Laura', 'Jon'] }, RULES.email, at(50)).escalate_to, null)
  const daily = { created_at: T0.toISOString(), expires_at: '2026-11-02T17:00:00Z', approvers: ['Laura'] }
  assert.equal(clockStep(daily, RULES.comments_dms, new Date('2026-11-02T16:59:00Z')).expire, false)
  assert.equal(clockStep(daily, RULES.comments_dms, new Date('2026-11-02T17:00:00Z')).expire, true)
  assert.equal(dueAt(daily).toISOString(), '2026-11-02T17:00:00.000Z', 'due = expiry when that is sooner than 24h')
})

// ─── inbox and summary ──────────────────────────────────────────────────────

test('buildInbox: waiting for me (escalated first), waiting on others, decided, tiles', () => {
  const now = at(30)
  const tasks = [
    { id: '1', title: 'Ads pack', approval_area: 'amazon_ads', approvers: ['Jon'], created_at: at(10).toISOString(), expires_at: at(82).toISOString() },
    { id: '2', title: 'BF email', approval_area: 'email', approvers: ['Laura'], escalated_to: 'Jon', created_at: T0.toISOString(), expires_at: at(72).toISOString() },
    { id: '3', title: 'Recipe', approval_area: 'app_recipes', approvers: ['Laura', 'Jon'], created_at: at(1).toISOString(), expires_at: at(73).toISOString() },
    { id: '4', title: 'Social week', approval_area: 'organic_social', approvers: ['Laura'], created_at: at(2).toISOString(), expires_at: at(74).toISOString() },
    { id: '5', title: 'Banner', approval_area: 'website', approvers: ['Jon'], created_at: T0.toISOString(), decision: 'rejected', decision_at: at(5).toISOString() },
  ]
  const votes = { 3: [vote('Jon', 'approved')] }
  const box = buildInbox(tasks, votes, RULES, 'Jon', now)
  assert.deepEqual(box.mine.map(r => r.id), ['2', '1'])
  assert.equal(box.mine[0].escalated_to_me, true)
  assert.deepEqual(box.others.map(r => r.id).sort(), ['3', '4'])
  assert.deepEqual(box.decided.map(r => r.id), ['5'])
  assert.equal(box.tiles.waiting, 2)
  assert.equal(box.tiles.escalated, 1)
  assert.equal(box.tiles.overdue, 1, 'the email is past its 24h due time')
  assert.equal(box.badge, 2)
  assert.equal(box.mine[1].area_label, 'Amazon ads')
})

test('summaryByPerson: counts per approver, the backup included once escalated', () => {
  const tasks = [
    { id: '1', title: 'A', approvers: ['Jon'], created_at: at(-30).toISOString(), expires_at: at(42).toISOString() },
    { id: '2', title: 'B', approvers: ['Laura'], escalated_to: 'Jon', created_at: at(-50).toISOString(), expires_at: at(22).toISOString() },
    { id: '3', title: 'C', approvers: ['Laura'], created_at: at(-2).toISOString(), expires_at: at(70).toISOString() },
  ]
  const s = summaryByPerson(tasks, {}, T0)
  assert.deepEqual([s.Jon.waiting, s.Jon.overdue, s.Jon.escalated], [2, 2, 1])
  assert.deepEqual([s.Laura.waiting, s.Laura.overdue, s.Laura.due_today], [2, 1, 0])
})

// ─── rules ──────────────────────────────────────────────────────────────────

test('validateRuleChange: only real people, valid modes, only what changes', () => {
  const people = ['Jon', 'Laura', 'Cat', 'Chris', 'Cathy']
  const r = validateRuleChange(RULES.email, { approver: 'laura', backup: 'Cat' }, people)
  assert.deepEqual(r.patch, { backup: 'Cat' })
  assert.deepEqual(r.before, { backup: 'Jon' })
  assert.equal(describeRuleChange('Email (Klaviyo)', r.before, r.after), 'Email (Klaviyo): backup Jon → Cat')
  assert.throws(() => validateRuleChange(RULES.email, { approver: 'Mallory' }, people), /not a doddl person/)
  assert.throws(() => validateRuleChange(RULES.email, { batch_mode: 'hourly' }, people), /batch_mode/)
  assert.throws(() => validateRuleChange(RULES.email, { colour: 'red' }, people), /Unknown rule field/)
  assert.throws(() => validateRuleChange(RULES.amazon_listings, { batch_mode: 'weekly' }, people), /always single/)
  assert.throws(() => validateRuleChange(RULES.email, { spend_threshold_weekly: 100 }, people), /does not move money/)
  assert.throws(() => validateRuleChange(RULES.email, { second_approver: 'Laura' }, people), /someone other/)
  assert.deepEqual(validateRuleChange(RULES.amazon_ads, { spend_threshold_weekly: '750' }, people).patch, { spend_threshold_weekly: 750 })
  assert.deepEqual(validateRuleChange(RULES.comments_dms, { reply_by: '16:30' }, people).patch, { reply_by: '16:30' })
  assert.deepEqual(validateRuleChange(RULES.comments_dms, { reply_by: '17:00' }, people).patch, {})
  assert.deepEqual(validateRuleChange(RULES.app_recipes, { approver: 'Not set', second_approver: 'None' }, people).patch, { second_approver: null })
})

test('isRuleAdmin: Jon or the approval_admin flag', () => {
  assert.equal(isRuleAdmin({ name: 'Jon', approval_admin: true }, 'Jon'), true)
  assert.equal(isRuleAdmin(null, 'Jon'), true)
  assert.equal(isRuleAdmin({ name: 'Laura', approval_admin: false }, 'Laura'), false)
  assert.equal(isRuleAdmin({ name: 'Cat', approval_admin: true }, 'Cat'), true)
})

// ─── comments ───────────────────────────────────────────────────────────────

test('validateAnchor: the four anchor shapes', () => {
  assert.equal(validateAnchor(null), null)
  assert.deepEqual(validateAnchor({ kind: 'time', t: '0:03' }), { kind: 'time', t: '0:03' })
  assert.deepEqual(validateAnchor({ kind: 'point', placement: 'ig_feed', x: 0.2, y: 0.9 }), { kind: 'point', placement: 'ig_feed', x: 0.2, y: 0.9 })
  assert.deepEqual(validateAnchor({ kind: 'field', field: 'Title' }), { kind: 'field', field: 'Title' })
  assert.deepEqual(validateAnchor({ kind: 'line', line_id: 'b3' }), { kind: 'line', line_id: 'b3' })
  assert.throws(() => validateAnchor({ kind: 'point', x: 2, y: 0 }), /between 0 and 1/)
  assert.throws(() => validateAnchor({ kind: 'time', t: 'soon' }), /time anchor/)
  assert.throws(() => validateAnchor({ kind: 'page' }), /anchor.kind/)
})
