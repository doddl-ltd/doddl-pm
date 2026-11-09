import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stageAfterDecision, postBlocked, personAction, draftEditable, validateB2BVote, sampleOutcome, learnPreview, trackFor, nextChip,
  replyDueAt, hasContactDetails, cleanContact, needsContact, cleanCampaignPatch, submitProblems, definitionArtefact, countryRules,
  cleanDefinition, suggestedName, COUNTRIES,
} from '../lib/b2b.js'
import { validateArtefact, lineIds } from '../lib/artefactTypes.js'
import { validateVote, normaliseLines, deriveOutcome, tally } from '../lib/pm/approvals.js'

// ─── stage transitions ──────────────────────────────────────────────────────

test('definition: approved -> sampling, rejected -> cancelled, sent back / expired -> stays', () => {
  assert.equal(stageAfterDecision('b2b_definition', 'approved', 'define_review'), 'sampling')
  assert.equal(stageAfterDecision('b2b_definition', 'approved_with_edits', 'define_review'), 'sampling')
  assert.equal(stageAfterDecision('b2b_definition', 'rejected', 'define_review'), 'cancelled')
  assert.equal(stageAfterDecision('b2b_definition', 'revision_requested', 'define_review'), null)
  assert.equal(stageAfterDecision('b2b_definition', 'expired', 'define_review'), null)
})

test('sample: approved or partly approved -> finding; rejected / sent back stays at sample_review', () => {
  assert.equal(stageAfterDecision('b2b_sample', 'approved', 'sample_review'), 'finding')
  assert.equal(stageAfterDecision('b2b_sample', 'partially_approved', 'sample_review'), 'finding')
  assert.equal(stageAfterDecision('b2b_sample', 'rejected', 'sample_review'), null)
  assert.equal(stageAfterDecision('b2b_sample', 'revision_requested', 'sample_review'), null)
})

test('sequence approved leaves the stage; go-live approved -> live', () => {
  assert.equal(stageAfterDecision('b2b_sequence', 'approved', 'words_review'), null)
  assert.equal(stageAfterDecision('b2b_golive', 'approved', 'golive_review'), 'live')
  assert.equal(stageAfterDecision('b2b_golive', 'rejected', 'golive_review'), null)
})

test('a late decision never moves a campaign that has moved on (paused, cancelled)', () => {
  assert.equal(stageAfterDecision('b2b_definition', 'approved', 'paused'), null)
  assert.equal(stageAfterDecision('b2b_golive', 'approved', 'cancelled'), null)
  assert.equal(stageAfterDecision('b2b_sample', 'approved', 'define_review'), null)
})

test('agent posts: only from the right stage, never over a waiting card, go-live needs the words approved', () => {
  assert.equal(postBlocked('sample', { stage: 'sampling' }, null), null)
  assert.match(postBlocked('sample', { stage: 'define_review' }, null), /only at sampling/)
  assert.match(postBlocked('sample', { stage: 'sample_review' }, { id: 't1', decision: null }), /already waiting/)
  assert.equal(postBlocked('sample', { stage: 'sample_review' }, { id: 't1', decision: 'revision_requested' }), null)
  assert.equal(postBlocked('sequence', { stage: 'finding' }, null), null)
  assert.match(postBlocked('sequence', { stage: 'words_review' }, { id: 'w', decision: 'approved' }), /already approved/)
  assert.match(postBlocked('golive', { stage: 'words_review' }, null, { decision: null }), /must be approved/)
  assert.equal(postBlocked('golive', { stage: 'words_review' }, null, { decision: 'approved_with_edits' }), null)
  assert.equal(postBlocked('golive', { stage: 'golive_review' }, { id: 'g', decision: 'expired' }, { decision: 'approved' }), null)
})

test('people: pause remembers the stage, resume goes back to it, cancel from anywhere live-ish', () => {
  assert.deepEqual(personAction('pause', { stage: 'live' }), { stage: 'paused', paused_from: 'live' })
  assert.deepEqual(personAction('resume', { stage: 'paused', paused_from: 'finding' }), { stage: 'finding', paused_from: null })
  assert.deepEqual(personAction('cancel', { stage: 'draft' }), { stage: 'cancelled', paused_from: null })
  assert.throws(() => personAction('pause', { stage: 'draft' }), /cannot be paused/)
  assert.throws(() => personAction('resume', { stage: 'live' }), /Only a paused/)
  assert.throws(() => personAction('cancel', { stage: 'done' }), /already done/)
  assert.throws(() => personAction('explode', { stage: 'live' }), /pause, resume or cancel/)
})

