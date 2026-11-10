import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  allowanceFor, warmupWeek, shouldActivate, inWindow, runsLeft, runQuota, firstEmailBlocked, followUpDue, approvedEmails, sendGaps,
  fillMerge, buildMessage, complianceFooter, textToHtml, linkTarget, isScanner, parseNdr, classifyInbound, classifyReply, stripQuoted,
  referencedIds, mailboxPauseReason, campaignPauseReason, buildReport, funnel, nextWorkingDay17, domainOf, validEmail, localParts,
  PRIVACY_URL, COMPANY_NAME, addressConfirmed, COMPANY_NUMBER, REGISTERED_ADDRESS,
} from '../lib/b2bMail/rules.js'
import { encryptSecret, decryptSecret, newTrackToken, hashToken, validToken, pkcePair, tokenKey } from '../lib/b2bMail/crypto.js'
import { contactsFromPages, emailsInHtml, isRoleAddress, ownDomain, robotsAllows, extractFromWebsite, hasMx } from '../lib/b2bMail/extract.js'
import { partnerProfile, klaviyoHeaders } from '../lib/b2bMail/klaviyo.js'
import { adminConsentUrl, authorizeUrl, mailConfig, needsAdminConsent, SCOPES } from '../lib/b2bMail/graph.js'
import { trackClick, trackOpen, cleanSignature, TOKEN_SLOT } from '../lib/pm/b2bMail.js'
import { knownDomains } from '../lib/pm/b2bKnown.js'
import { agentWork } from '../lib/pm/b2b.js'
import { routeFor, safeSelect } from '../lib/server/dbProxy.js'
import { validateB2BVote } from '../lib/b2b.js'

const KEY = Buffer.alloc(32, 7).toString('base64')
const mb = (o = {}) => ({ status: 'warming', daily_cap: 50, warmup_started_on: '2026-11-02', send_days: [1, 2, 3, 4, 5], send_window: { from: '09:00', to: '16:30', tz: 'Europe/London' }, ...o })

// ─── a tiny fake supabase client: records every table touched, answers from a handler ───
function fakeDb(handler) {
  const touched = []
  const from = (table) => {
    touched.push(table)
    const q = { table, op: 'select', filters: [], cols: null, body: null }
    const run = () => Promise.resolve(handler(q) || { data: [], error: null })
    const chain = {
      select(c) { if (q.op === 'select') q.cols = c; return chain },
      insert(b) { q.op = 'insert'; q.body = b; return chain },
      update(b) { q.op = 'update'; q.body = b; return chain },
      maybeSingle() { q.single = true; return run().then(r => ({ ...r, data: Array.isArray(r.data) ? (r.data[0] || null) : r.data })) },
      single() { return chain.maybeSingle() },
      then(res, rej) { return run().then(res, rej) },
    }
    for (const m of ['eq', 'neq', 'in', 'is', 'not', 'gte', 'lte', 'like', 'ilike', 'order', 'limit', 'range']) chain[m] = (...a) => { q.filters.push([m, ...a]); return chain }
    return chain
  }
  return { from, touched }
}

// ─── warm-up allowance ──────────────────────────────────────────────────────

test('warm-up: 10 / 20 / 30 a day in weeks 1-3, then the daily cap (max 100); active after week 4', () => {
  assert.equal(warmupWeek(mb(), new Date('2026-11-04T10:00:00Z')), 1)
  assert.equal(allowanceFor(mb(), new Date('2026-11-04T10:00:00Z')), 10)
  assert.equal(allowanceFor(mb(), new Date('2026-11-10T10:00:00Z')), 20)
  assert.equal(allowanceFor(mb(), new Date('2026-11-17T10:00:00Z')), 30)
  assert.equal(allowanceFor(mb(), new Date('2026-11-24T10:00:00Z')), 50)
  assert.equal(allowanceFor(mb({ daily_cap: 500 }), new Date('2026-12-24T10:00:00Z')), 100)
  assert.equal(allowanceFor(mb({ daily_cap: 15 }), new Date('2026-11-17T10:00:00Z')), 15)
  assert.equal(allowanceFor(mb({ status: 'paused' }), new Date('2026-11-24T10:00:00Z')), 0)
  assert.equal(allowanceFor(mb({ status: 'error' })), 0)
  assert.equal(shouldActivate(mb(), new Date('2026-11-27T10:00:00Z')), false)
  assert.equal(shouldActivate(mb(), new Date('2026-11-30T10:00:00Z')), true)
})

// ─── send window ────────────────────────────────────────────────────────────

test('window: weekdays 09:00-16:30 Europe/London, in GMT and in BST', () => {
  assert.equal(inWindow(mb(), new Date('2026-11-10T08:59:00Z')), false) // Tue 08:59 GMT
  assert.equal(inWindow(mb(), new Date('2026-11-10T09:00:00Z')), true)
  assert.equal(inWindow(mb(), new Date('2026-11-10T16:29:00Z')), true)
  assert.equal(inWindow(mb(), new Date('2026-11-10T16:30:00Z')), false)
  assert.equal(inWindow(mb(), new Date('2026-11-14T11:00:00Z')), false) // Saturday
  assert.equal(inWindow(mb(), new Date('2026-07-07T08:30:00Z')), true) // 09:30 BST
  assert.equal(inWindow(mb(), new Date('2026-07-07T15:45:00Z')), false) // 16:45 BST
  assert.equal(inWindow(mb({ send_days: [6] }), new Date('2026-11-14T11:00:00Z')), true)
})

