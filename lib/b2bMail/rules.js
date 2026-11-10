// B2B outreach mail: the pure rules (docs/b2b-campaigns/OUTREACH-MAIL.md). No database, no network, no React.
// Unit-tested in test/b2bMail.test.mjs: warm-up allowance, send window, per-run quota, eligibility (hard rules),
// follow-up timing, the approved words, merge fields + compliance footer, link rewriting, scanner filtering,
// bounce / auto-reply / reply classification, health auto-pause and the report.

// ─── who we are (compliance footer) ─────────────────────────────────────────

export const COMPANY_NAME = 'doddl Ltd'
// TO CONFIRM (Jon / Accounts): the registered office and company number for the footer. While either is
// 'TO CONFIRM' the sender refuses to send (addressConfirmed() is false), so no e-mail goes out without them.
export const REGISTERED_ADDRESS = 'TO CONFIRM'
export const COMPANY_NUMBER = 'TO CONFIRM'
// TO CONFIRM: the public privacy notice (Shopify's standard policy path on doddl.com).
export const PRIVACY_URL = 'https://doddl.com/policies/privacy-policy'

export function addressConfirmed() {
  return !/TO CONFIRM/i.test(REGISTERED_ADDRESS) && !/TO CONFIRM/i.test(COMPANY_NUMBER)
}

export const MAX_STEPS = 3
export const CROSS_CAMPAIGN_DAYS = 30
export const AUTO_REPLY_PAUSE_DAYS = 7
export const SOFT_BOUNCE_RETRY_HOURS = 24
export const DEFAULT_GAPS = [0, 4, 10]
export const CRON_EVERY_MIN = 10
export const MAX_PER_RUN = 3
export const USABLE_MAILBOX = ['warming', 'active']

// ─── time ───────────────────────────────────────────────────────────────────

const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
const fmtCache = new Map()
function fmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
  }
  return fmtCache.get(tz)
}

/** Wall-clock parts in a time zone: { date: 'YYYY-MM-DD', weekday: 1 (Mon) .. 7 (Sun), hour, minute, minutes }. */
export function localParts(d, tz = 'Europe/London') {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(d)).map(x => [x.type, x.value]))
  const hour = Number(p.hour), minute = Number(p.minute)
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: WD[p.weekday], hour, minute, minutes: hour * 60 + minute }
}

/** The instant a wall-clock time happens in a zone: wallToUtc('2026-11-06', '17:00'). */
export function wallToUtc(date, hhmm, tz = 'Europe/London') {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = String(hhmm).split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  const seen = localParts(guess, tz)
  const [sy, sm, sd] = seen.date.split('-').map(Number)
  const seenMs = Date.UTC(sy, sm - 1, sd, seen.hour, seen.minute)
  return new Date(guess - (seenMs - guess))
}

export function hhmm(s, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''))
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return fallback
  return Number(m[1]) * 60 + Number(m[2])
}