test('a draft is editable; so is a definition that was sent back or expired, not one waiting', () => {
  assert.equal(draftEditable({ stage: 'draft' }), true)
  assert.equal(draftEditable({ stage: 'define_review' }, { decision: null }), false)
  assert.equal(draftEditable({ stage: 'define_review' }, { decision: 'revision_requested' }), true)
  assert.equal(draftEditable({ stage: 'define_review' }, { decision: 'expired' }), true)
  assert.equal(draftEditable({ stage: 'sampling' }, { decision: 'approved' }), false)
})

// ─── sample-line validation ─────────────────────────────────────────────────

const SAMPLE = { campaign_id: 'c1', prospects: [{ id: 'hs1', name: 'A' }, { id: 'hs2', name: 'B' }, { id: 'hs3', name: 'C' }] }
const sampleVote = (input) => validateB2BVote('b2b_sample', validateVote(input, lineIds('b2b_sample', SAMPLE)))

test('sample lines: a rejected line needs a reason; reasons ride along as "<id>:reason"', () => {
  assert.throws(() => sampleVote({ outcome: 'approved', lines: { hs1: 'approved', hs2: 'rejected' } }), /Say why for every unticked/)
  const v = sampleVote({ outcome: 'approved', lines: { hs1: 'approved', hs2: 'rejected', 'hs2:reason': 'too_small', hs3: 'approved' } })
  assert.equal(v.vote, 'partially_approved')
  assert.equal(v.lines['hs2:reason'], 'too_small')
})

test('sample lines: reasons only from the list, only on rejected lines; "other" needs a note', () => {
  assert.throws(() => sampleVote({ outcome: 'approved', lines: { hs1: 'rejected', 'hs1:reason': 'ugly' } }), /must be one of too_small/)
  assert.throws(() => sampleVote({ outcome: 'approved', lines: { hs1: 'approved', 'hs1:reason': 'too_small' } }), /only on a rejected line/)
  assert.throws(() => sampleVote({ outcome: 'approved', lines: { hs1: 'approved', hs2: 'rejected', 'hs2:reason': 'other' } }), /needs a few words/)
  const v = sampleVote({ outcome: 'approved', lines: { hs1: 'approved', hs2: 'rejected', 'hs2:reason': 'other', 'hs2:note': 'Closing next month' } })
  assert.equal(v.lines['hs2:note'], 'Closing next month')
})

test('sample lines: unknown ids refused; sending back skips the reason rule', () => {
  assert.throws(() => sampleVote({ outcome: 'approved', lines: { nope: 'approved' } }), /No line "nope"/)
  assert.throws(() => sampleVote({ outcome: 'approved', lines: { 'nope:reason': 'too_small' } }), /No line "nope"/)
  const v = sampleVote({ outcome: 'revision_requested', notes: 'Search again in Leeds', lines: { hs1: 'rejected' } })
  assert.equal(v.vote, 'revision_requested')
})

test('reason sub-keys do not count as lines (outcome, tally)', () => {
  assert.equal(deriveOutcome({ outcome: 'approved', lines: { a: 'approved', 'b:reason': 'too_small', b: 'rejected' } }), 'partially_approved')
  assert.deepEqual(normaliseLines({ a: 'rejected', 'a:reason': 'too_small', 'a:note': 'x' }, ['a']), { a: 'rejected', 'a:reason': 'too_small', 'a:note': 'x' })
  const t = tally({ approvers: ['Jon'] }, [{ voter: 'Jon', vote: 'partially_approved', lines: { a: 'approved', b: 'rejected', 'b:reason': 'wrong_type' }, at: '2026-11-09T10:00:00Z' }])
  assert.equal(t.decision, 'partially_approved')
  assert.equal(t.line_decisions['b:reason'], 'wrong_type')
})

test('sequence edits are { subject?, body? }; reasons are refused on other types', () => {
  const SEQ = { campaign_id: 'c', emails: [{ id: 'e1', subject: 's', body: 'b' }] }
  const ids = lineIds('b2b_sequence', SEQ)
  const ok = validateB2BVote('b2b_sequence', validateVote({ outcome: 'approved', lines: { e1: 'edited', 'e1:edit': { subject: 'New' } } }, ids))
  assert.equal(ok.vote, 'approved_with_edits')
  assert.throws(() => validateB2BVote('b2b_sequence', validateVote({ outcome: 'approved', lines: { e1: 'edited', 'e1:edit': 'just text' } }, ids)), /subject\?, body\?/)
  assert.throws(() => validateB2BVote('b2b_sequence', validateVote({ outcome: 'approved', lines: { e1: 'rejected', 'e1:reason': 'too_small' } }, ids)), /only on sample lines/)
})

