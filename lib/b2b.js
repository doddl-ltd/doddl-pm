// B2B campaigns (docs/b2b-campaigns/CONTRACT.md): names, fixed tables and the pure rules, shared by the
// server (lib/pm/b2b.js, the decide hook) and the screens (components/b2b/*). No database, no React.
//
// The rules here are unit-tested (test/b2b.test.mjs): how a decision moves a campaign, what a sample decision
// must carry, which prospect statuses the lines set, what HQ learns from reject reasons, and the 7-step track.

export const STAGES = ['draft', 'define_review', 'sampling', 'sample_review', 'finding', 'words_review', 'golive_review', 'live', 'paused', 'done', 'cancelled']
export const ACTIVE_STAGES = ['define_review', 'sampling', 'sample_review', 'finding', 'words_review', 'golive_review', 'live']
export const TERMINAL_STAGES = ['done', 'cancelled']
export const PROSPECT_STATUSES = ['sample', 'approved', 'rejected', 'found', 'queued', 'contacted', 'replied', 'warm', 'partner', 'opted_out', 'bounced', 'excluded']
export const CONTACT_TYPES = ['named', 'generic', 'none']
export const REPLY_KINDS = ['positive', 'question', 'owner', 'ooo', 'negative', 'optout', 'bounce']
export const REPLY_STATUSES = ['needs_person', 'sent', 'closed', 'auto']
// Replies HQ handles with no person (contract: opt-outs and bounces; out-of-office and "not interested" too, per board B2BFlow).
export const AUTO_REPLY_KINDS = ['ooo', 'negative', 'optout', 'bounce']
export const B2B_TYPES = ['b2b_definition', 'b2b_sample', 'b2b_sequence', 'b2b_golive']
export const B2B_AREA = 'outreach'

// The project every B2B approval task lives in (seeded by migration 26).
export const B2B_PROJECT_ID = '10000000-0000-0000-0000-000000000b2b'

export const GOALS = [
  { id: 'trial', name: 'Trial orders', desc: 'They try a free set or a trial pack first.', measure: 'Trial packs ordered' },
  { id: 'stock', name: 'New stockists', desc: 'They place a wholesale order to sell doddl.', measure: 'New stockists' },
  { id: 'calls', name: 'Intro calls', desc: 'A first call to explore a partnership.', measure: 'Intro calls held' },
  { id: 'deal', name: 'A distribution deal', desc: 'A signed agreement to cover a country or channel.', measure: 'Deals signed' },
  { id: 'refer', name: 'Referrals', desc: 'They recommend doddl to the families they support.', measure: 'Settings sharing the code' },
  { id: 'bulk', name: 'Bulk orders', desc: 'A set for every child, room or table.', measure: 'Bulk orders' },
]
export const GOAL_IDS = GOALS.map(g => g.id)

export const OFFERS = [
  { id: 'sample', name: 'A free sample set', desc: 'One set to try in a room, shop or clinic.' },
  { id: 'trade', name: 'Trade or bulk price', desc: 'A price per set at volume, from the pricing sheet.' },
  { id: 'starter', name: 'A starter pack', desc: 'A mixed first order with display material.' },
  { id: 'code', name: 'A code for their families', desc: 'A discount the business can share with parents.' },
  { id: 'call', name: 'An intro call with Jon', desc: 'Margins, terms and how doddl supports partners.' },
]
export const OFFER_IDS = OFFERS.map(o => o.id)

export const CHANNELS = [
  { id: 'email', name: 'Email sequence', desc: 'Sent by doddl PM from a connected trade mailbox (Microsoft 365), at the approved pace. Never Klaviyo: it only allows people who signed up to doddl.' },
  { id: 'linkedin', name: 'LinkedIn message', desc: 'HQ drafts; a person sends it from their own profile.' },
  { id: 'phone', name: 'Phone call', desc: 'A person calls warm replies only.' },
  { id: 'post', name: 'Sample in the post', desc: 'Sent only after they say yes, with a short letter.' },
]
export const CHANNEL_IDS = CHANNELS.map(c => c.id)

// Country rules: a fixed table in PM that matches HQ's config/outreach.yaml country_rules (code, not prompt).
// PM only shows them; HQ enforces them.
// market.regions and market.places are HARD filters: an empty list means the whole country.
// A business outside the chosen regions or places is never in the sample or the list.
export function areaText(market) {
  const c = market && market.country ? COUNTRIES[market.country] : null
  if (!c) return '–'
  const parts = [...(market.regions || []), ...(market.places || [])]
  return parts.length ? `${c.name}: only ${parts.join(', ')}` : `${c.name}: the whole country`
}