const DAY = 86400_000
function daysBetween(fromDate, toDate) {
  return Math.floor((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY)
}

/** Next working day (Mon–Fri) at 17:00 UK: when a reply needing a person is due. */
export function nextWorkingDay17(now = new Date()) {
  let d = new Date(Date.parse(`${localParts(now).date}T12:00:00Z`) + DAY)
  while ([6, 7].includes(localParts(d, 'UTC').weekday)) d = new Date(d.getTime() + DAY)
  return wallToUtc(d.toISOString().slice(0, 10), '17:00')
}

// ─── warm-up, window and pace ───────────────────────────────────────────────

export function windowOf(mailbox) {
  const w = (mailbox && mailbox.send_window) || {}
  return { from: hhmm(w.from, 9 * 60), to: hhmm(w.to, 16 * 60 + 30), tz: w.tz || 'Europe/London' }
}

/** Week of warm-up (1-based) on a given date, or null when warm-up has not started. */
export function warmupWeek(mailbox, now = new Date()) {
  if (!mailbox || !mailbox.warmup_started_on) return null
  const today = localParts(now, windowOf(mailbox).tz).date
  return Math.max(1, Math.floor(daysBetween(mailbox.warmup_started_on, today) / 7) + 1)
}

export function dailyCap(mailbox) {
  const n = Number(mailbox && mailbox.daily_cap)
  return Math.min(100, Math.max(1, Number.isFinite(n) && n > 0 ? Math.floor(n) : 50))
}

/** Today's sends allowed (follow-ups included): week 1 = 10, 2 = 20, 3 = 30, 4+ = daily_cap; never above the cap. */
export function allowanceFor(mailbox, now = new Date()) {
  if (!mailbox || !USABLE_MAILBOX.includes(mailbox.status)) return 0
  const cap = dailyCap(mailbox)
  const w = warmupWeek(mailbox, now)
  if (w == null) return Math.min(10, cap)
  return Math.min(cap, w >= 4 ? cap : w * 10)
}

/** A warming mailbox becomes active after week 4 (from day 28). */
export function shouldActivate(mailbox, now = new Date()) {
  const w = warmupWeek(mailbox, now)
  return mailbox && mailbox.status === 'warming' && w != null && w >= 5
}

/** Is it a send day, inside the send window, in the mailbox's zone? */
export function inWindow(mailbox, now = new Date()) {
  const w = windowOf(mailbox)
  const p = localParts(now, w.tz)
  const days = Array.isArray(mailbox && mailbox.send_days) && mailbox.send_days.length ? mailbox.send_days.map(Number) : [1, 2, 3, 4, 5]
  return days.includes(p.weekday) && p.minutes >= w.from && p.minutes < w.to
}

/** Cron runs left in today's window, this one included (at least 1 while inside it). */
export function runsLeft(mailbox, now = new Date(), every = CRON_EVERY_MIN) {
  const w = windowOf(mailbox)
  const p = localParts(now, w.tz)
  return Math.max(1, Math.ceil((w.to - p.minutes) / every))
}

/**
 * How many to send this run: the remaining allowance spread over the runs left, with a random rounding so the
 * day's total lands on the allowance without bursts; never more than MAX_PER_RUN. random() is injectable for tests.
 */
export function runQuota({ allowance, sentToday, runs, random = Math.random }) {
  const left = Math.max(0, allowance - sentToday)
  if (!left) return 0
  const expected = left / Math.max(1, runs)
  const n = Math.floor(expected) + (random() < expected - Math.floor(expected) ? 1 : 0)
  return Math.min(left, MAX_PER_RUN, runs <= 1 ? left : n)
}

/** A random wait in [minMs, maxMs]: spacing inside a run so sends never land on the same second. */
export function jitterMs(minMs, maxMs, random = Math.random) {
  return Math.round(minMs + random() * (maxMs - minMs))
}

// ─── addresses and domains ──────────────────────────────────────────────────

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/

export function normEmail(e) {
  return String(e || '').trim().toLowerCase()
}

export function validEmail(e) {
  const s = normEmail(e)
  return s.length <= 254 && EMAIL_RE.test(s)
}

/** The domain of an address or a URL, lower-case, without "www.". */
export function domainOf(x) {
  const s = String(x || '').trim().toLowerCase()
  if (!s) return null
  if (s.includes('@') && !s.includes('/')) return s.split('@').pop().replace(/^www\./, '') || null
  try { return new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, '') || null } catch { return null }
}

// ─── hard rules ─────────────────────────────────────────────────────────────

// UK (PECR): cold e-mail only to limited companies and LLPs. HQ's entity_type 'company' covers Ltd / PLC.
export const UK_EMAIL_ENTITIES = ['company', 'limited_company', 'ltd', 'plc', 'llp']
export const NO_EMAIL_ENTITIES = ['sole_trader', 'childminder', 'partnership']
export const MAILABLE_PROSPECT = ['approved', 'found', 'queued', 'contacted']
const STOPPED_PROSPECT = ['replied', 'warm', 'partner', 'opted_out', 'bounced', 'excluded', 'rejected', 'sample']

