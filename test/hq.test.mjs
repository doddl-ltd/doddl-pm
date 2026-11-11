import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanContentItem, groupByKeys, isStuck, weekRange, calendarState, cleanIdea, cleanSnapshot, listingOverall } from '../lib/pm/hq.js'
import { approvalCard, summaryCard, createTeams, approvalLink } from '../lib/server/teams.js'

test('content items: only supplied columns, validated', () => {
  assert.deepEqual(cleanContentItem({ external_ref: ' ad-1 ', stage: 'make' }), { external_ref: 'ad-1', stage: 'make' })
  const full = cleanContentItem({ external_ref: 'ad-1', type: 'ad', title: 'Kit 45+', markets: ['UK'], stage_sla_hours: 48, scheduled_at: '2026-11-09T06:00:00Z', results: { day3: {} } })
  assert.deepEqual(Object.keys(full).sort(), ['external_ref', 'markets', 'results', 'scheduled_at', 'stage_sla_hours', 'title', 'type'])
  assert.throws(() => cleanContentItem({ type: 'ad' }), /external_ref is required/)
  assert.throws(() => cleanContentItem({ external_ref: 'x', type: 'poster' }), /type must be one of/)
  assert.throws(() => cleanContentItem({ external_ref: 'x', stage: 'shipped' }), /stage must be one of/)
  assert.throws(() => cleanContentItem({ external_ref: 'x', approval_task_id: '12' }), /task UUID/)
  assert.throws(() => cleanContentItem({ external_ref: 'x', scheduled_at: 'Monday' }), /ISO date-time/)
  assert.throws(() => cleanContentItem({ external_ref: 'x', markets: 'UK' }), /array of strings/)
})

test('groupByKeys: partial upserts never mix key sets', () => {
  const g = groupByKeys([{ a: 1, b: 2 }, { b: 3, a: 4 }, { a: 5 }])
  assert.equal(g.length, 2)
  assert.equal(g[0].length, 2)
})

test('stuck = longer in a stage than its SLA', () => {
  const now = new Date('2026-11-06T12:00:00Z')
  assert.equal(isStuck({ stage: 'brief', stage_since: '2026-11-04T12:00:00Z', stage_sla_hours: 24 }, now), true)
  assert.equal(isStuck({ stage: 'brief', stage_since: '2026-11-06T00:00:00Z', stage_sla_hours: 24 }, now), false)
  assert.equal(isStuck({ stage: 'brief', stage_since: '2026-11-01T00:00:00Z', stage_sla_hours: null }, now), false)
  assert.equal(isStuck({ stage: 'live', stage_since: '2026-11-01T00:00:00Z', stage_sla_hours: 1 }, now), false)
})

test('calendar: UK week and item state', () => {
  assert.deepEqual(weekRange(new Date('2026-11-06T12:00:00Z')), { from: '2026-11-02', to: '2026-11-08' })
  assert.deepEqual(weekRange(new Date('2026-11-08T23:30:00Z')), { from: '2026-11-02', to: '2026-11-08' })
  assert.equal(calendarState({ stage: 'live' }, null), 'live')
  assert.equal(calendarState({ stage: 'ready' }, { decision: null }), 'waiting')
  assert.equal(calendarState({ stage: 'scheduled' }, { decision: 'approved' }), 'scheduled')
  assert.equal(calendarState({ stage: 'brief' }, null), 'planned')
})

test('ideas: only the text is required', () => {
  assert.deepEqual(cleanIdea({ text: ' Grandparents gift guide ' }), { text: 'Grandparents gift guide' })
  assert.deepEqual(cleanIdea({ text: 'x', channels: ['Email', ' TikTok '], persona: '', measure: 'orders' }), { text: 'x', channels: ['Email', 'TikTok'], measure: 'orders' })
  assert.throws(() => cleanIdea({ persona: 'Gran' }), /text is required/)
  assert.throws(() => cleanIdea({ text: 'x', markets: 'UK' }), /array of strings/)
})