export const COUNTRIES = {
  GB: {
    name: 'UK', label: 'United Kingdom', language: 'English', regionWord: 'region', whole: 'England, Scotland, Wales and Northern Ireland',
    regions: ['North East', 'North West', 'Yorkshire and the Humber', 'East Midlands', 'West Midlands', 'East of England', 'London', 'South East', 'South West', 'Scotland', 'Wales', 'Northern Ireland'],
    excluded: 'Sole traders and childminders (need consent first)',
    rules: [
      'Companies and partnerships only by email; sole traders and childminders need their consent first.',
      'Say who we are, and offer a one-click opt-out in every email.',
      'At most 3 emails, then stop. Opt-outs are never contacted again.',
    ],
  },
  FR: {
    name: 'France', label: 'France', language: 'French, checked by a French speaker', regionWord: 'region', whole: 'All of mainland France and Corsica',
    regions: ['Île-de-France', 'Auvergne-Rhône-Alpes', 'Provence-Alpes-Côte d’Azur', 'Occitanie', 'Nouvelle-Aquitaine', 'Hauts-de-France', 'Grand Est', 'Bretagne', 'Normandie', 'Pays de la Loire', 'Centre-Val de Loire', 'Bourgogne-Franche-Comté', 'Corse'],
    excluded: 'Businesses outside the chosen activity codes',
    rules: [
      'Business email only, about something relevant to the person’s job.',
      'Clear opt-out in every message, honoured at once.',
      'Written in French; at most 3 emails and 1 LinkedIn message.',
    ],
  },
  DE: {
    name: 'Germany', label: 'Germany', language: 'German, checked by a German speaker', regionWord: 'state', whole: 'All 16 states',
    regions: ['Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen', 'Mecklenburg-Vorpommern', 'Niedersachsen', 'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Saarland', 'Sachsen', 'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen'],
    excluded: 'Businesses with no imprint (Impressum) contact',
    no_cold_email: true,
    rules: [
      'Cold email to businesses is tightly limited in Germany: first contact by LinkedIn, phone or post, never cold email; email only once they agree.',
      'Opt-out honoured at once.',
    ],
  },
  IE: {
    name: 'Ireland', label: 'Ireland', language: 'English', regionWord: 'province', whole: 'The whole Republic of Ireland',
    regions: ['Leinster', 'Munster', 'Connacht', 'Ulster (Cavan, Donegal, Monaghan)'],
    excluded: 'Sole traders (need consent first)',
    rules: [
      'Companies only by email; sole traders need consent.',
      'Opt-out in every email; at most 3 emails.',
    ],
  },
  US: {
    name: 'US', label: 'United States', language: 'US English', regionWord: 'state', whole: 'All 50 states and DC',
    regions: ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'],
    excluded: 'Businesses with no physical address',
    rules: [
      'Include our postal address and an opt-out in every email; honour opt-outs within 10 days.',
      'No misleading subject lines; at most 3 emails.',
    ],
  },
}
export const COUNTRY_CODES = Object.keys(COUNTRIES)

// Rules for every campaign, every market (contract: hard rules).
export const ALWAYS_RULES = [
  'At most 3 touches per contact across all agents; no new enrolment within 30 days. One do-not-contact list covers every campaign.',
  'Sent by doddl PM from a connected Microsoft 365 trade mailbox. Klaviyo is never used for cold outreach; a business moves to Klaviyo only once it asks for more.',
  'Copy mentions only the offers in this definition; prices come from the pricing sheet.',
]

export function countryRules(code) {
  const c = COUNTRIES[code]
  return c ? [...c.rules] : []
}

// Sample reject reasons (line_decisions["<id>:reason"]) and the rule each one suggests ("What HQ learns").
export const SAMPLE_REASONS = [
  { id: 'too_small', label: 'Too small', suggests: 'Raise the minimum size' },
  { id: 'chain_head_office', label: 'Chain head office', suggests: 'Leave out large groups and head offices' },
  { id: 'wrong_type', label: 'Wrong type', suggests: 'Tighten which kinds of business are included' },
  { id: 'no_meals', label: 'No meals on site', suggests: 'Make "serves meals on site" a must-have, checked on the website' },
  { id: 'other', label: 'Other', suggests: 'Ask you before applying' },
]
export const SAMPLE_REASON_IDS = SAMPLE_REASONS.map(r => r.id)
export const REASON_LABEL = Object.fromEntries(SAMPLE_REASONS.map(r => [r.id, r.label]))