/**
 * Why this business may not get a first e-mail now (null = it may). ctx:
 *   campaign { stage, channels, market.country }, prospect { status, details.entity_type, klaviyo_profile_id },
 *   contact { email, status, checked_at, mx_ok? }, suppressed: (email, domain) => bool,
 *   otherCampaignWithin30: bool, partnerDomain: bool, stepsSent: n
 */
export function firstEmailBlocked(ctx) {
  const { campaign, prospect, contact } = ctx
  if (!campaign || campaign.stage !== 'live') return 'campaign not live'
  if (!(campaign.channels || []).includes('email')) return 'e-mail is not a channel of this campaign'
  const country = campaign.market && campaign.market.country
  const entity = String((prospect && prospect.details && prospect.details.entity_type) || 'unknown').toLowerCase()
  if (country === 'DE') return 'Germany: never cold e-mail (LinkedIn, phone or post first)'
  if (country === 'GB' && !UK_EMAIL_ENTITIES.includes(entity)) return entity === 'unknown' ? 'UK: entity type unknown, not e-mailed (call or post first)' : `UK: ${entity.replace('_', ' ')}, no cold e-mail (call or post first)`
  if (country === 'IE' && NO_EMAIL_ENTITIES.slice(0, 2).includes(entity)) return `Ireland: ${entity.replace('_', ' ')}, needs consent first`
  if (!prospect || !MAILABLE_PROSPECT.includes(prospect.status)) return `business is ${prospect ? prospect.status : 'missing'}`
  if (prospect.klaviyo_profile_id) return 'already a partner (Klaviyo)'
  if (!contact) return 'no contact'
  if (contact.status !== 'ok') return `contact is ${contact.status}`
  if (!validEmail(contact.email)) return 'address is not valid'
  if (contact.mx_ok === false) return 'the domain has no mail server (MX)'
  const dom = domainOf(contact.email)
  if (ctx.suppressed && ctx.suppressed(normEmail(contact.email), dom)) return 'on the do-not-contact list'
  if (ctx.partnerDomain) return 'the domain belongs to a partner'
  if (ctx.otherCampaignWithin30) return 'e-mailed by another campaign in the last 30 days'
  if ((ctx.stepsSent || 0) > 0) return 'already started'
  return null
}

/**
 * The next follow-up for one business, or null. sent: its sent messages in this campaign (any order);
 * events: their events; gaps: day of each step ({0,4,10}); steps: how many approved e-mails there are.
 * Due when step N was sent >= gap(N+1) - gap(N) days ago, nothing has stopped it, and any auto-reply pause is over.
 */
export function followUpDue({ sent, events = [], gaps, steps, prospect, contact, suppressed, now = new Date() }) {
  const list = (sent || []).filter(m => m.sent_at).sort((a, b) => a.step - b.step)
  if (!list.length) return null
  const last = list[list.length - 1]
  const total = Math.min(MAX_STEPS, steps || 0)
  if (last.step >= total) return null
  if (list.some(m => ['bounced', 'replied', 'stopped'].includes(m.status))) return null
  if (prospect && STOPPED_PROSPECT.includes(prospect.status)) return null
  if (!contact || contact.status !== 'ok') return null
  if (suppressed && suppressed(normEmail(contact.email), domainOf(contact.email))) return null
  const ids = new Set(list.map(m => m.id))
  const mine = events.filter(e => ids.has(e.message_id))
  if (mine.some(e => ['reply', 'bounce_hard', 'optout'].includes(e.kind))) return null
  const g = gaps && gaps.length ? gaps : DEFAULT_GAPS
  const wait = Math.max(1, (g[last.step] ?? g[g.length - 1] + 3) - (g[last.step - 1] ?? 0))
  let dueAt = new Date(last.sent_at).getTime() + wait * DAY
  const auto = mine.filter(e => e.kind === 'auto_reply').map(e => new Date(e.at).getTime()).sort((a, b) => b - a)[0]
  if (auto) dueAt = Math.max(dueAt, auto + AUTO_REPLY_PAUSE_DAYS * DAY)
  if (new Date(now).getTime() < dueAt) return null
  return { step: last.step + 1, first: list[0], due_at: new Date(dueAt).toISOString() }
}