test('sampleOutcome: statuses from the lines; untouched lines count as ticked on an approval', () => {
  const out = sampleOutcome(['a', 'b', 'c'], { a: 'approved', b: 'rejected', 'b:reason': 'chain_head_office' }, 'partially_approved')
  assert.deepEqual(out.approved, ['a', 'c'])
  assert.deepEqual(out.rejected, [{ id: 'b', reason: 'chain_head_office', note: null }])
  assert.deepEqual(sampleOutcome(['a'], null, 'revision_requested'), { approved: [], rejected: [] })
})

test('learnPreview: one rule per reason with its count', () => {
  const l = learnPreview({ a: 'rejected', 'a:reason': 'too_small', b: 'rejected', 'b:reason': 'too_small', c: 'rejected', 'c:reason': 'no_meals', d: 'approved' }, 'nursery')
  assert.equal(l.length, 2)
  assert.equal(l[0].count, 2)
  assert.match(l[0].from, /^From 2 nurseries you rejected as “Too small”$/)
  assert.equal(learnPreview({}).length, 0)
})

// ─── track and chips ────────────────────────────────────────────────────────

test('trackFor: 7 steps; words approved shows live as next; paused shows where it stopped', () => {
  const states = (c, t) => trackFor(c, t).map(s => s.state).join(',')
  assert.equal(states({ stage: 'sample_review' }), 'done,done,wait,todo,todo,todo,todo')
  assert.equal(states({ stage: 'words_review' }, { words: { decision: null } }), 'done,done,done,done,wait,wait,todo')
  assert.equal(states({ stage: 'words_review' }, { words: { decision: 'approved' } }), 'done,done,done,done,done,done,now')
  assert.equal(states({ stage: 'paused', paused_from: 'finding' }), 'done,done,done,now,todo,todo,todo')
  assert.equal(trackFor({ stage: 'live' }).length, 7)
})

test('nextChip: replies needing a person beat "Live"', () => {
  assert.equal(nextChip({ stage: 'live' }, { repliesWaiting: 2 }).text, '2 replies need a person')
  assert.equal(nextChip({ stage: 'live' }).text, 'Live')
  assert.equal(nextChip({ stage: 'sample_review', approver: 'Jon' }).text, 'Sample list waiting for Jon')
})

test('replyDueAt: 1 working day, skipping the weekend; owner the same day', () => {
  const fri = new Date('2026-11-13T10:00:00Z') // Friday
  assert.equal(replyDueAt('positive', fri).toISOString().slice(0, 10), '2026-11-16')
  const tueAm = new Date('2026-11-10T10:00:00Z')
  assert.equal(replyDueAt('owner', tueAm).toISOString(), '2026-11-10T13:00:00.000Z')
  assert.equal(replyDueAt('owner', new Date('2026-11-10T16:00:00Z')).toISOString().slice(0, 10), '2026-11-11')
})

// ─── privacy ────────────────────────────────────────────────────────────────

test('contacts: role and type only; e-mails, phones and extra keys refused', () => {
  assert.deepEqual(cleanContact({ role: 'Manager', type: 'named', in_hubspot: true }), { role: 'Manager', type: 'named', in_hubspot: true })
  assert.deepEqual(cleanContact(null), { role: null, type: 'none', in_hubspot: false })
  assert.throws(() => cleanContact({ role: 'Manager', name: 'Sam' }), /only role, type and in_hubspot/)
  assert.throws(() => cleanContact({ role: 'sam@nursery.co.uk' }), /a role like/)
  assert.throws(() => cleanContact({ role: '+44 7700 900123' }), /a role like/)
  assert.throws(() => cleanContact({ type: 'personal' }), /type must be one of/)
  assert.equal(hasContactDetails('Call me on 0161 496 0000'), true)
  assert.equal(hasContactDetails('Write to jon@doddl.com', { allowDoddl: true }), false)
  assert.equal(hasContactDetails('Wants a sample for 3 rooms'), false)
})

test('needsContact: approved / found prospects with no usable contact; samples and rejects never', () => {
  assert.equal(needsContact({ status: 'approved', contact: { type: 'none' } }), true)
  assert.equal(needsContact({ status: 'found', contact: { type: 'named', in_hubspot: false } }), true)
  assert.equal(needsContact({ status: 'found', contact: { type: 'generic', in_hubspot: true } }), false)
  assert.equal(needsContact({ status: 'rejected', contact: { type: 'none' } }), false)
  assert.equal(needsContact({ status: 'sample', contact: { type: 'none' } }), false)
})