// The 7-step track on the campaigns list (board B2BCampaigns).
export const TRACK = ['Define', 'Find a sample', 'Approve sample', 'Find the rest', 'Words', 'Flow', 'Live']

// The wizard's steps (board B2BCreate).
export const WIZARD_STEPS = ['Business type', 'Goal and offer', 'Market and how many', 'Channels and rules', 'Check and send']

// The definition card's "what happens next" steps (board B2BDefine), fixed labels.
export const DEFINE_GATES = [
  { who: 'you', label: 'You approve this definition' },
  { who: 'hq', label: 'HQ finds a sample' },
  { who: 'you', label: 'You tick or reject the sample' },
  { who: 'hq', label: 'HQ finds the rest and drafts the words' },
  { who: 'you', label: 'You approve the emails and the flow' },
  { who: 'you', label: 'You press go' },
]

const APPROVED_FAMILY = ['approved', 'approved_with_edits', 'partially_approved']
const POSITIVE_LINES = ['approved', 'edited', 'edit', 'push']
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const subKey = (k) => typeof k === 'string' && k.includes(':')

export function b2bError(status, message) {
  const e = new Error(message)
  e.status = status
  e.expose = true
  return e
}

// ─── stage transitions ──────────────────────────────────────────────────────

/**
 * Where a campaign goes when one of its approvals is decided (contract, "Decisions"):
 *   definition approved -> sampling; definition rejected -> cancelled
 *   sample approved / partly approved -> finding
 *   sequence approved -> unchanged (HQ posts go-live next)
 *   go-live approved -> live
 *   any send back, reject or expiry otherwise -> the stage stays at its review step until resubmitted
 * Returns the new stage, or null for "no change". A campaign that has moved on (paused, cancelled, done)
 * is never moved by a late decision.
 */
export function stageAfterDecision(artefactType, decision, currentStage) {
  const expect = { b2b_definition: 'define_review', b2b_sample: 'sample_review', b2b_sequence: 'words_review', b2b_golive: 'golive_review' }[artefactType]
  if (!expect || currentStage !== expect) return null
  const yes = APPROVED_FAMILY.includes(decision)
  switch (artefactType) {
    case 'b2b_definition': return yes ? 'sampling' : decision === 'rejected' ? 'cancelled' : null
    case 'b2b_sample': return yes ? 'finding' : null
    case 'b2b_sequence': return null
    case 'b2b_golive': return yes ? 'live' : null
    default: return null
  }
}

/** Which stages may an agent post each approval from (and what it moves the campaign to). */
export const AGENT_POSTS = {
  sample: { type: 'b2b_sample', from: ['sampling', 'sample_review'], to: 'sample_review', fk: 'sample_task_id' },
  sequence: { type: 'b2b_sequence', from: ['finding', 'words_review'], to: 'words_review', fk: 'words_task_id' },
  golive: { type: 'b2b_golive', from: ['words_review', 'golive_review'], to: 'golive_review', fk: 'golive_task_id' },
}

/**
 * May an agent post this approval now? From the campaign's stage and the current approval of that kind
 * (null, or { decision }). A review stage accepts a resubmission only once its pending card is closed
 * (sent back, rejected or expired). Go-live needs the words approved first. Returns an error string or null.
 */
export function postBlocked(kind, campaign, current, wordsTask = null) {
  const p = AGENT_POSTS[kind]
  if (!p) return `Unknown post ${kind}`
  if (!p.from.includes(campaign.stage)) return `The campaign is at "${campaign.stage}"; a ${kind} can be posted only at ${p.from.join(' or ')}`
  if (campaign.stage === p.to && current && !current.decision) return `A ${kind} approval is already waiting (task ${current.id}); wait for the decision`
  if (campaign.stage === p.to && current && APPROVED_FAMILY.includes(current.decision) && kind !== 'sequence') return `The ${kind} is already approved`
  if (kind === 'golive') {
    if (!wordsTask || !APPROVED_FAMILY.includes(wordsTask.decision)) return 'The emails and flow must be approved before go-live'
  }
  if (kind === 'sequence' && campaign.stage === 'words_review' && current && APPROVED_FAMILY.includes(current.decision)) return 'The emails and flow are already approved; post the go-live'
  return null
}