// ─── the approved words ─────────────────────────────────────────────────────

const APPROVED_FAMILY = ['approved', 'approved_with_edits', 'partially_approved']

/** The e-mails a decided b2b_sequence task approves, in order, with the approver's edits: [{ step, id, when, subject, body }]. */
export function approvedEmails(wordsTask) {
  if (!wordsTask || !APPROVED_FAMILY.includes(wordsTask.decision)) return []
  const lines = wordsTask.line_decisions || {}
  const emails = ((wordsTask.artefact && wordsTask.artefact.emails) || []).filter(Boolean)
  const out = []
  for (const e of emails) {
    if (lines[e.id] === 'rejected') continue
    const ed = lines[`${e.id}:edit`] || {}
    out.push({ id: e.id, when: e.when || null, subject: typeof ed.subject === 'string' ? ed.subject : e.subject, body: typeof ed.body === 'string' ? ed.body : e.body })
    if (out.length === MAX_STEPS) break
  }
  return out.map((e, i) => ({ ...e, step: i + 1 }))
}

/** Day of each step from the e-mails' "when" ("Day 0", "4 days later", "day 10"); missing ones follow 0 / 4 / 10. */
export function sendGaps(emails) {
  const out = []
  ;(emails || []).slice(0, MAX_STEPS).forEach((e, i) => {
    const m = /(\d{1,3})/.exec(String((e && e.when) || ''))
    let d = m ? Number(m[1]) : DEFAULT_GAPS[i]
    if (i === 0 && !m) d = 0
    if (i > 0 && d <= out[i - 1]) d = out[i - 1] + (DEFAULT_GAPS[i] - DEFAULT_GAPS[i - 1])
    out.push(d)
  })
  return out
}

// ─── merge fields, body, footer, links ──────────────────────────────────────

const FIRST_NAME = /\[\s*first[ _]name\s*\]/gi

/**
 * Fills [company], [place], [first_name] (also "[first name]"). Without a named contact, "Hi [first_name]," becomes
 * "Hello," and any other [first_name] is dropped. Returns { text, unfilled: [tokens still in brackets] }.
 */
export function fillMerge(text, { company, place, first_name } = {}) {
  let s = String(text || '')
  const name = first_name && String(first_name).trim()
  if (name) s = s.replace(FIRST_NAME, name)
  else {
    s = s.replace(/\b(?:Hi|Hello|Dear|Hey)\s+\[\s*first[ _]name\s*\]/gi, 'Hello')
    s = s.replace(FIRST_NAME, '').replace(/[ \t]{2,}/g, ' ').replace(/ ,/g, ',')
  }
  s = s.replace(/\[\s*company\s*\]/gi, company ? String(company) : 'your business')
  s = s.replace(/\[\s*place\s*\]/gi, place ? String(place) : 'your area')
  const unfilled = [...new Set((s.match(/\[[a-z][a-z _]{1,30}\]/gi) || []))]
  return { text: s, unfilled }
}

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/gi

/**
 * Plain approved words -> HTML paragraphs, every http(s) link rewritten to the click tracker.
 * Returns { html, links: [{ n, url }] }. trackUrl(n) gives the tracker URL for link n (1-based).
 */
export function textToHtml(text, trackUrl) {
  const links = []
  const linkify = (escaped) => escaped.replace(URL_RE, (u) => {
    const raw = u.replace(/&amp;/g, '&')
    let n = links.findIndex(l => l.url === raw) + 1
    if (!n) { links.push({ n: links.length + 1, url: raw }); n = links.length }
    return `<a href="${escapeHtml(trackUrl ? trackUrl(n) : raw)}">${u}</a>`
  })
  const paras = String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const html = paras.map(p => `<p style="margin:0 0 12px">${linkify(escapeHtml(p)).replace(/\n/g, '<br>')}</p>`).join('')
  return { html, links }
}