test('pace: allowance spread over the runs left, randomly rounded, never more than 3 a run', () => {
  assert.equal(runsLeft(mb(), new Date('2026-11-10T09:00:00Z')), 45)
  assert.equal(runsLeft(mb(), new Date('2026-11-10T16:25:00Z')), 1)
  assert.equal(runQuota({ allowance: 45, sentToday: 0, runs: 45, random: () => 0.99 }), 1)
  assert.equal(runQuota({ allowance: 20, sentToday: 0, runs: 45, random: () => 0.9 }), 0)
  assert.equal(runQuota({ allowance: 20, sentToday: 0, runs: 45, random: () => 0.1 }), 1)
  assert.equal(runQuota({ allowance: 50, sentToday: 50, runs: 10, random: () => 0 }), 0)
  assert.equal(runQuota({ allowance: 100, sentToday: 0, runs: 2, random: () => 0 }), 3)
  assert.equal(runQuota({ allowance: 30, sentToday: 28, runs: 1, random: () => 0.9 }), 2)
  // Over a simulated day the total lands on the allowance.
  let sent = 0
  let seed = 1
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  for (let r = 45; r >= 1; r--) sent += runQuota({ allowance: 30, sentToday: sent, runs: r, random: rnd })
  assert.equal(sent, 30)
})

// ─── eligibility (hard rules) ───────────────────────────────────────────────

const live = { stage: 'live', channels: ['email'], market: { country: 'GB' } }
const okContact = { email: 'info@acorn.co.uk', status: 'ok' }
const ctx = (o = {}) => ({ campaign: live, prospect: { status: 'approved', details: { entity_type: 'company' } }, contact: okContact, suppressed: () => false, ...o })

test('eligibility: UK only limited companies and LLPs; Germany never; partners, suppressions and 30 days blocked', () => {
  assert.equal(firstEmailBlocked(ctx()), null)
  assert.equal(firstEmailBlocked(ctx({ prospect: { status: 'found', details: { entity_type: 'llp' } } })), null)
  for (const e of ['partnership', 'sole_trader', 'childminder', 'unknown', 'charity']) {
    assert.match(firstEmailBlocked(ctx({ prospect: { status: 'found', details: { entity_type: e } } })), /^UK:/, e)
  }
  assert.match(firstEmailBlocked(ctx({ prospect: { status: 'found', details: {} } })), /unknown/)
  assert.match(firstEmailBlocked(ctx({ campaign: { ...live, market: { country: 'DE' } } })), /Germany/)
  assert.equal(firstEmailBlocked(ctx({ campaign: { ...live, market: { country: 'FR' } }, prospect: { status: 'found', details: { entity_type: 'unknown' } } })), null)
  assert.match(firstEmailBlocked(ctx({ campaign: { ...live, market: { country: 'IE' } }, prospect: { status: 'found', details: { entity_type: 'sole_trader' } } })), /Ireland/)
  assert.match(firstEmailBlocked(ctx({ campaign: { ...live, stage: 'paused' } })), /not live/)
  assert.match(firstEmailBlocked(ctx({ campaign: { ...live, channels: ['phone'] } })), /not a channel/)
  assert.match(firstEmailBlocked(ctx({ prospect: { status: 'replied', details: { entity_type: 'company' } } })), /replied/)
  assert.match(firstEmailBlocked(ctx({ prospect: { status: 'approved', details: { entity_type: 'company' }, klaviyo_profile_id: 'k1' } })), /partner/)
  assert.match(firstEmailBlocked(ctx({ contact: { ...okContact, status: 'suggested' } })), /suggested/)
  assert.match(firstEmailBlocked(ctx({ contact: null })), /no contact/)
  assert.match(firstEmailBlocked(ctx({ contact: { ...okContact, mx_ok: false } })), /MX/)
  assert.match(firstEmailBlocked(ctx({ suppressed: (e, d) => d === 'acorn.co.uk' })), /do-not-contact/)
  assert.match(firstEmailBlocked(ctx({ otherCampaignWithin30: true })), /30 days/)
  assert.match(firstEmailBlocked(ctx({ stepsSent: 1 })), /already started/)
})

test('follow-ups: due after the approved gap; a reply, bounce or opt-out stops; an auto-reply pauses 7 days; max 3', () => {
  const first = { id: 'm1', step: 1, sent_at: '2026-11-02T10:00:00Z', status: 'sent', graph_id: 'g1' }
  const base = { sent: [first], gaps: [0, 4, 10], steps: 3, prospect: { status: 'contacted' }, contact: okContact, suppressed: () => false }
  assert.equal(followUpDue({ ...base, now: new Date('2026-11-05T10:00:00Z') }), null)
  const due = followUpDue({ ...base, now: new Date('2026-11-06T10:00:00Z') })
  assert.equal(due.step, 2)
  assert.equal(due.first.graph_id, 'g1')
  assert.equal(followUpDue({ ...base, events: [{ message_id: 'm1', kind: 'reply', at: '2026-11-03T10:00:00Z' }], now: new Date('2026-11-07T10:00:00Z') }), null)
  assert.equal(followUpDue({ ...base, events: [{ message_id: 'm1', kind: 'bounce_hard', at: '2026-11-03T10:00:00Z' }], now: new Date('2026-11-07T10:00:00Z') }), null)
  assert.equal(followUpDue({ ...base, events: [{ message_id: 'm1', kind: 'auto_reply', at: '2026-11-04T10:00:00Z' }], now: new Date('2026-11-07T10:00:00Z') }), null)
  assert.equal(followUpDue({ ...base, events: [{ message_id: 'm1', kind: 'auto_reply', at: '2026-11-04T10:00:00Z' }], now: new Date('2026-11-11T11:00:00Z') }).step, 2)
  const second = { id: 'm2', step: 2, sent_at: '2026-11-06T10:00:00Z', status: 'sent' }
  assert.equal(followUpDue({ ...base, sent: [second, first], now: new Date('2026-11-11T10:00:00Z') }), null) // 10 - 4 = 6 days
  assert.equal(followUpDue({ ...base, sent: [second, first], now: new Date('2026-11-12T10:00:00Z') }).step, 3)
  const third = { id: 'm3', step: 3, sent_at: '2026-11-12T10:00:00Z', status: 'sent' }
  assert.equal(followUpDue({ ...base, sent: [first, second, third], now: new Date('2026-12-30T10:00:00Z') }), null)
  assert.equal(followUpDue({ ...base, steps: 1, now: new Date('2026-12-30T10:00:00Z') }), null)
  assert.equal(followUpDue({ ...base, suppressed: () => true, now: new Date('2026-11-07T10:00:00Z') }), null)
  assert.equal(followUpDue({ ...base, prospect: { status: 'opted_out' }, now: new Date('2026-11-07T10:00:00Z') }), null)
})