/** Stages an agent may set directly through PATCH /api/agent/b2b/campaigns/:id. */
export const AGENT_STAGE_MOVES = { live: ['done'] }

/** What a person may do to a campaign through PATCH (pause / resume / cancel). */
export function personAction(action, campaign) {
  const s = campaign.stage
  if (action === 'pause') {
    if (!ACTIVE_STAGES.includes(s)) throw b2bError(409, `A campaign at "${s}" cannot be paused`)
    return { stage: 'paused', paused_from: s }
  }
  if (action === 'resume') {
    if (s !== 'paused') throw b2bError(409, 'Only a paused campaign can be resumed')
    return { stage: campaign.paused_from && STAGES.includes(campaign.paused_from) ? campaign.paused_from : 'live', paused_from: null }
  }
  if (action === 'cancel') {
    if (TERMINAL_STAGES.includes(s)) throw b2bError(409, `The campaign is already ${s}`)
    return { stage: 'cancelled', paused_from: null }
  }
  throw b2bError(400, 'action must be pause, resume or cancel')
}

/** A person can edit the draft (and resubmit it) while it is a draft, or once its definition card was sent back or expired. */
export function draftEditable(campaign, definitionTask = null) {
  if (campaign.stage === 'draft') return true
  if (campaign.stage === 'define_review' && definitionTask && ['revision_requested', 'expired'].includes(definitionTask.decision)) return true
  return false
}

// ─── decisions on b2b approvals ─────────────────────────────────────────────

/**
 * Extra checks on a vote for a B2B approval, after the generic validateVote (lib/pm/approvals.js):
 *   b2b_sample: every rejected line needs "<id>:reason" from SAMPLE_REASONS ("other" also wants "<id>:note");
 *               reasons and notes only on rejected lines
 *   b2b_sequence: "<id>:edit" is { subject?, body? } with strings
 *   other sub-keys (":reason", ":note") are refused on the other types
 * Send-backs and rejections skip the per-line reason rule (nothing runs).
 */
export function validateB2BVote(artefactType, vote) {
  const decidingYes = APPROVED_FAMILY.includes(vote && vote.vote)
  // Go-live: the approver chooses the trade mailbox(es) the campaign sends from (decision edits { mailbox_ids, pace? }).
  if (artefactType === 'b2b_golive' && decidingYes) {
    const ids = vote.edits && Array.isArray(vote.edits.mailbox_ids) ? vote.edits.mailbox_ids : []
    if (!ids.length) throw b2bError(400, 'Choose at least one outreach mailbox to send from')
    if (ids.length > 20 || ids.some(x => typeof x !== 'string' || !/^[0-9a-f-]{36}$/i.test(x))) throw b2bError(400, 'mailbox_ids must be mailbox UUIDs')
    const extra = Object.keys(vote.edits).filter(k => !['mailbox_ids', 'pace'].includes(k))
    if (extra.length) throw b2bError(400, `A go-live takes only mailbox_ids and pace (not ${extra.join(', ')})`)
  }
  const lines = vote && vote.lines ? vote.lines : null
  if (!lines) return vote
  for (const [k, v] of Object.entries(lines)) {
    if (!subKey(k)) continue
    const [id, part] = [k.slice(0, k.lastIndexOf(':')), k.slice(k.lastIndexOf(':') + 1)]
    if (part === 'reason' || part === 'note') {
      if (artefactType !== 'b2b_sample') throw b2bError(400, `"${k}": reasons go only on sample lines`)
      if (lines[id] !== 'rejected') throw b2bError(400, `"${k}": a reason goes only on a rejected line`)
      if (part === 'reason' && !SAMPLE_REASON_IDS.includes(v)) throw b2bError(400, `"${k}" must be one of ${SAMPLE_REASON_IDS.join(', ')}`)
      if (part === 'note' && (typeof v !== 'string' || v.length > 500)) throw b2bError(400, `"${k}" must be text (max 500 characters)`)
    }
    if (part === 'edit' && artefactType === 'b2b_sequence') {
      if (!isObj(v) || !Object.keys(v).length || Object.keys(v).some(x => !['subject', 'body'].includes(x)) || Object.values(v).some(x => typeof x !== 'string')) {
        throw b2bError(400, `"${k}" must be { subject?, body? } with text`)
      }
    }
  }
  if (artefactType === 'b2b_sample' && decidingYes) {
    const missing = Object.entries(lines).filter(([k, v]) => !subKey(k) && v === 'rejected' && !lines[`${k}:reason`]).map(([k]) => k)
    if (missing.length) throw b2bError(400, `Say why for every unticked business (${missing.length} without a reason: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''})`)
    const otherNoNote = Object.entries(lines).filter(([k, v]) => k.endsWith(':reason') && v === 'other' && !String(lines[`${k.slice(0, -7)}:note`] || '').trim()).map(([k]) => k.slice(0, -7))
    if (otherNoNote.length) throw b2bError(400, `"Other" needs a few words saying why (${otherNoNote.join(', ')})`)
  }
  return vote
}