/** Who we are, why they got it, the privacy notice and the one-click opt-out (every e-mail). */
export function complianceFooter({ company, optOutUrl }) {
  const why = company ? `We found ${escapeHtml(company)} on its website and thought doddl might be useful to you.` : 'We found your business on its website and thought doddl might be useful to you.'
  return [
    '<hr style="border:0;border-top:1px solid #ddd;margin:20px 0 10px">',
    '<p style="margin:0;font-size:12px;color:#666;line-height:1.5">',
    `${why} `,
    `${COMPANY_NAME}, registered in England and Wales, company number ${escapeHtml(COMPANY_NUMBER)}, registered office ${escapeHtml(REGISTERED_ADDRESS)}. `,
    `How we use your details: <a href="${escapeHtml(PRIVACY_URL)}">privacy notice</a>. `,
    `Don’t want to hear from us? <a href="${escapeHtml(optOutUrl)}">Unsubscribe in one click</a> or reply “stop”.`,
    '</p>',
  ].join('')
}

/**
 * The whole e-mail for one business and step. Throws (status 422) on an unfilled merge field. base = the PM's
 * public URL; token = this message's tracking token.
 */
export function buildMessage({ email, prospect, contact, mailbox, base, token, trackOpens }) {
  const fields = { company: prospect && prospect.name, place: prospect && prospect.place, first_name: contact && contact.type === 'named' ? contact.first_name : null }
  const subj = fillMerge(email.subject, fields)
  const body = fillMerge(email.body, fields)
  const unfilled = [...new Set([...subj.unfilled, ...body.unfilled])]
  if (unfilled.length) {
    const e = new Error(`The approved words still have ${unfilled.join(', ')} after filling: fix the words before this can send`)
    e.status = 422
    e.expose = true
    throw e
  }
  const { html, links } = textToHtml(body.text, (n) => `${base}/api/t/c/${token}/${n}`)
  const sig = mailbox && mailbox.signature_html ? `<div style="margin:16px 0 0">${mailbox.signature_html}</div>` : ''
  const pixel = trackOpens ? `<img src="${base}/api/t/o/${token}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : ''
  const footer = complianceFooter({ company: prospect && prospect.name, optOutUrl: `${base}/api/t/u/${token}` })
  return {
    subject: subj.text.replace(/\s+/g, ' ').trim(),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${html}${sig}${footer}${pixel}</div>`,
    links,
  }
}