test('listing snapshot: canonical field names, images shape, event kinds', () => {
  const s = cleanSnapshot({
    products: [{ asin: 'b0abc', marketplace: 'UK', product: 'Toddler 3-piece' }],
    fields: [{ asin: 'B0ABC', marketplace: 'UK', field: 'title', live: 'a', should: 'b', status: 'drift' }, { asin: 'B0ABC', marketplace: 'UK', field: 'Images', live: [{ slot: 1, url: 'x' }] }],
    events: [{ asin: 'B0ABC', marketplace: 'UK', kind: 'amazon_change', text: 'Amazon changed the title', at: '2026-11-05T10:00:00Z' }],
  })
  assert.equal(s.products[0].asin, 'B0ABC')
  assert.deepEqual([s.fields[0].field, s.fields[0].position], ['Title', 1])
  assert.equal(s.fields[1].position, 9)
  assert.equal(s.events[0].at, '2026-11-05T10:00:00.000Z')
  assert.throws(() => cleanSnapshot({ fields: [{ asin: 'B0', marketplace: 'UK', field: 'Colour' }] }), /field must be one of/)
  assert.throws(() => cleanSnapshot({ fields: [{ asin: 'B0', marketplace: 'UK', field: 'Images', live: 'x' }] }), /Images/)
  assert.throws(() => cleanSnapshot({ events: [{ asin: 'B0', marketplace: 'UK', kind: 'moved', text: 'x' }] }), /kind must be one of/)
  assert.throws(() => cleanSnapshot({ products: [{ asin: 'B0' }] }), /asin and marketplace/)
  assert.throws(() => cleanSnapshot({}), /empty/)
  // Listing content (28-listing-content): category, variations, every attribute and the A+ documents.
  const c = cleanSnapshot({ products: [{ asin: 'B0X', marketplace: 'UK', category: 'Baby › Cutlery', variations: { theme: 'COLOR', parent_asins: ['B0P'], child_asins: [] },
    attributes: [{ name: 'color', value: 'Pink', source: 'page' }], aplus: [{ ref: 'r1', name: 'Kit', status: 'APPROVED', modules: [] }] }] })
  assert.equal(c.products[0].category, 'Baby › Cutlery')
  assert.equal(c.products[0].attributes[0].value, 'Pink')
  assert.equal(c.products[0].aplus[0].status, 'APPROVED')
  assert.throws(() => cleanSnapshot({ products: [{ asin: 'B0', marketplace: 'UK', attributes: 'x' }] }), /attributes must be an array/)
  assert.throws(() => cleanSnapshot({ products: [{ asin: 'B0', marketplace: 'UK', variations: [] }] }), /variations must be an object/)
  assert.equal(listingOverall(['match', 'drift', 'problem']), 'problem')
  assert.equal(listingOverall(['match', 'in_flight']), 'in_flight')
  assert.equal(listingOverall(['match', 'na']), 'match')
})

test('teams: cards link to the approval; no URL means a logged no-op', async () => {
  const card = approvalCard({ id: 't1', title: 'BF email', approval_area: 'email', approvers: ['Laura'], expires_at: '2026-11-09T09:00:00Z', agent_id: 'doddl-hq' }, 'new', 'https://pm.example')
  const content = card.attachments[0].content
  assert.equal(card.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive')
  assert.equal(content.actions[0].url, 'https://pm.example/?view=approvals&task=t1')
  assert.ok(content.body.some(b => b.text === 'BF email'))
  const esc = approvalCard({ id: 't1', title: 'x', escalated_to: 'Jon' }, 'escalated', 'https://pm.example').attachments[0].content
  assert.ok(esc.body[2].facts.some(f => f.title === 'Backup' && f.value === 'Jon'))
  const sum = summaryCard('Jon', { waiting: 2, due_today: 1, overdue: 1, escalated: 0, items: [{ id: 'a', title: 'A', overdue: true }] }, 'https://pm.example').attachments[0].content
  assert.ok(sum.body.some(b => b.type === 'TextBlock' && b.text.includes('[A](https://pm.example/?view=approvals&task=a)')))
  assert.equal(approvalLink('a b', 'https://x'), 'https://x/?view=approvals&task=a%20b')

  const logs = []
  const orig = console.log
  console.log = (m) => logs.push(m)
  try {
    const r = await createTeams({ url: '', fetchImpl: () => { throw new Error('must not call') } }).postApproval({ id: 'x', title: 'y' })
    assert.deepEqual(r, { posted: false, reason: 'not configured' })
  } finally { console.log = orig }
  assert.deepEqual(logs, ['teams: not configured'])

  const sent = []
  const teams = createTeams({ url: 'https://hook.example/abc', fetchImpl: async (u, init) => { sent.push({ u, body: JSON.parse(init.body) }); return { ok: true } }, base: 'https://pm.example' })
  assert.deepEqual(await teams.postSummary('Jon', { waiting: 1, items: [] }), { posted: true })
  assert.equal(sent[0].body.type, 'message')
  const failing = createTeams({ url: 'https://hook.example/abc', fetchImpl: async () => { throw new Error('down') } })
  const errs = []
  const origErr = console.error
  console.error = (...a) => errs.push(a.join(' '))
  try { assert.deepEqual(await failing.postApproval({ id: 'x' }), { posted: false, reason: 'error' }) } finally { console.error = origErr }
  assert.ok(!errs.join(' ').includes('hook.example'), 'the webhook URL is never logged')
})