/**
 * Prospect statuses from a decided sample: { approved: [ids], rejected: [{ id, reason, note }] }.
 * Lines not mentioned count as approved when the whole sample was approved (the card ticks every row by default).
 */
export function sampleOutcome(lineIds, lineDecisions, decision) {
  const lines = lineDecisions || {}
  const out = { approved: [], rejected: [] }
  if (!APPROVED_FAMILY.includes(decision) && decision !== 'rejected') return out
  for (const id of lineIds) {
    const v = lines[id]
    if (v === 'rejected' || (v == null && decision === 'rejected')) out.rejected.push({ id, reason: lines[`${id}:reason`] || null, note: lines[`${id}:note`] || null })
    else if (POSITIVE_LINES.includes(v) || v == null) out.approved.push(id)
  }
  return out
}

/** "What HQ learns" preview: one suggested rule per reason used, with how many rejections it came from. */
export function learnPreview(lineDecisions, noun = 'business') {
  const counts = {}
  for (const [k, v] of Object.entries(lineDecisions || {})) {
    if (!k.endsWith(':reason')) continue
    const id = k.slice(0, -7)
    if (lineDecisions[id] !== 'rejected') continue
    counts[v] = (counts[v] || 0) + 1
  }
  const plural = /(s|x|ch|sh)$/.test(noun) ? `${noun}es` : /[^aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`
  return SAMPLE_REASONS.filter(r => counts[r.id]).map(r => ({
    reason: r.id, count: counts[r.id], rule: r.suggests,
    from: `From ${counts[r.id]} ${counts[r.id] === 1 ? noun : plural} you rejected as “${r.label}”`,
  }))
}

// ─── the track and the "next" chip ──────────────────────────────────────────

/**
 * The 7 steps for a campaign: [{ label, state: done|now|wait|todo }]. tasks: { definition, sample, words, golive }
 * (each null or { decision }). A paused campaign shows the track of the stage it was paused at.
 */
export function trackFor(campaign, tasks = {}) {
  const stage = campaign.stage === 'paused' ? (campaign.paused_from || 'live') : campaign.stage
  const st = (states) => TRACK.map((label, i) => ({ label, state: states[i] }))
  const yes = (t) => !!(t && APPROVED_FAMILY.includes(t.decision))
  switch (stage) {
    case 'draft': return st(['now', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo'])
    case 'define_review': return st(['wait', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo'])
    case 'sampling': return st(['done', 'now', 'todo', 'todo', 'todo', 'todo', 'todo'])
    case 'sample_review': return st(['done', 'done', 'wait', 'todo', 'todo', 'todo', 'todo'])
    case 'finding': return st(['done', 'done', 'done', 'now', 'todo', 'todo', 'todo'])
    case 'words_review': return yes(tasks.words)
      ? st(['done', 'done', 'done', 'done', 'done', 'done', 'now'])
      : st(['done', 'done', 'done', 'done', 'wait', 'wait', 'todo'])
    case 'golive_review': return st(['done', 'done', 'done', 'done', 'done', 'done', 'wait'])
    case 'live': return st(['done', 'done', 'done', 'done', 'done', 'done', 'now'])
    case 'done': return st(['done', 'done', 'done', 'done', 'done', 'done', 'done'])
    default: return st(['todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo'])
  }
}

/** The chip on the right of a campaign row: { text, tone: wait|bad|ok|info|muted }. */
export function nextChip(campaign, { repliesWaiting = 0, words = null, approver = null } = {}) {
  const who = approver || campaign.approver || 'the approver'
  switch (campaign.stage) {
    case 'draft': return { text: 'Draft: finish and send', tone: 'muted' }
    case 'define_review': return { text: `Definition waiting for ${who}`, tone: 'wait' }
    case 'sampling': return { text: 'HQ is finding a sample', tone: 'info' }
    case 'sample_review': return { text: `Sample list waiting for ${who}`, tone: 'wait' }
    case 'finding': return { text: 'HQ is finding the rest', tone: 'info' }
    case 'words_review': return words && APPROVED_FAMILY.includes(words.decision) ? { text: 'HQ is preparing go-live', tone: 'info' } : { text: `Emails and flow waiting for ${who}`, tone: 'wait' }
    case 'golive_review': return { text: `Go-live waiting for ${who}`, tone: 'wait' }
    case 'live': return repliesWaiting ? { text: `${repliesWaiting} ${repliesWaiting === 1 ? 'reply needs' : 'replies need'} a person`, tone: 'bad' } : { text: 'Live', tone: 'ok' }
    case 'paused': return { text: 'Paused', tone: 'muted' }
    case 'done': return { text: 'Finished', tone: 'ok' }
    case 'cancelled': return { text: 'Cancelled', tone: 'muted' }
    default: return { text: campaign.stage, tone: 'muted' }
  }
}

// ─── replies: when a person must answer ─────────────────────────────────────

const LONDON_PARTS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', hourCycle: 'h23' })
function londonDayHour(d) {
  const p = Object.fromEntries(LONDON_PARTS.formatToParts(d).map(x => [x.type, x.value]))
  return { weekday: p.weekday, hour: Number(p.hour) }
}

/**
 * When a reply needing a person is due: "owner" (wants the owner, bulk, terms) the same working day, or the
 * next if it came in after 15:00 UK; everything else within 1 working day (board B2BFlow). Weekends skipped.
 */
export function replyDueAt(kind, receivedAt = new Date()) {
  const H = 3600_000
  const start = new Date(receivedAt)
  const isWeekend = (d) => ['Sat', 'Sun'].includes(londonDayHour(d).weekday)
  let due = new Date(start.getTime() + (kind === 'owner' ? (londonDayHour(start).hour < 15 ? 3 : 24) : 24) * H)
  while (isWeekend(due)) due = new Date(due.getTime() + 24 * H)
  return due
}

// ─── privacy: no contact details from HQ ────────────────────────────────────

const EMAIL_RE = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i
const PHONE_RE = /(?:\+?\d[\s().-]?){9,}/

/** Does this text carry an e-mail address or a phone number? */
export function hasContactDetails(text, { allowDoddl = false } = {}) {
  const s = String(text || '')
  const emails = s.match(new RegExp(EMAIL_RE.source, 'gi')) || []
  const badEmail = emails.some(e => !(allowDoddl && /@doddl\.com$/i.test(e)))
  return badEmail || PHONE_RE.test(s)
}

/**
 * The only contact fields HQ may send: { role, type }. has_contact belongs to PM (filled from b2b_contacts), so a sent
 * has_contact (or the retired in_hubspot) is accepted and ignored. Throws on anything that looks like a name, e-mail
 * or phone. Returns { role, type }; PM adds has_contact when it saves.
 */
export function cleanContact(contact, path = 'contact') {
  if (contact == null) return { role: null, type: 'none' }
  if (!isObj(contact)) throw b2bError(400, `${path} must be an object { role, type }`)
  const extra = Object.keys(contact).filter(k => !['role', 'type', 'has_contact', 'in_hubspot'].includes(k))
  if (extra.length) throw b2bError(400, `${path} may carry only role and type (no names, e-mails or phones): ${extra.join(', ')}`)
  const type = contact.type == null ? 'none' : contact.type
  if (!CONTACT_TYPES.includes(type)) throw b2bError(400, `${path}.type must be one of ${CONTACT_TYPES.join(', ')}`)
  const role = contact.role == null || contact.role === '' ? null : String(contact.role).trim()
  if (role && (role.length > 60 || hasContactDetails(role))) throw b2bError(400, `${path}.role must be a role like "Manager" (max 60 characters, no contact details)`)
  return { role, type }
}

/** Contact as shown on screen: "Manager · Named contact" and whether PM holds a usable address. */
export function contactText(contact) {
  const c = contact || {}
  const type = c.type === 'named' ? 'Named contact' : c.type === 'generic' ? 'Main business email' : 'No contact yet'
  return { role: c.role || (c.type === 'none' || !c.type ? 'Contact to add' : 'Contact'), type, has_contact: !!c.has_contact }
}

/** A prospect still needs a usable contact (an address held in PM). */
export function needsContact(p) {
  const c = p && p.contact
  if (!p || ['rejected', 'excluded', 'opted_out', 'bounced', 'sample', 'partner'].includes(p.status)) return false
  return !c || !c.has_contact
}

// ─── the draft and the definition card ──────────────────────────────────────

const str = (v, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null)
const strList = (v, max = 30) => (Array.isArray(v) ? v.map(x => String(x == null ? '' : x).trim().slice(0, 200)).filter(Boolean).slice(0, max) : [])

/** A business definition, cleaned: the snapshot stored on the campaign (and the fields of a saved type). */
export function cleanDefinition(d) {
  const src = isObj(d) ? d : {}
  const kinds = Array.isArray(src.kinds) ? src.kinds.filter(k => k && (typeof k === 'string' || k.t)).map(k => (typeof k === 'string' ? { t: k.slice(0, 120), on: true } : { t: String(k.t).slice(0, 120), on: k.on !== false })).slice(0, 20) : []
  return {
    name: str(src.name, 120),
    line: str(src.line, 300),
    kinds,
    size: str(src.size, 200),
    who_decides: str(src.who_decides, 200),
    must: strList(src.must),
    nice: strList(src.nice),
    rule_out: strList(src.rule_out),
    sources: str(src.sources, 1000),
    wants: str(src.wants, 500),
    contact_rules: str(src.contact_rules, 1000),
    own_words: str(src.own_words, 1000),
    extra_rules: strList(src.extra_rules, 20),
  }
}

/** Definition snapshot from a business type row. */
export function definitionFromType(t) {
  if (!t) return cleanDefinition({})
  return cleanDefinition({
    name: t.name, line: t.line, kinds: t.kinds, size: t.size, who_decides: t.who_decides, must: t.must, nice: t.nice,
    rule_out: t.rule_out, sources: t.sources, wants: t.wants, contact_rules: t.contact_rules,
  })
}

export const CAMPAIGN_FIELDS = ['name', 'business_type_id', 'definition', 'goal', 'offers', 'market', 'volume', 'sample_size', 'pace', 'channels', 'people', 'approver', 'owner']

/**
 * Cleans a draft create / edit (lenient: drafts may be half-filled). people: active people names (or null to
 * skip the name check). Returns only the fields sent.
 */
export function cleanCampaignPatch(input, people = null) {
  if (!isObj(input)) throw b2bError(400, 'Send the campaign fields as a JSON object')
  const unknown = Object.keys(input).filter(k => !CAMPAIGN_FIELDS.includes(k) && k !== 'action')
  if (unknown.length) throw b2bError(400, `Unknown campaign field ${unknown.join(', ')}. Fields: ${CAMPAIGN_FIELDS.join(', ')}`)
  const person = (v, what) => {
    if (v == null || v === '') return null
    const s = String(v).trim()
    if (!people) return s
    const hit = people.find(p => p.toLowerCase() === s.toLowerCase())
    if (!hit) throw b2bError(400, `${what} "${s}" is not a doddl person. People: ${people.join(', ')}`)
    return hit
  }
  const out = {}
  if ('name' in input) out.name = str(input.name, 200)
  if ('business_type_id' in input) {
    if (input.business_type_id != null && !/^[0-9a-f-]{36}$/i.test(String(input.business_type_id))) throw b2bError(400, 'business_type_id must be a UUID')
    out.business_type_id = input.business_type_id || null
  }
  if ('definition' in input) out.definition = cleanDefinition(input.definition)
  if ('goal' in input) {
    const g = isObj(input.goal) ? input.goal : {}
    if (g.id != null && !GOAL_IDS.includes(g.id)) throw b2bError(400, `goal.id must be one of ${GOAL_IDS.join(', ')}`)
    out.goal = { id: g.id || null, target: str(g.target, 200), by: str(g.by, 120) }
  }
  if ('offers' in input) {
    const list = Array.isArray(input.offers) ? input.offers : []
    const bad = list.filter(o => !OFFER_IDS.includes(o))
    if (bad.length) throw b2bError(400, `offers must be from ${OFFER_IDS.join(', ')} (not ${bad.join(', ')})`)
    out.offers = [...new Set(list)]
  }
  if ('market' in input) {
    const m = isObj(input.market) ? input.market : {}
    if (m.country != null && !COUNTRY_CODES.includes(m.country)) throw b2bError(400, `market.country must be one of ${COUNTRY_CODES.join(', ')}`)
    const known = m.country ? COUNTRIES[m.country].regions : []
    const regions = strList(m.regions, 60)
    const unknown = regions.filter(r => !known.includes(r))
    if (unknown.length) throw b2bError(400, `market.regions must be from the ${m.country || 'chosen'} list (not ${unknown.join(', ')})`)
    out.market = { country: m.country || null, regions, places: strList(m.places, 20), language: str(m.language, 120) || (m.country ? COUNTRIES[m.country].language : null) }
  }
  for (const k of ['volume', 'sample_size']) {
    if (!(k in input)) continue
    if (input[k] == null || input[k] === '') { out[k] = null; continue }
    const n = Number(input[k])
    if (!Number.isInteger(n) || n < 1 || n > 100000) throw b2bError(400, `${k} must be a whole number from 1 to 100,000`)
    out[k] = n
  }
  if ('pace' in input) out.pace = str(input.pace, 200)
  if ('channels' in input) {
    const list = Array.isArray(input.channels) ? input.channels : []
    const bad = list.filter(c => !CHANNEL_IDS.includes(c))
    if (bad.length) throw b2bError(400, `channels must be from ${CHANNEL_IDS.join(', ')} (not ${bad.join(', ')})`)
    out.channels = [...new Set(list)]
  }
  if ('people' in input) {
    const p = isObj(input.people) ? input.people : {}
    out.people = { replies: person(p.replies, 'people.replies'), calls: person(p.calls, 'people.calls') }
  }
  if ('approver' in input) out.approver = person(input.approver, 'approver')
  if ('owner' in input) out.owner = person(input.owner, 'owner')
  return out
}

/** What is still missing before a draft can go for approval (empty = ready). */
export function submitProblems(c) {
  const out = []
  const d = c.definition || {}
  if (!str(c.name)) out.push('Give the campaign a name')
  if (!str(d.line) && !str(d.own_words)) out.push('Describe the business type (in one line, or in your own words)')
  if (!c.goal || !c.goal.id) out.push('Pick a goal')
  if (!Array.isArray(c.offers) || !c.offers.length) out.push('Tick at least one offer')
  if (!c.market || !c.market.country) out.push('Pick the country')
  if (!c.volume) out.push('Say how many in total')
  if (!c.sample_size) out.push('Say how big the sample is')
  if (c.volume && c.sample_size && c.sample_size > c.volume) out.push('The sample cannot be bigger than the total')
  if (!Array.isArray(c.channels) || !c.channels.length) out.push('Tick at least one channel')
  if (!c.people || !c.people.replies) out.push('Say who answers replies')
  if (!c.people || !c.people.calls) out.push('Say who takes calls and deals')
  return out
}

/** The b2b_definition artefact a submitted draft becomes. */
export function definitionArtefact(c) {
  const country = c.market && c.market.country
  const a = {
    campaign_id: c.id,
    name: c.name,
    definition: c.definition || cleanDefinition({}),
    goal: c.goal,
    offers: c.offers || [],
    market: c.market,
    volume: c.volume,
    sample_size: c.sample_size,
    channels: c.channels || [],
    people: c.people,
    country_rules: countryRules(country),
  }
  if (c.pace) a.pace = c.pace
  if (c.estimate && isObj(c.estimate)) a.estimate = c.estimate
  return a
}

export function goalName(id) { const g = GOALS.find(x => x.id === id); return g ? g.name : '' }
export function offerName(id) { const o = OFFERS.find(x => x.id === id); return o ? o.name : id }
export function channelName(id) { const o = CHANNELS.find(x => x.id === id); return o ? o.name : id }
export function countryName(code) { return COUNTRIES[code] ? COUNTRIES[code].name : (code || '') }

/** "UK: nurseries and early years, trial orders" (the wizard's suggested name). */
export function suggestedName(typeName, goalId, country) {
  const parts = [countryName(country), [String(typeName || '').toLowerCase(), goalName(goalId).toLowerCase()].filter(Boolean).join(', ')].filter(Boolean)
  return parts.join(': ')
}