// ─── drafts and validators ──────────────────────────────────────────────────

test('cleanCampaignPatch: lenient drafts, strict names', () => {
  const p = cleanCampaignPatch({ goal: { id: 'trial', target: '30 trial packs' }, offers: ['sample', 'trade'], market: { country: 'GB', regions: ['London'] }, volume: '400', people: { replies: 'laura' } }, ['Jon', 'Laura'])
  assert.equal(p.volume, 400)
  assert.equal(p.market.language, 'English')
  assert.equal(p.people.replies, 'Laura')
  assert.throws(() => cleanCampaignPatch({ offers: ['free_money'] }), /offers must be from/)
  assert.throws(() => cleanCampaignPatch({ market: { country: 'XX' } }), /country must be one of/)
  assert.throws(() => cleanCampaignPatch({ people: { replies: 'Bob' } }, ['Jon']), /not a doddl person/)
  assert.throws(() => cleanCampaignPatch({ stage: 'live' }), /Unknown campaign field stage/)
})

test('submitProblems lists what is missing; a full draft becomes a valid b2b_definition', () => {
  assert.ok(submitProblems({}).length >= 8)
  const c = {
    id: '00000000-0000-0000-0000-000000000001', name: 'UK nurseries', definition: cleanDefinition({ line: 'Day nurseries', must: ['Under 2s'] }),
    goal: { id: 'trial', target: '30', by: 'January' }, offers: ['sample'], market: { country: 'GB', regions: [], language: 'English' },
    volume: 400, sample_size: 25, channels: ['email'], people: { replies: 'Laura', calls: 'Jon' },
  }
  assert.deepEqual(submitProblems(c), [])
  assert.deepEqual(submitProblems({ ...c, sample_size: 500 }), ['The sample cannot be bigger than the total'])
  const a = definitionArtefact(c)
  assert.deepEqual(a.country_rules, countryRules('GB'))
  assert.deepEqual(validateArtefact('b2b_definition', a), { valid: true })
})

test('country rules match the contract: Germany never cold e-mail, US postal address, UK companies only', () => {
  assert.match(countryRules('DE').join(' '), /never cold email/)
  assert.match(countryRules('US').join(' '), /postal address/)
  assert.match(countryRules('GB')[0], /Companies and partnerships only/)
  assert.ok(COUNTRIES.FR && COUNTRIES.IE)
})

test('validators: the four b2b types', () => {
  assert.equal(validateArtefact('b2b_definition', { campaign_id: 'c' }).valid, false)
  assert.deepEqual(validateArtefact('b2b_sample', { campaign_id: 'c', prospects: [{ id: 'hs1', name: 'A', contact: { role: 'Manager', type: 'named' }, fit: 80 }] }), { valid: true })
  assert.match(validateArtefact('b2b_sample', { campaign_id: 'c', prospects: [] }).error, /at least 1/)
  assert.match(validateArtefact('b2b_sample', { campaign_id: 'c', prospects: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] }).error, /used twice/)
  assert.match(validateArtefact('b2b_sample', { campaign_id: 'c', prospects: [{ id: 'a', name: 'A', contact: { role: 'Manager', email: 'x@y.com' } }] }).error, /only role, type and in_hubspot/)
  assert.deepEqual(validateArtefact('b2b_sequence', { campaign_id: 'c', emails: [{ id: 'e1', subject: 'Hi', body: 'Hello [first name]' }], flow: [{ id: 'f1', title: 'Email 1', person: false }] }), { valid: true })
  assert.match(validateArtefact('b2b_sequence', { campaign_id: 'c', emails: [{ id: 'e1', subject: 'Hi' }] }).error, /body is required/)
  assert.deepEqual(validateArtefact('b2b_golive', { campaign_id: 'c', total: 120, first_batch: [{ id: 'hs1', name: 'A', contact_role: 'Owner' }] }), { valid: true })
  assert.match(validateArtefact('b2b_golive', { campaign_id: 'c', total: 1, first_batch: [{ id: 'a', name: 'A', contact_role: 'a@b.co' }] }).error, /not contact details/)
  assert.deepEqual(lineIds('b2b_sequence', { emails: [{ id: 'e1' }, { id: 'e2' }] }), ['e1', 'e2'])
  assert.deepEqual(lineIds('b2b_golive', { first_batch: [{ id: 'a' }] }), [])
})

test('suggestedName reads like the board', () => {
  assert.equal(suggestedName('Nurseries and early years', 'trial', 'GB'), 'UK: nurseries and early years, trial orders')
})