test('approved words: rejected e-mails left out, edits applied, at most 3; gaps from "when"', () => {
  const task = { decision: 'approved_with_edits', artefact: { emails: [
    { id: 'e1', when: 'Day 0', subject: 'Hi', body: 'One' }, { id: 'e2', when: 'Day 4', subject: 'Re', body: 'Two' },
    { id: 'e3', when: 'Day 9', subject: 'Last', body: 'Three' }, { id: 'e4', when: 'Day 20', subject: 'Four', body: 'Four' },
  ] }, line_decisions: { e1: 'approved', e2: 'rejected', 'e3:edit': { body: 'Three, edited' }, e3: 'edited' } }
  const out = approvedEmails(task)
  assert.deepEqual(out.map(e => [e.step, e.id, e.body]), [[1, 'e1', 'One'], [2, 'e3', 'Three, edited'], [3, 'e4', 'Four']])
  assert.deepEqual(approvedEmails({ ...task, decision: 'revision_requested' }), [])
  assert.deepEqual(sendGaps(out), [0, 9, 20])
  assert.deepEqual(sendGaps([{ when: 'Day 0' }, { when: 'later' }, {}]), [0, 4, 10])
  assert.deepEqual(sendGaps([{ when: 'Day 3' }, { when: 'Day 2' }]), [3, 7])
})

// ─── merge fields and footer ────────────────────────────────────────────────