/** The stored URL for link n of a message, or null (the click redirect never goes anywhere else). */
export function linkTarget(links, n) {
  const k = Number(n)
  if (!Number.isInteger(k) || k < 1) return null
  const hit = (Array.isArray(links) ? links : []).find(l => l && Number(l.n) === k)
  if (!hit || typeof hit.url !== 'string' || !/^https?:\/\//i.test(hit.url)) return null
  return hit.url
}

// ─── link scanners ──────────────────────────────────────────────────────────

const SCANNER_UA = /(safelinks|microsoft office|ms-office|mimecast|proofpoint|barracuda|symantec|messagelabs|forcepoint|trend ?micro|sophos|fortiguard|cisco|ironport|zscaler|google-safety|googleimageproxy|bingpreview|slackbot|linkedinbot|facebookexternalhit|preview|scanner|crawler|spider|bot\b|python-requests|curl\/|wget|go-http-client|java\/|okhttp|headlesschrome|phantomjs)/i

/** A click that is really a mail security scanner: HEAD, within 60 s of sending, or a known scanner user agent. */
export function isScanner({ method, userAgent, sentAt, now = new Date() }) {
  if (String(method || 'GET').toUpperCase() === 'HEAD') return true
  if (!userAgent || SCANNER_UA.test(userAgent)) return true
  if (sentAt && new Date(now).getTime() - new Date(sentAt).getTime() < 60_000) return true
  return false
}

// ─── inbound mail: bounce, auto-reply, reply ────────────────────────────────

const NDR_FROM = /^(postmaster|mailer-daemon|microsoftexchange[0-9a-f]*|mail-?daemon|bounces?)@/i
const NDR_SUBJECT = /^(undeliverable|undelivered|delivery status notification|delivery has failed|mail delivery (failed|failure|subsystem)|returned mail|failure notice|non[- ]?delivery|unzustellbar|non remis|delivery failure)/i
const AUTO_SUBJECT = /^(automatic reply|auto(?:matic)?[- ]?(?:reply|response)|out of (?:the )?office|ooo\b|abwesenheitsnotiz|automatische antwort|réponse automatique|absence|on leave|away from)/i

function header(headers, name) {
  const h = (headers || []).find(x => x && String(x.name).toLowerCase() === name)
  return h ? String(h.value || '') : ''
}

/** The enhanced status code in an NDR ("5.1.1") and whether it is hard (5.x.x) or soft (4.x.x). */
export function parseNdr(text) {
  const s = String(text || '')
  const m = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/.exec(s)
  if (m) return { code: `${m[1]}.${m[2]}.${m[3]}`, hard: m[1] === '5' }
  const smtp = /\b([45])\d\d\b/.exec(s)
  if (smtp && /(mailbox|recipient|user|address|delivery)/i.test(s)) return { code: smtp[0], hard: smtp[1] === '5' }
  if (/(temporar|delay|deferred|will (?:retry|try again)|mailbox (?:is )?full|over quota)/i.test(s)) return { code: null, hard: false }
  return { code: null, hard: true }
}

/** Only the sender's own words: quoted history ("On … wrote:", "From:", "> …", "-----Original Message-----") removed. */
export function stripQuoted(text) {
  const s = String(text || '').replace(/\r\n/g, '\n')
  const cut = s.search(/^\s*(?:On .{4,120}wrote:|-{2,}\s*Original Message\s*-{2,}|From:\s.+|Sent from my |_{10,}|Le .{4,80} a écrit|Am .{4,80} schrieb)/im)
  const own = (cut >= 0 ? s.slice(0, cut) : s).split('\n').filter(l => !/^\s*>/.test(l)).join('\n')
  return own.replace(/\n{3,}/g, '\n\n').trim()
}

const REDACT_EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi
const REDACT_PHONE = /(?:\+?\d[\s().-]?){9,}\d/g
export function redact(text) {
  return String(text || '').replace(REDACT_EMAIL, '[e-mail]').replace(REDACT_PHONE, '[phone]')
}

// Ported from HQ src/b2b-campaigns/replies.ts (RULES), order matters: opt-out first.
const REPLY_RULES = [
  ['optout', /\b(?:unsubscribe|remove (?:me|us)|take (?:me|us) off|stop (?:emailing|contacting|sending)|do not (?:contact|email)|don't (?:contact|email)|no more emails|opt(?:ed)?[- ]out)\b|^\s*stop\s*[.!]?\s*$/im],
  ['ooo', /\b(?:out of (?:the )?office|on (?:annual )?leave|on holiday|away until|back on|automatic reply|auto-?reply|abwesend|absent jusqu)\b/i],
  ['negative', /\b(?:not interested|no thank(?:s| you)|we(?:'re| are) (?:all )?(?:set|happy with)|not (?:for us|at this time|right now)|already have a supplier|no need)\b/i],
  ['owner', /\b(?:speak (?:to|with) (?:the )?(?:owner|director|founder|jon)|bulk order|order (?:for|in) bulk|for (?:all|every) (?:our|of our) (?:rooms|sites|nurseries|shops|children)|(?:\d{2,}|hundreds of) sets|pricing for \d+|(?:contact|try|email|speak to) (?:our|my) (?:manager|owner|director|buyer|colleague)|i'?m not the right person|not the right person|wrong person)\b/i],
  ['positive', /\b(?:yes(?: please)?|sounds (?:good|great|lovely)|we(?:'d| would) (?:love|like)|interested|please send|send (?:us |me )?(?:one|a set|the set|a sample|the trade pack|a trade pack|prices|your prices)|trade pack|happy to (?:try|chat|talk)|let's talk|book a call)\b/i],
  ['question', /\?|\b(?:how much|what is the price|do you|can you|could you|is it|are they)\b/i],
]

/** The reply's kind (optout | ooo | negative | owner | positive | question) and a one-line summary, contact details removed. */
export function classifyReply(text) {
  const own = redact(stripQuoted(text)).replace(/\s+/g, ' ').trim()
  const kind = (REPLY_RULES.find(([, re]) => re.test(own)) || ['question'])[0]
  const summary = own ? `${kind === 'question' && !/\?/.test(own) ? 'Unclear reply' : 'Reply'}: “${own.slice(0, 220)}${own.length > 220 ? '…' : ''}”` : 'A reply with no text PM could read.'
  return { kind, summary }
}

/**
 * What an inbound message is: { type: 'bounce', hard, code } | { type: 'auto_reply' } | { type: 'reply', kind, summary }.
 * m: { from (address), fromName, subject, headers: [{name, value}], text }.
 */
export function classifyInbound(m) {
  const from = normEmail(m && m.from)
  const subject = String((m && m.subject) || '').trim()
  const text = String((m && m.text) || '')
  const ctype = header(m && m.headers, 'content-type')
  if (NDR_FROM.test(from) || /mail delivery (system|subsystem)/i.test((m && m.fromName) || '') || NDR_SUBJECT.test(subject) || /report-type=delivery-status/i.test(ctype)) {
    const ndr = parseNdr(text)
    return { type: 'bounce', hard: ndr.hard, code: ndr.code }
  }
  const auto = header(m && m.headers, 'auto-submitted').toLowerCase()
  if ((auto && auto !== 'no') || header(m && m.headers, 'x-autoreply') || header(m && m.headers, 'x-autorespond') || /auto[_-]?reply/i.test(header(m && m.headers, 'precedence')) || AUTO_SUBJECT.test(subject)) {
    return { type: 'auto_reply' }
  }
  const r = classifyReply(text)
  if (r.kind === 'ooo') return { type: 'auto_reply' }
  return { type: 'reply', kind: r.kind, summary: r.summary }
}

/** In-Reply-To and References ids of an inbound message. */
export function referencedIds(headers) {
  const all = `${header(headers, 'in-reply-to')} ${header(headers, 'references')}`
  return [...new Set(all.match(/<[^<>\s]+>/g) || [])]
}

// ─── health ─────────────────────────────────────────────────────────────────

export const HEALTH = { minSends: 20, window: 100, bounceRate: 0.05, hardPerDay: 3, complaintRate: 0.05 }

/** Why a mailbox should pause (null = healthy). last: its last <=100 sent messages { hard: bool }; hardToday: n. */
export function mailboxPauseReason({ last = [], hardToday = 0 }) {
  if (hardToday >= HEALTH.hardPerDay) return `${hardToday} hard bounces today`
  const sample = last.slice(0, HEALTH.window)
  const hard = sample.filter(m => m.hard).length
  if (sample.length >= HEALTH.minSends && hard / sample.length > HEALTH.bounceRate) return `hard-bounce rate ${Math.round((hard / sample.length) * 100)}% over the last ${sample.length} sends`
  return null
}

/** Why a campaign should pause: opt-outs + negative replies over its last <=100 sends above 5%. */
export function campaignPauseReason({ sends = 0, optouts = 0, negatives = 0 }) {
  const n = Math.min(sends, HEALTH.window)
  if (n < HEALTH.minSends) return null
  const bad = optouts + negatives
  return bad / n > HEALTH.complaintRate ? `opt-outs and "not interested" replies are ${Math.round((bad / n) * 100)}% of the last ${n} sends` : null
}

// ─── report ─────────────────────────────────────────────────────────────────

function weekStart(date) {
  const d = new Date(`${date}T12:00:00Z`)
  const wd = (d.getUTCDay() + 6) % 7
  return new Date(d.getTime() - wd * DAY).toISOString().slice(0, 10)
}

export function periodKey(at, by) {
  if (!at) return null
  const date = localParts(at).date
  return by === 'day' ? date : by === 'week' ? weekStart(date) : 'all'
}

const rate = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null)

function emptyRow(period) {
  return { period, sent: 0, sent_by_step: { 1: 0, 2: 0, 3: 0 }, delivered: 0, bounces_hard: 0, bounces_soft: 0, bounce_rate: null, opens: 0, clicks: 0, click_rate: null,
    replies: { positive: 0, question: 0, owner: 0, negative: 0, optout: 0 }, replies_total: 0, reply_rate: null, auto_replies: 0, optouts: 0, optout_rate: null }
}

/**
 * The outreach report. messages: [{ id, step, sent_at, status, opens_tracked }], events: [{ message_id, kind, at }],
 * replies: [{ kind, created_at }]. by: day | week | all. Opens are null ("not measured") unless some message tracked them.
 */
export function buildReport({ messages = [], events = [], replies = [], by = 'all' }) {
  const rows = new Map()
  const row = (k) => { if (!rows.has(k)) rows.set(k, emptyRow(k)); return rows.get(k) }
  const total = emptyRow('total')
  const opensMeasured = messages.some(m => m.opens_tracked)
  const seen = { open: new Map(), click: new Map() }
  for (const m of messages) {
    if (!m.sent_at) continue
    for (const r of [row(periodKey(m.sent_at, by)), total]) { r.sent++; r.sent_by_step[m.step] = (r.sent_by_step[m.step] || 0) + 1 }
  }
  for (const e of events) {
    const k = periodKey(e.at, by)
    for (const [r, key] of [[row(k), k], [total, 'total']]) {
      if (e.kind === 'bounce_hard') r.bounces_hard++
      else if (e.kind === 'bounce_soft') r.bounces_soft++
      else if (e.kind === 'auto_reply') r.auto_replies++
      else if (e.kind === 'optout') r.optouts++
      else if (e.kind === 'open' || e.kind === 'click') {
        const s = seen[e.kind].get(key) || new Set()
        if (!s.has(e.message_id)) { s.add(e.message_id); r[e.kind === 'open' ? 'opens' : 'clicks']++ }
        seen[e.kind].set(key, s)
      }
    }
  }
  for (const rp of replies) {
    if (!['positive', 'question', 'owner', 'negative', 'optout'].includes(rp.kind)) continue
    for (const r of [row(periodKey(rp.created_at, by)), total]) { r.replies[rp.kind]++; r.replies_total++ }
  }
  const finish = (r) => {
    r.delivered = Math.max(0, r.sent - r.bounces_hard)
    r.bounce_rate = rate(r.bounces_hard, r.sent)
    r.click_rate = rate(r.clicks, r.delivered)
    r.reply_rate = rate(r.replies_total, r.delivered)
    r.optout_rate = rate(r.optouts, r.delivered)
    if (!opensMeasured) r.opens = null
    return r
  }
  const list = [...rows.values()].filter(r => r.period).sort((a, b) => (a.period < b.period ? -1 : 1)).map(finish)
  return { by, opens_measured: opensMeasured, rows: by === 'all' ? [] : list, total: finish(total) }
}

/** The funnel from prospect statuses and contacts: found -> contactable -> e-mailed -> replied -> warm -> partner. */
export function funnel({ prospects = [], emailedIds = new Set(), repliedIds = new Set() }) {
  const live = prospects.filter(p => !['sample', 'rejected', 'excluded'].includes(p.status))
  return {
    found: live.length,
    contactable: live.filter(p => p.contact && p.contact.has_contact).length,
    emailed: live.filter(p => emailedIds.has(p.id)).length,
    replied: live.filter(p => repliedIds.has(p.id) || ['replied', 'warm', 'partner'].includes(p.status)).length,
    warm: live.filter(p => ['warm', 'partner'].includes(p.status)).length,
    partner: live.filter(p => p.status === 'partner').length,
  }
}