test('merge fields: company, place, first name; a neutral greeting without a named contact; leftovers refused', () => {
  assert.equal(fillMerge('Hi [first_name], is [company] in [place]?', { company: 'Acorn', place: 'Leeds', first_name: 'Sam' }).text, 'Hi Sam, is Acorn in Leeds?')
  assert.equal(fillMerge('Hi [first name],\nThanks', { company: 'Acorn' }).text, 'Hello,\nThanks')
  assert.equal(fillMerge('Dear [first_name], hello', {}).text, 'Hello, hello')
  assert.deepEqual(fillMerge('Hi [first_name], [price]', { first_name: 'Sam' }).unfilled, ['[price]'])
  const email = { step: 1, subject: 'A set for [company]', body: 'Hi [first_name],\n\nSee https://doddl.com/pages/trade?x=1&y=2 and https://doddl.com.\n\nJon' }
  const m = buildMessage({ email, prospect: { name: 'Acorn Day Nursery', place: 'Leeds' }, contact: { type: 'generic' }, mailbox: { signature_html: '<b>Jon</b>' }, base: 'https://pm.example', token: 'TOKEN', trackOpens: false })
  assert.equal(m.subject, 'A set for Acorn Day Nursery')
  assert.match(m.html, /Hello,/)
  assert.match(m.html, /https:\/\/pm\.example\/api\/t\/c\/TOKEN\/1/)
  assert.match(m.html, /https:\/\/pm\.example\/api\/t\/c\/TOKEN\/2/)
  assert.deepEqual(m.links, [{ n: 1, url: 'https://doddl.com/pages/trade?x=1&y=2' }, { n: 2, url: 'https://doddl.com' }])
  assert.match(m.html, /https:\/\/pm\.example\/api\/t\/u\/TOKEN/)
  assert.ok(m.html.includes(COMPANY_NAME) && m.html.includes(PRIVACY_URL))
  assert.match(m.html, /We found Acorn Day Nursery on its website/)
  assert.match(m.html, /reply “stop”/)
  assert.doesNotMatch(m.html, /\/api\/t\/o\//)
  assert.match(m.html, /<b>Jon<\/b>/)
  const tracked = buildMessage({ email, prospect: { name: 'A' }, contact: { type: 'named', first_name: 'Sam' }, mailbox: {}, base: 'https://pm.example', token: 'T', trackOpens: true })
  assert.match(tracked.html, /\/api\/t\/o\/T\.gif/)
  assert.match(tracked.html, /Hi Sam,/)
  assert.throws(() => buildMessage({ email: { subject: 'x', body: 'Price: [price]' }, prospect: { name: 'A' }, contact: {}, mailbox: {}, base: 'b', token: 't' }), /\[price\]/)
  assert.match(complianceFooter({ company: '<script>', optOutUrl: 'u' }), /&lt;script&gt;/)
  assert.ok(TOKEN_SLOT && !/[<>"]/.test(TOKEN_SLOT))
})

test('the footer carries the Companies House registered office and number, so the sender may run', () => {
  assert.equal(addressConfirmed(), true)
  assert.equal(COMPANY_NUMBER, '08775649')
  assert.match(REGISTERED_ADDRESS, /GL6 0BS$/)
})

test('signatures lose scripts, handlers and javascript: links', () => {
  const s = cleanSignature('<p onclick="x()">Jon</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><iframe src="y"></iframe>')
  assert.doesNotMatch(s, /script|onclick|javascript:|iframe/i)
  assert.match(s, /Jon/)
})

// ─── tracking: click redirect safety, tokens ────────────────────────────────

test('links: only the stored URL for that n, only http(s)', () => {
  const links = [{ n: 1, url: 'https://doddl.com/a' }, { n: 2, url: 'javascript:alert(1)' }]
  assert.equal(linkTarget(links, 1), 'https://doddl.com/a')
  assert.equal(linkTarget(links, '1'), 'https://doddl.com/a')
  assert.equal(linkTarget(links, 2), null)
  assert.equal(linkTarget(links, 3), null)
  assert.equal(linkTarget(links, '1;https://evil.com'), null)
  assert.equal(linkTarget(links, 0), null)
  assert.equal(linkTarget(null, 1), null)
  const { html } = textToHtml('go to https://evil.example/x"onmouseover=1', (n) => `https://pm/t/${n}`)
  assert.doesNotMatch(html, /"onmouseover/)
})

test('click route: redirects to the stored URL, never elsewhere; scanners recorded as such; unknown tokens 404', async () => {
  const token = newTrackToken()
  const events = []
  const db = fakeDb((q) => {
    if (q.table === 'b2b_messages') {
      const h = q.filters.find(f => f[0] === 'eq' && f[1] === 'track_token_hash')
      return { data: h && h[2] === hashToken(token) ? [{ id: 'm1', sent_at: '2026-11-10T09:00:00Z', links: [{ n: 1, url: 'https://doddl.com/trade' }], opens_tracked: false }] : [], error: null }
    }
    if (q.table === 'b2b_message_events' && q.op === 'insert') { events.push(q.body[0]); return { data: null, error: null } }
    return { data: [], error: null }
  })
  const now = new Date('2026-11-10T10:00:00Z')
  assert.equal(await trackClick(db, { token, n: '1', userAgent: 'Mozilla/5.0 (Macintosh) Safari/605', now }), 'https://doddl.com/trade')
  assert.equal(events.at(-1).kind, 'click')
  assert.equal(await trackClick(db, { token, n: '2', userAgent: 'Mozilla/5.0', now }), null)
  assert.equal(await trackClick(db, { token: newTrackToken(), n: '1', userAgent: 'Mozilla/5.0', now }), null)
  assert.equal(await trackClick(db, { token: 'not-a-token', n: '1', now }), null)
  assert.equal(await trackClick(db, { token, n: '1', method: 'HEAD', userAgent: 'Mozilla/5.0', now }), 'https://doddl.com/trade')
  assert.equal(events.at(-1).kind, 'scanner')
  // Opens are not recorded when the campaign does not track them.
  assert.equal(await trackOpen(db, { token, userAgent: 'Mozilla/5.0', now }), false)
})

test('scanners: HEAD, within 60 s of sending, no or a known scanner user agent', () => {
  const sentAt = '2026-11-10T10:00:00Z'
  assert.equal(isScanner({ method: 'HEAD', userAgent: 'Mozilla/5.0', sentAt, now: new Date('2026-11-10T12:00:00Z') }), true)
  assert.equal(isScanner({ userAgent: 'Mozilla/5.0', sentAt, now: new Date('2026-11-10T10:00:30Z') }), true)
  assert.equal(isScanner({ userAgent: 'Mozilla/5.0 (compatible; Barracuda Sentinel)', sentAt, now: new Date('2026-11-10T12:00:00Z') }), true)
  assert.equal(isScanner({ userAgent: '', sentAt, now: new Date('2026-11-10T12:00:00Z') }), true)
  assert.equal(isScanner({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit/605.1.15 Mobile/15E148', sentAt, now: new Date('2026-11-10T12:00:00Z') }), false)
})

test('tokens: random 128-bit, stored as sha256, validated before lookup', () => {
  const a = newTrackToken(), b = newTrackToken()
  assert.notEqual(a, b)
  assert.equal(Buffer.from(a, 'base64url').length, 16)
  assert.ok(validToken(a))
  assert.equal(validToken('../etc'), false)
  assert.equal(validToken(`${a}x`), false)
  assert.match(hashToken(a), /^[0-9a-f]{64}$/)
  assert.equal(hashToken(a), hashToken(a))
  assert.notEqual(hashToken(a), hashToken(b))
  assert.ok(!hashToken(a).includes(a))
})

test('secrets: AES-256-GCM round trip, tamper detected, key must be 32 bytes', () => {
  const key = tokenKey(KEY)
  const blob = encryptSecret('refresh-token-value', key)
  assert.match(blob, /^v1\./)
  assert.ok(!blob.includes('refresh-token-value'))
  assert.equal(decryptSecret(blob, key), 'refresh-token-value')
  assert.notEqual(encryptSecret('x', key), encryptSecret('x', key))
  const parts = blob.split('.')
  parts[3] = Buffer.from('tampered').toString('base64url')
  assert.throws(() => decryptSecret(parts.join('.'), key))
  assert.throws(() => tokenKey(undefined), /B2B_MAIL_TOKEN_KEY is not set/)
  assert.throws(() => tokenKey('c2hvcnQ='), /32 bytes/)
  assert.equal(tokenKey('ab'.repeat(32)).length, 32)
  const { verifier, challenge } = pkcePair()
  assert.ok(verifier.length >= 43 && challenge.length === 43)
})

// ─── inbound classification ─────────────────────────────────────────────────

test('bounces: NDR senders / subjects; 5.x.x hard, 4.x.x soft', () => {
  const ndr = classifyInbound({ from: 'postmaster@outlook.com', subject: 'Undeliverable: A set for Acorn', text: "Remote Server returned '550 5.1.1 RESOLVER.ADR.RecipNotFound; not found'" })
  assert.deepEqual(ndr, { type: 'bounce', hard: true, code: '5.1.1' })
  assert.deepEqual(classifyInbound({ from: 'MAILER-DAEMON@mx.example', subject: 'Delivery Status Notification (Delay)', text: 'Status: 4.4.7 delivery delayed' }), { type: 'bounce', hard: false, code: '4.4.7' })
  assert.equal(classifyInbound({ from: 'MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@doddl.com', subject: 'Undeliverable', text: 'mailbox full, will retry' }).hard, false)
  assert.deepEqual(parseNdr('550 mailbox unavailable'), { code: '550', hard: true })
  assert.equal(parseNdr('').hard, true)
})

test('auto-replies: Auto-Submitted / X-Autoreply headers, "Automatic reply" / out-of-office subjects and text', () => {
  assert.deepEqual(classifyInbound({ from: 'sam@acorn.co.uk', subject: 'Automatic reply: A set for Acorn', text: 'I am away' }), { type: 'auto_reply' })
  assert.deepEqual(classifyInbound({ from: 'sam@acorn.co.uk', subject: 'Re: A set', headers: [{ name: 'Auto-Submitted', value: 'auto-replied' }], text: 'x' }), { type: 'auto_reply' })
  assert.deepEqual(classifyInbound({ from: 'sam@acorn.co.uk', subject: 'Re: A set', headers: [{ name: 'X-Autoreply', value: 'yes' }], text: 'x' }), { type: 'auto_reply' })
  assert.deepEqual(classifyInbound({ from: 'sam@acorn.co.uk', subject: 'Re: A set', text: 'I am out of the office until Monday.' }), { type: 'auto_reply' })
  assert.equal(classifyInbound({ from: 'sam@acorn.co.uk', subject: 'Re: A set', headers: [{ name: 'Auto-Submitted', value: 'no' }], text: 'Yes please, send one' }).type, 'reply')
})

test('replies: opt-out, negative, owner, positive, question; quoted history ignored; contact details removed', () => {
  const k = (t) => classifyReply(t).kind
  assert.equal(k('Please remove me from your list'), 'optout')
  assert.equal(k('STOP'), 'optout')
  assert.equal(k('unsubscribe'), 'optout')
  assert.equal(k('No thanks, not interested'), 'negative')
  assert.equal(k('We already have a supplier'), 'negative')
  assert.equal(k('You need to speak to the owner about a bulk order'), 'owner')
  assert.equal(k("I'm not the right person, try our manager"), 'owner')
  assert.equal(k('Yes please, send us the trade pack'), 'positive')
  assert.equal(k('Sounds great, happy to try a set'), 'positive')
  assert.equal(k('How much are they per set?'), 'question')
  assert.equal(k('Hmm'), 'question')
  assert.equal(k('Yes please!\n\nOn Tue, 10 Nov 2026, Jon <trade@doddl.com> wrote:\n> please remove me if not interested'), 'positive')
  const r = classifyReply('Yes please, call me on 07700 900123 or email sam@acorn.co.uk')
  assert.doesNotMatch(r.summary, /07700|sam@acorn/)
  assert.equal(stripQuoted('Thanks!\n> old\n-----Original Message-----\nFrom: x'), 'Thanks!')
  assert.deepEqual(referencedIds([{ name: 'In-Reply-To', value: '<a@b>' }, { name: 'References', value: '<x@y> <a@b>' }]), ['<a@b>', '<x@y>'])
})

test('replies due the next working day at 17:00 UK', () => {
  assert.equal(nextWorkingDay17(new Date('2026-11-10T10:00:00Z')).toISOString(), '2026-11-11T17:00:00.000Z') // Tue -> Wed
  assert.equal(nextWorkingDay17(new Date('2026-11-13T10:00:00Z')).toISOString(), '2026-11-16T17:00:00.000Z') // Fri -> Mon
  assert.equal(nextWorkingDay17(new Date('2026-07-09T10:00:00Z')).toISOString(), '2026-07-10T16:00:00.000Z') // BST
})

// ─── health and report ──────────────────────────────────────────────────────

test('health: mailbox pauses on >5% hard bounces over 100 sends or 3 in a day; campaign on >5% opt-outs + negatives', () => {
  const sends = (n, hard) => Array.from({ length: n }, (_, i) => ({ hard: i < hard }))
  assert.equal(mailboxPauseReason({ last: sends(100, 5) }), null)
  assert.match(mailboxPauseReason({ last: sends(100, 6) }), /6%/)
  assert.equal(mailboxPauseReason({ last: sends(10, 2) }), null)
  assert.match(mailboxPauseReason({ last: sends(10, 2), hardToday: 3 }), /3 hard bounces today/)
  assert.equal(campaignPauseReason({ sends: 100, optouts: 3, negatives: 2 }), null)
  assert.match(campaignPauseReason({ sends: 100, optouts: 4, negatives: 2 }), /6%/)
  assert.equal(campaignPauseReason({ sends: 10, optouts: 5 }), null)
})

test('report: sent by step, delivered, unique opens / clicks, reply kinds; opens "not measured" when off', () => {
  const messages = [
    { id: 'a', step: 1, sent_at: '2026-11-09T10:00:00Z', opens_tracked: false },
    { id: 'b', step: 1, sent_at: '2026-11-10T10:00:00Z', opens_tracked: false },
    { id: 'c', step: 2, sent_at: '2026-11-10T11:00:00Z', opens_tracked: false },
    { id: 'd', step: 1, sent_at: null },
  ]
  const events = [
    { message_id: 'a', kind: 'bounce_hard', at: '2026-11-09T10:05:00Z' },
    { message_id: 'b', kind: 'click', at: '2026-11-10T12:00:00Z' }, { message_id: 'b', kind: 'click', at: '2026-11-10T12:30:00Z' },
    { message_id: 'b', kind: 'scanner', at: '2026-11-10T10:00:10Z' }, { message_id: 'c', kind: 'optout', at: '2026-11-10T13:00:00Z' },
    { message_id: 'c', kind: 'auto_reply', at: '2026-11-10T11:30:00Z' },
  ]
  const replies = [{ kind: 'positive', created_at: '2026-11-10T14:00:00Z' }, { kind: 'optout', created_at: '2026-11-10T13:00:00Z' }]
  const r = buildReport({ messages, events, replies, by: 'day' })
  assert.equal(r.opens_measured, false)
  assert.equal(r.total.sent, 3)
  assert.deepEqual(r.total.sent_by_step, { 1: 2, 2: 1, 3: 0 })
  assert.equal(r.total.delivered, 2)
  assert.equal(r.total.bounces_hard, 1)
  assert.equal(r.total.opens, null)
  assert.equal(r.total.clicks, 1)
  assert.equal(r.total.replies_total, 2)
  assert.equal(r.total.optouts, 1)
  assert.equal(r.total.auto_replies, 1)
  assert.equal(r.total.reply_rate, 100)
  assert.deepEqual(r.rows.map(x => [x.period, x.sent]), [['2026-11-09', 1], ['2026-11-10', 2]])
  const on = buildReport({ messages: [{ id: 'a', step: 1, sent_at: '2026-11-09T10:00:00Z', opens_tracked: true }], events: [{ message_id: 'a', kind: 'open', at: '2026-11-09T11:00:00Z' }, { message_id: 'a', kind: 'open', at: '2026-11-09T12:00:00Z' }] })
  assert.equal(on.total.opens, 1)
  const f = funnel({ prospects: [
    { id: 1, status: 'contacted', contact: { has_contact: true } }, { id: 2, status: 'warm', contact: { has_contact: true } },
    { id: 3, status: 'partner', contact: { has_contact: true } }, { id: 4, status: 'found', contact: { has_contact: false } }, { id: 5, status: 'rejected' },
  ], emailedIds: new Set([1, 2, 3]) })
  assert.deepEqual(f, { found: 4, contactable: 3, emailed: 3, replied: 2, warm: 2, partner: 1 })
})

// ─── website extractor ──────────────────────────────────────────────────────

test('extractor: own-domain addresses only; role addresses usable, personal ones suggested; junk ignored', () => {
  const html = `<a href="mailto:Info@AcornNursery.co.uk">Email us</a> office&#64;acornnursery.co.uk
    sarah.jones@acornnursery.co.uk  bookings [at] acornnursery [dot] co [dot] uk  noreply@acornnursery.co.uk
    someone@gmail.com  logo@2x.png  hello@leeds.acornnursery.co.uk  privacy@acornnursery.co.uk`
  const out = contactsFromPages([{ url: 'https://acornnursery.co.uk/contact', html }], 'acornnursery.co.uk')
  const by = Object.fromEntries(out.map(c => [c.email, c]))
  assert.equal(by['info@acornnursery.co.uk'].type, 'generic')
  assert.equal(by['info@acornnursery.co.uk'].status, 'ok')
  assert.equal(by['office@acornnursery.co.uk'].status, 'ok')
  assert.equal(by['bookings@acornnursery.co.uk'].status, 'ok')
  assert.equal(by['hello@leeds.acornnursery.co.uk'].status, 'ok')
  assert.equal(by['sarah.jones@acornnursery.co.uk'].type, 'named')
  assert.equal(by['sarah.jones@acornnursery.co.uk'].status, 'suggested')
  assert.equal(by['someone@gmail.com'], undefined)
  assert.equal(by['noreply@acornnursery.co.uk'], undefined)
  assert.equal(by['privacy@acornnursery.co.uk'], undefined)
  assert.equal(by['info@acornnursery.co.uk'].source, 'website:https://acornnursery.co.uk/contact')
  assert.ok(out.every(c => !c.email.endsWith('.png')))
  assert.equal(isRoleAddress('enquiries2@x.com'), true)
  assert.equal(isRoleAddress('info.leeds@x.com'), true)
  assert.equal(isRoleAddress('j.smith@x.com'), false)
  assert.equal(ownDomain('a@x.co.uk', 'www.x.co.uk'.replace('www.', '')), true)
  assert.equal(emailsInHtml('a@b').length, 0)
})

test('robots.txt is honoured (our agent, then *; longest rule wins)', () => {
  const robots = 'User-agent: *\nDisallow: /contact\nAllow: /contact-us\n\nUser-agent: BadBot\nDisallow: /'
  assert.equal(robotsAllows(robots, '/'), true)
  assert.equal(robotsAllows(robots, '/contact'), false)
  assert.equal(robotsAllows(robots, '/contact-us'), true)
  assert.equal(robotsAllows('User-agent: *\nDisallow: /', '/about'), false)
  assert.equal(robotsAllows('User-agent: doddl-pm-contact-finder\nDisallow: /\n\nUser-agent: *\nDisallow:', '/'), false)
  assert.equal(robotsAllows('', '/x'), true)
})

test('extractor reads the home page and /contact, /contact-us, /about, skipping what robots.txt forbids', async () => {
  const asked = []
  const pages = {
    'https://acorn.co.uk/robots.txt': 'User-agent: *\nDisallow: /about',
    'https://acorn.co.uk/': '<p>Call us</p>',
    'https://acorn.co.uk/contact': '<a href="mailto:hello@acorn.co.uk">x</a>',
    'https://acorn.co.uk/contact-us': 'Manager: jane@acorn.co.uk',
  }
  const fetchImpl = async (url) => { asked.push(url); const body = pages[url]; return { ok: body != null, headers: { get: () => 'text/html' }, text: async () => body || '' } }
  const out = await extractFromWebsite('https://acorn.co.uk/home', { fetchImpl, pauseMs: 0 })
  assert.ok(!asked.includes('https://www.acorn.co.uk/about') && !asked.includes('https://acorn.co.uk/about'))
  assert.equal(out.domain, 'acorn.co.uk')
  assert.equal((await extractFromWebsite('', { fetchImpl })).contacts.length, 0)
  const out2 = await extractFromWebsite('acorn.co.uk', { fetchImpl, pauseMs: 0 })
  assert.deepEqual(out2.contacts.map(c => [c.email, c.status]), [['hello@acorn.co.uk', 'ok'], ['jane@acorn.co.uk', 'suggested']])
})

test('MX check: true with records, false for a domain with none, null when DNS fails', async () => {
  assert.equal(await hasMx('mx-yes.test', { resolveMx: async () => [{ exchange: 'mx.test', priority: 10 }] }), true)
  assert.equal(await hasMx('mx-no.test', { resolveMx: async () => { const e = new Error('x'); e.code = 'ENOTFOUND'; throw e } }), false)
  assert.equal(await hasMx('mx-err.test', { resolveMx: async () => { const e = new Error('x'); e.code = 'ETIMEOUT'; throw e } }), null)
  assert.equal(domainOf('https://www.Acorn.co.uk/x'), 'acorn.co.uk')
  assert.equal(domainOf('sam@Acorn.co.uk'), 'acorn.co.uk')
  assert.equal(validEmail('sam@acorn.co.uk'), true)
  assert.equal(validEmail('sam@acorn'), false)
})

// ─── agents never see contacts ──────────────────────────────────────────────

function filesUnder(dir) {
  return readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? filesUnder(p) : [p] })
}

test('agent routes and MCP never reach contacts or mailbox tokens (source check)', () => {
  const agentFiles = [...filesUnder('pages/api/agent'), 'pages/api/mcp.js', 'lib/pm/b2bKnown.js']
  for (const f of agentFiles) {
    const src = readFileSync(f, 'utf8')
    assert.doesNotMatch(src, /b2b_contacts|token_enc/, `${f} mentions contacts or tokens`)
    assert.doesNotMatch(src, /lib\/pm\/b2bMail['"]/, `${f} imports the people-only mail module`)
  }
  // lib/pm/b2b.js (behind the agent routes) imports only the go-live helpers from b2bMail, which read mailboxes'
  // public columns and the words, never contacts.
  const b2b = readFileSync('lib/pm/b2b.js', 'utf8')
  assert.match(b2b, /import \{ applyGolive, goliveExtras \} from '\.\/b2bMail'/)
  assert.doesNotMatch(b2b, /from\(['"]b2b_contacts|token_enc/)
})

test('agent work and known-domains: never query b2b_contacts or mailbox tokens, never return an address', async () => {
  const db = fakeDb((q) => {
    if (q.table === 'b2b_campaigns') return { data: [{ id: 'c1', name: 'UK nurseries', stage: 'live', market: { country: 'GB' }, metrics: {}, definition: {}, people: {}, business_type_id: null }], error: null }
    if (q.table === 'b2b_suppressions') return { data: [{ email: 'sam@acorn.co.uk', domain: 'acorn.co.uk', reason: 'optout' }, { email: null, domain: 'partner.co.uk', reason: 'partner' }], error: null }
    if (q.table === 'b2b_prospects') return { data: [{ details: { website: 'https://www.busy.co.uk' }, status: 'contacted' }], error: null }
    return { data: [], error: null }
  })
  const out = await knownDomains(db, ['acorn.co.uk', 'partner.co.uk', 'busy.co.uk', 'new.co.uk'])
  assert.deepEqual(out.domains.sort((a, b) => a.domain.localeCompare(b.domain)), [
    { domain: 'acorn.co.uk', reason: 'suppressed' }, { domain: 'busy.co.uk', reason: 'prospect_in_live_campaign' }, { domain: 'partner.co.uk', reason: 'partner' },
  ])
  assert.doesNotMatch(JSON.stringify(out), /@/)
  await assert.rejects(knownDomains(db, Array.from({ length: 51 }, (_, i) => `d${i}.com`)), /At most 50/)
  const work = await agentWork(db)
  assert.doesNotMatch(JSON.stringify(work), /@/)
  assert.ok(!db.touched.includes('b2b_contacts') && !db.touched.includes('b2b_mailboxes'), `touched: ${[...new Set(db.touched)].join(', ')}`)
})

test('/api/db: b2b_contacts is not available; b2b_mailboxes never returns token_enc', () => {
  assert.throws(() => routeFor('GET', ['rest', 'v1', 'b2b_contacts']), /not available/)
  assert.throws(() => routeFor('PATCH', ['rest', 'v1', 'b2b_mailboxes']), /not allowed/)
  assert.doesNotMatch(safeSelect('b2b_mailboxes', 'select=*'), /token_enc|delta_link/)
  assert.doesNotMatch(decodeURIComponent(safeSelect('b2b_mailboxes', 'select=id,token_enc&id=eq.1')), /token_enc/)
  assert.match(decodeURIComponent(safeSelect('b2b_mailboxes', 'select=id,token_enc&id=eq.1')), /select=id&id=eq\.1/)
  assert.match(decodeURIComponent(safeSelect('b2b_mailboxes', '')), /select=id,address/)
  assert.throws(() => safeSelect('b2b_mailboxes', 'select=id,token:token_enc'), /plain columns/)
  assert.equal(safeSelect('tasks', 'select=*'), 'select=*')
})

// ─── go-live, Graph and Klaviyo shapes ──────────────────────────────────────

test('go-live approval must choose at least one mailbox', () => {
  assert.throws(() => validateB2BVote('b2b_golive', { vote: 'approved', edits: null, lines: null }), /at least one outreach mailbox/)
  assert.throws(() => validateB2BVote('b2b_golive', { vote: 'approved_with_edits', edits: { mailbox_ids: ['x'] } }), /UUIDs/)
  assert.throws(() => validateB2BVote('b2b_golive', { vote: 'approved_with_edits', edits: { mailbox_ids: ['00000000-0000-0000-0000-000000000001'], subject: 'x' } }), /only mailbox_ids and pace/)
  assert.ok(validateB2BVote('b2b_golive', { vote: 'approved_with_edits', edits: { mailbox_ids: ['00000000-0000-0000-0000-000000000001'] } }))
  assert.ok(validateB2BVote('b2b_golive', { vote: 'revision_requested', edits: null }))
})

test('Graph: PKCE authorize URL, delegated scopes, admin-consent URL, clear missing-config list', () => {
  const env = { B2B_MAIL_CLIENT_ID: 'app', B2B_MAIL_CLIENT_SECRET: 's', NEXT_PUBLIC_AZURE_TENANT_ID: 'tenant', B2B_PUBLIC_BASE_URL: 'https://pm.example/', B2B_MAIL_TOKEN_KEY: KEY }
  const cfg = mailConfig(env)
  assert.equal(cfg.ready, true)
  assert.equal(cfg.redirectUri, 'https://pm.example/api/b2b/mailboxes/callback')
  const u = new URL(authorizeUrl(cfg, { state: 'st', challenge: 'ch' }))
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(u.searchParams.get('scope'), 'offline_access User.Read Mail.Send Mail.ReadWrite')
  assert.match(u.pathname, /^\/tenant\/oauth2\/v2\.0\/authorize$/)
  assert.match(adminConsentUrl(cfg), /\/tenant\/v2\.0\/adminconsent\?client_id=app/)
  assert.deepEqual(mailConfig({}).missing, ['B2B_MAIL_CLIENT_ID', 'B2B_MAIL_CLIENT_SECRET', 'B2B_MAIL_TENANT_ID', 'B2B_PUBLIC_BASE_URL', 'B2B_MAIL_TOKEN_KEY'])
  assert.equal(needsAdminConsent({ description: 'AADSTS65001: The user or administrator has not consented' }), true)
  assert.equal(needsAdminConsent({ code: 'invalid_grant' }), false)
  assert.deepEqual(SCOPES, ['offline_access', 'User.Read', 'Mail.Send', 'Mail.ReadWrite'])
})

test('Klaviyo: partner profile properties and consent text; revision header', () => {
  const p = partnerProfile({ email: 'Sam@Acorn.co.uk', first_name: 'Sam', business: 'Acorn', place: 'Leeds', country: 'GB', campaign: 'UK nurseries', business_type: 'Nurseries', wants: 'samples', prospect_id: 'p1', replied_on: '2026-11-10' })
  assert.equal(p.email, 'sam@acorn.co.uk')
  assert.equal(p.organization, 'Acorn')
  assert.deepEqual(p.properties, {
    doddl_record_type: 'b2b_partner', doddl_b2b_campaign: 'UK nurseries', doddl_b2b_business_type: 'Nurseries', doddl_b2b_partner_status: 'samples_requested',
    doddl_b2b_consent: 'replied to doddl trade e-mail on 2026-11-10 asking for samples', doddl_pm_prospect_id: 'p1',
  })
  assert.equal(partnerProfile({ email: 'a@b.co', wants: 'nonsense', replied_on: 'd' }).properties.doddl_b2b_partner_status, 'trade_pack_requested')
  const h = klaviyoHeaders('k')
  assert.equal(h.revision, '2025-10-15')
  assert.equal(h.authorization, 'Klaviyo-API-Key k')
  assert.equal(localParts('2026-11-10T00:30:00Z').date, '2026-11-10')
})
