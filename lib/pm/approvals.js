// Approvals v2 (docs/approvals-v2/CONTRACT.md): who approves what, votes and two-approver areas, the
// 24h / 48h / 72h clock, comments, and the approvals inbox.
//
// The pure functions at the top (no database) hold the rules and are unit-tested (test/approvals.test.mjs).
// The functions below them take a service-role client built for the caller (lib/server/admin.js), like
// lib/pm/ops.js, so task_history records who did what and a person only touches what they may see.

import { lineIds, LINE_VALUES } from '../artefactTypes'

export const VOTE_VALUES = ['approved', 'approved_with_edits', 'partially_approved', 'revision_requested', 'rejected']
export const DECISION_VALUES = [...VOTE_VALUES, 'expired']
export const APPROVED_FAMILY = ['approved', 'approved_with_edits', 'partially_approved']
export const NEGATIVE = ['revision_requested', 'rejected']
export const REJECT_REASONS = ['timing', 'off_brand', 'evidence', 'other']
export const BATCH_MODES = ['single', 'off', 'weekly', 'daily', 'monthly', 'pack']
export const BATCH_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const POSITIVE_LINES = ['approved', 'edited', 'edit', 'push']
export const NEGATIVE_LINES = ['rejected', 'keep']

export const HOUR = 3600_000
export const REMIND_AFTER_H = 24
export const ESCALATE_AFTER_H = 48
export const EXPIRE_AFTER_H = 72

const APPROVAL_FIELDS = 'id, title, task_type, project_id, assigned_to, approval_area, approvers, artefact_type, artefact, agent_id, staging_url, created_at, expires_at, reminded_at, escalated_to, escalated_at, decision, decision_by, decision_at, decision_notes, decision_edits, line_decisions, reject_reason, status, archived_at'

export function approvalError(status, message) {
  const e = new Error(message)
  e.status = status
  e.expose = true
  return e
}

const same = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const ms = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime())

// ─── London time ────────────────────────────────────────────────────────────

const LONDON = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** { date: 'YYYY-MM-DD', hour, minute } of an instant on the UK clock. */
export function londonParts(d) {
  const p = Object.fromEntries(LONDON.formatToParts(new Date(d)).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) }
}

/** The instant a UK wall-clock time happens: londonWallToUtc('2026-11-06', '17:00'). */
export function londonWallToUtc(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = String(hhmm).split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  const seen = londonParts(guess)
  const seenMs = Date.UTC(...seen.date.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))), seen.hour, seen.minute)
  return new Date(guess - (seenMs - guess))
}

function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ─── submit: approvers and expiry ───────────────────────────────────────────

/** Sum of positive weekly_delta amounts in a pack, in the given currency. */
export function weeklySpend(artefactType, artefact, currency = 'GBP') {
  if (artefactType !== 'pack' || !isObj(artefact)) return 0
  let total = 0
  for (const g of artefact.groups || []) {
    for (const l of (g && g.lines) || []) {
      const d = l && l.weekly_delta
      if (d && typeof d.amount === 'number' && d.amount > 0 && String(d.currency || '').toUpperCase() === currency) total += d.amount
    }
  }
  return total
}

/**
 * Everyone who must approve, in order: the approver (the agent's choice or the area's), the second approver,
 * and whoever the spend threshold also needs once the pack's weekly spend is over it.
 */
export function approversFor(rule, { assigned_to = null, weekly_spend = 0 } = {}) {
  const out = []
  const add = (n) => { if (n && !out.some(x => same(x, n))) out.push(n) }
  add(assigned_to || (rule && rule.approver))
  if (rule) {
    add(rule.second_approver)
    if (rule.threshold_also_needs && rule.spend_threshold_weekly != null && weekly_spend > Number(rule.spend_threshold_weekly)) add(rule.threshold_also_needs)
  }
  return out
}

/** When an approval expires: what the agent asked for (if in the future), a daily pack's reply-by time, or +72h. */
export function expiresAtFor(rule, createdAt, requested) {
  const created = new Date(createdAt)
  if (requested != null) {
    const t = new Date(requested)
    if (Number.isNaN(t.getTime())) throw approvalError(400, 'expires_at must be an ISO date-time')
    if (t.getTime() <= created.getTime()) throw approvalError(400, 'expires_at must be in the future')
    return t
  }
  if (rule && rule.batch_mode === 'daily' && rule.reply_by) {
    const hhmm = String(rule.reply_by).slice(0, 5)
    const today = londonParts(created).date
    let at = londonWallToUtc(today, hhmm)
    if (at.getTime() <= created.getTime()) at = londonWallToUtc(addDays(today, 1), hhmm)
    return at
  }
  return new Date(created.getTime() + EXPIRE_AFTER_H * HOUR)
}

/** The approval columns for a new submission. Pure: pass the area's rule (or null). */
export function planSubmission({ rule = null, area = null, assigned_to = null, artefact_type, artefact, expires_at, weekly_spend } = {}, now = new Date()) {
  const out = { expires_at: expiresAtFor(rule, now, expires_at).toISOString() }
  if (!area) return { ...out, approval_area: null, approvers: null, assigned_to: assigned_to || null }
  const spend = Number.isFinite(Number(weekly_spend)) && weekly_spend != null ? Number(weekly_spend) : weeklySpend(artefact_type, artefact, rule.threshold_currency || 'GBP')
  const approvers = approversFor(rule, { assigned_to, weekly_spend: spend })
  if (!approvers.length) throw approvalError(409, `Nobody approves "${rule.label}" yet. Ask Jon to set an approver in Who approves what, or pass assigned_to.`)
  return { ...out, approval_area: area, approvers, assigned_to: approvers[0] }
}

// ─── decide: who may vote, what the outcome is ──────────────────────────────

/**
 * The role the actor votes in, or null if they may not. Pre-v2 approvals (no approvers list) keep the old
 * behaviour: any signed-in person decides.
 */
export function voterRole(task, actor) {
  const slots = Array.isArray(task.approvers) ? task.approvers.filter(Boolean) : []
  if (!slots.length) return 'any'
  const i = slots.findIndex(n => same(n, actor))
  if (i === 0) return 'approver'
  if (i > 0) return 'second'
  if (same(task.escalated_to, actor)) return 'backup'
  return null
}

/** Checks per-line decisions against the artefact's line ids. Returns a clean object or throws. */
export function normaliseLines(lines, allowedIds) {
  if (lines == null) return null
  if (!isObj(lines)) throw approvalError(400, 'lines must be an object of { "<line_id>": decision }')
  const out = {}
  for (const [k, v] of Object.entries(lines)) {
    if (k.endsWith(':edit')) {
      const id = k.slice(0, -5)
      if (!allowedIds.includes(id)) throw approvalError(400, `No line "${id}" in this artefact`)
      out[k] = v
      continue
    }
    if (!allowedIds.includes(k)) throw approvalError(400, `No line "${k}" in this artefact. Lines: ${allowedIds.join(', ') || '(none)'}`)
    if (!LINE_VALUES.includes(v)) throw approvalError(400, `Line "${k}" must be one of ${LINE_VALUES.join(', ')}`)
    out[k] = v
  }
  return Object.keys(out).length ? out : null
}

function lineCounts(lines) {
  let pos = 0, neg = 0, edits = 0
  for (const [k, v] of Object.entries(lines || {})) {
    if (k.endsWith(':edit')) { edits++; continue }
    if (POSITIVE_LINES.includes(v)) pos++
    if (NEGATIVE_LINES.includes(v)) neg++
    if (v === 'edited' || v === 'edit') edits++
  }
  return { pos, neg, edits }
}

/**
 * The outcome a vote records. partially_approved when lines are both approved and rejected; rejected when an
 * "approve" ticked no line at all; approved_with_edits when an approval carries edits.
 */
export function deriveOutcome({ outcome, lines, edits }) {
  if (NEGATIVE.includes(outcome)) return outcome
  const { pos, neg, edits: lineEdits } = lineCounts(lines)
  if (pos && neg) return 'partially_approved'
  if (!pos && neg) return 'rejected'
  if (outcome === 'partially_approved') return lineEdits || (isObj(edits) && Object.keys(edits).length) ? 'approved_with_edits' : 'approved'
  if (outcome === 'approved' && (lineEdits || (isObj(edits) && Object.keys(edits).length))) return 'approved_with_edits'
  return outcome
}

/** Validates a decide request (shape only). Returns the cleaned vote. */
export function validateVote({ outcome, notes, edits, lines, reject_reason } = {}, allowedLineIds = []) {
  if (!VOTE_VALUES.includes(outcome)) throw approvalError(400, `outcome must be one of ${VOTE_VALUES.join(', ')}`)
  const text = notes == null ? null : String(notes).trim() || null
  if (text && text.length > 5000) throw approvalError(400, 'notes are too long (max 5,000 characters)')
  if (edits != null && !isObj(edits)) throw approvalError(400, 'edits must be an object, keyed as the artefact is')
  let reason = reject_reason == null || reject_reason === '' ? null : reject_reason
  if (reason && !REJECT_REASONS.includes(reason)) throw approvalError(400, `reject_reason must be one of ${REJECT_REASONS.join(', ')}`)
  if (outcome === 'rejected' && !reason) {
    if (!text) throw approvalError(400, 'A rejection needs a reject_reason (timing, off_brand, evidence, other) or notes')
    reason = 'other'
  }
  if (outcome !== 'rejected') reason = null
  if (outcome === 'revision_requested' && !text) throw approvalError(400, 'Sending back needs notes saying what to change')
  const cleanLines = normaliseLines(lines, allowedLineIds)
  const cleanEdits = isObj(edits) && Object.keys(edits).length ? edits : null
  if (outcome === 'approved_with_edits' && !cleanEdits && !lineCounts(cleanLines).edits) {
    throw approvalError(400, 'approved_with_edits needs edits (or edited lines)')
  }
  const vote = deriveOutcome({ outcome, lines: cleanLines, edits: cleanEdits })
  return { vote, notes: text, edits: cleanEdits, lines: cleanLines, reject_reason: vote === 'rejected' ? (reason || 'other') : null }
}

function mergeLines(votes) {
  const out = {}
  for (const v of votes) {
    for (const [k, val] of Object.entries(v.lines || {})) {
      if (k.endsWith(':edit')) { out[k] = val; continue }
      // A line goes ahead only if nobody turned it down.
      if (NEGATIVE_LINES.includes(out[k])) continue
      out[k] = val
    }
  }
  return Object.keys(out).length ? out : null
}

/**
 * What the votes add up to. Each required approver is a slot; the escalated backup can fill the first slot.
 * Any send-back or rejection decides at once. Otherwise the task is decided when every slot has voted.
 */
export function tally(task, votes) {
  const sorted = [...(votes || [])].sort((a, b) => ms(a.at || 0) - ms(b.at || 0))
  const slots = Array.isArray(task.approvers) ? task.approvers.filter(Boolean) : []
  const negative = sorted.find(v => NEGATIVE.includes(v.vote))
  if (negative) {
    return {
      decided: true, decision: negative.vote, decision_by: negative.voter, decision_notes: negative.notes || null,
      decision_edits: negative.edits || null, line_decisions: negative.lines || null, reject_reason: negative.reject_reason || null, waiting_on: [],
    }
  }
  let counted = sorted
  let waiting = []
  if (slots.length) {
    const used = new Set()
    counted = []
    slots.forEach((name, i) => {
      let v = sorted.find(x => !used.has(x) && same(x.voter, name))
      if (!v && i === 0 && task.escalated_to && !slots.some(s => same(s, task.escalated_to))) {
        v = sorted.find(x => !used.has(x) && same(x.voter, task.escalated_to))
      }
      if (v) { used.add(v); counted.push(v) } else waiting.push(name)
    })
  } else if (!sorted.length) {
    waiting = []
    return { decided: false, waiting_on: [] }
  } else {
    counted = [sorted[sorted.length - 1]]
  }
  if (waiting.length) return { decided: false, waiting_on: waiting }

  const lines = mergeLines(counted)
  const edits = counted.reduce((acc, v) => (v.edits ? { ...(acc || {}), ...v.edits } : acc), null)
  let decision = counted.some(v => v.vote === 'partially_approved') ? 'partially_approved'
    : counted.some(v => v.vote === 'approved_with_edits') ? 'approved_with_edits' : 'approved'
  const c = lineCounts(lines)
  if (c.pos && c.neg) decision = 'partially_approved'
  else if (!c.pos && c.neg) decision = 'rejected'
  const notes = counted.filter(v => v.notes)
  return {
    decided: true,
    decision,
    decision_by: counted.map(v => v.voter).join(', '),
    decision_notes: notes.length === 0 ? null : counted.length === 1 ? notes[0].notes : notes.map(v => `${v.voter}: ${v.notes}`).join('\n'),
    decision_edits: edits,
    line_decisions: lines,
    reject_reason: decision === 'rejected' ? 'other' : null,
    waiting_on: [],
  }
}

/** Who still has to answer an open approval (escalated backup included). */
export function pendingVoters(task, votes) {
  const t = tally(task, votes || [])
  if (t.decided) return []
  const slots = Array.isArray(task.approvers) ? task.approvers.filter(Boolean) : []
  if (!slots.length) return task.assigned_to ? [task.assigned_to] : []
  const out = [...t.waiting_on]
  if (task.escalated_to && t.waiting_on.some(n => same(n, slots[0])) && !out.some(n => same(n, task.escalated_to))) out.push(task.escalated_to)
  return out
}

// ─── the clock ──────────────────────────────────────────────────────────────

/** Due = the 24h reminder point (or the expiry, if sooner). */
export function dueAt(task) {
  const created = ms(task.created_at)
  const expires = task.expires_at ? ms(task.expires_at) : created + EXPIRE_AFTER_H * HOUR
  return new Date(Math.min(created + REMIND_AFTER_H * HOUR, expires))
}

/**
 * What the hourly clock does to one open approval: { expire } or { remind, escalate_to }.
 * The original approver can still answer after escalation.
 */
export function clockStep(task, rule, now = new Date()) {
  const t = ms(now)
  const created = ms(task.created_at)
  const expires = task.expires_at ? ms(task.expires_at) : created + EXPIRE_AFTER_H * HOUR
  if (t >= expires) return { expire: true, remind: false, escalate_to: null }
  const age = t - created
  const remind = age >= REMIND_AFTER_H * HOUR && !task.reminded_at
  let escalate_to = null
  if (age >= ESCALATE_AFTER_H * HOUR && !task.escalated_at && rule && rule.backup) {
    const slots = Array.isArray(task.approvers) ? task.approvers : [task.assigned_to]
    if (!slots.some(n => same(n, rule.backup))) escalate_to = rule.backup
  }
  return { expire: false, remind, escalate_to }
}

// ─── inbox and the 08:00 summary ────────────────────────────────────────────

function rowFor(task, votes, rules, now) {
  const rule = rules[task.approval_area] || null
  const due = dueAt(task)
  return {
    id: task.id,
    title: task.title,
    approval_area: task.approval_area,
    area_label: rule ? rule.label : null,
    artefact_type: task.artefact_type,
    agent_id: task.agent_id,
    assigned_to: task.assigned_to,
    approvers: task.approvers,
    created_at: task.created_at,
    due_at: due.toISOString(),
    expires_at: task.expires_at,
    reminded_at: task.reminded_at,
    escalated_to: task.escalated_to,
    escalated_at: task.escalated_at,
    overdue: !task.decision && ms(now) > due.getTime(),
    votes: (votes || []).map(v => ({ voter: v.voter, role: v.role, vote: v.vote, at: v.at })),
    waiting_on: task.decision ? [] : pendingVoters(task, votes),
    decision: task.decision,
    decision_by: task.decision_by,
    decision_at: task.decision_at,
    decision_notes: task.decision_notes,
    reject_reason: task.reject_reason,
  }
}

/**
 * The approvals inbox for one person: waiting for me (escalated first, then by due time), waiting on others,
 * decided, and the tiles. tasks: open + recently decided approval tasks; votesByTask: { id: [votes] }.
 */
export function buildInbox(tasks, votesByTask, rules, actor, now = new Date()) {
  const today = londonParts(now).date
  const mine = [], others = [], decided = []
  for (const t of tasks) {
    const row = rowFor(t, votesByTask[t.id] || [], rules, now)
    if (t.decision) { decided.push(row); continue }
    const waitingForMe = row.waiting_on.some(n => same(n, actor))
    const alreadyVoted = (votesByTask[t.id] || []).some(v => same(v.voter, actor))
    row.escalated_to_me = same(t.escalated_to, actor) && waitingForMe
    row.voted = alreadyVoted
    if (waitingForMe && !alreadyVoted) mine.push(row)
    else others.push(row)
  }
  const byDue = (a, b) => ms(a.due_at) - ms(b.due_at)
  mine.sort((a, b) => (Number(b.escalated_to_me) - Number(a.escalated_to_me)) || byDue(a, b))
  others.sort(byDue)
  decided.sort((a, b) => ms(b.decision_at || 0) - ms(a.decision_at || 0))
  const tiles = {
    waiting: mine.length,
    overdue: mine.filter(r => r.overdue).length,
    due_today: mine.filter(r => !r.overdue && londonParts(r.due_at).date === today).length,
    escalated: mine.filter(r => r.escalated_to_me).length,
  }
  return { tiles, badge: mine.length, mine, others, decided }
}

/** Per approver: waiting, due today, overdue, escalated, with the items (the 08:00 summary). */
export function summaryByPerson(openTasks, votesByTask, now = new Date()) {
  const today = londonParts(now).date
  const out = {}
  for (const t of openTasks) {
    if (t.decision) continue
    const due = dueAt(t)
    const overdue = ms(now) > due.getTime()
    for (const name of pendingVoters(t, votesByTask[t.id] || [])) {
      const p = out[name] || (out[name] = { waiting: 0, due_today: 0, overdue: 0, escalated: 0, items: [] })
      p.waiting++
      if (overdue) p.overdue++
      else if (londonParts(due).date === today) p.due_today++
      const escalated = same(t.escalated_to, name)
      if (escalated) p.escalated++
      p.items.push({ id: t.id, title: t.title, approval_area: t.approval_area, due_at: due.toISOString(), overdue, escalated })
    }
  }
  return out
}

// ─── rules ──────────────────────────────────────────────────────────────────

export const RULE_FIELDS = ['label', 'what', 'approver', 'backup', 'second_approver', 'spend_threshold_weekly', 'threshold_currency',
  'threshold_also_needs', 'batch_mode', 'batch_day', 'reply_by', 'max_pack', 'note']
const PERSON_FIELDS = ['approver', 'backup', 'second_approver', 'threshold_also_needs']
const FIELD_LABEL = {
  label: 'name', what: 'what it covers', approver: 'approver', backup: 'backup', second_approver: 'second approver',
  spend_threshold_weekly: 'spend threshold', threshold_currency: 'threshold currency', threshold_also_needs: 'above the threshold also needs',
  batch_mode: 'batching', batch_day: 'batch day', reply_by: 'reply by', max_pack: 'max pack', note: 'note',
}

/**
 * Validates a rule change against the current rule. people: active people names.
 * Returns { patch, before, after } with only the fields that actually change.
 */
export function validateRuleChange(rule, changes, people) {
  if (!isObj(changes)) throw approvalError(400, 'changes must be an object')
  const unknown = Object.keys(changes).filter(k => !RULE_FIELDS.includes(k))
  if (unknown.length) throw approvalError(400, `Unknown rule field ${unknown.join(', ')}. Editable: ${RULE_FIELDS.join(', ')}`)
  const patch = {}
  for (const [k, raw] of Object.entries(changes)) {
    let v = raw === '' || raw === 'None' || raw === 'Not set' ? null : raw
    if (PERSON_FIELDS.includes(k) && v != null) {
      const name = people.find(p => same(p, v))
      if (!name) throw approvalError(400, `${FIELD_LABEL[k]} "${v}" is not a doddl person. People: ${people.join(', ')}`)
      v = name
    }
    if (k === 'label' && !String(v || '').trim()) throw approvalError(400, 'label must not be empty')
    if ((k === 'label' || k === 'what' || k === 'note') && v != null) v = String(v).trim().slice(0, 300)
    if (k === 'batch_mode' && !BATCH_MODES.includes(v)) throw approvalError(400, `batch_mode must be one of ${BATCH_MODES.join(', ')}`)
    if (k === 'batch_day' && v != null) { v = String(v).slice(0, 3).toLowerCase(); if (!BATCH_DAYS.includes(v)) throw approvalError(400, `batch_day must be one of ${BATCH_DAYS.join(', ')}`) }
    if (k === 'reply_by' && v != null) { if (!/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(String(v))) throw approvalError(400, 'reply_by must be HH:MM'); v = String(v).slice(0, 5) }
    if (k === 'max_pack' && v != null) { v = Number(v); if (!Number.isInteger(v) || v < 1) throw approvalError(400, 'max_pack must be a whole number of at least 1') }
    if (k === 'spend_threshold_weekly' && v != null) { v = Number(v); if (!Number.isFinite(v) || v < 0) throw approvalError(400, 'spend_threshold_weekly must be a number of at least 0') }
    if (k === 'threshold_currency') { v = String(v || 'GBP').toUpperCase(); if (!/^[A-Z]{3}$/.test(v)) throw approvalError(400, 'threshold_currency must be a 3-letter code') }
    const cur = k === 'reply_by' && rule[k] ? String(rule[k]).slice(0, 5) : rule[k]
    const curCmp = cur == null ? null : (k === 'spend_threshold_weekly' ? Number(cur) : cur)
    if (curCmp !== v) patch[k] = v
  }
  const after = { ...rule, ...patch }
  if (!after.batchable && !['single', 'off'].includes(after.batch_mode)) throw approvalError(400, `${rule.label} is always single${rule.note ? ` (${rule.note})` : ''}`)
  if (!rule.spend_applies && (patch.spend_threshold_weekly != null || patch.threshold_also_needs != null)) throw approvalError(400, `${rule.label} does not move money, so it has no spend threshold`)
  if (after.second_approver && after.approver && same(after.second_approver, after.approver)) throw approvalError(400, 'The second approver must be someone other than the approver')
  if (after.backup && after.approver && same(after.backup, after.approver)) throw approvalError(400, 'The backup must be someone other than the approver')
  const before = {}
  for (const k of Object.keys(patch)) before[k] = rule[k] == null ? null : rule[k]
  return { patch, before, after: { ...patch } }
}

/** "Organic social: approver Jon → Laura; backup Cat → Jon" */
export function describeRuleChange(label, before, after) {
  const show = (v) => (v == null || v === '' ? 'not set' : String(v))
  return `${label}: ${Object.keys(after).map(k => `${FIELD_LABEL[k] || k} ${show(before[k])} → ${show(after[k])}`).join('; ')}`
}

export function isRuleAdmin(person, actor) {
  if (person && person.approval_admin) return true
  return same(actor, 'Jon')
}

// ─── comments ───────────────────────────────────────────────────────────────

export function validateAnchor(anchor) {
  if (anchor == null) return null
  if (!isObj(anchor)) throw approvalError(400, 'anchor must be an object')
  switch (anchor.kind) {
    case 'time':
      if (!(typeof anchor.t === 'string' && /^\d{1,2}:\d{2}(\.\d+)?$/.test(anchor.t)) && !(typeof anchor.t === 'number' && anchor.t >= 0)) {
        throw approvalError(400, 'A time anchor needs t, e.g. "0:03"')
      }
      return { kind: 'time', t: anchor.t }
    case 'point': {
      const okNum = (n) => typeof n === 'number' && n >= 0 && n <= 1
      if (!okNum(anchor.x) || !okNum(anchor.y)) throw approvalError(400, 'A point anchor needs x and y between 0 and 1')
      return { kind: 'point', placement: anchor.placement == null ? null : String(anchor.placement), x: anchor.x, y: anchor.y }
    }
    case 'field':
      if (!anchor.field || typeof anchor.field !== 'string') throw approvalError(400, 'A field anchor needs field')
      return { kind: 'field', field: anchor.field }
    case 'line':
      if (!anchor.line_id || typeof anchor.line_id !== 'string') throw approvalError(400, 'A line anchor needs line_id')
      return { kind: 'line', line_id: anchor.line_id }
    default:
      throw approvalError(400, 'anchor.kind must be time, point, field or line')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Database operations
// ═══════════════════════════════════════════════════════════════════════════

function must(result, what) {
  if (result.error) throw approvalError(500, `${what}: ${result.error.message}`)
  return result.data
}

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export async function getRule(db, area) {
  return must(await db.from('approval_rules').select('*').eq('area', area).maybeSingle(), 'approval rule')
}

export async function listRules(db) {
  return must(await db.from('approval_rules').select('*').order('position').order('area'), 'approval rules')
}

async function rulesMap(db) {
  return Object.fromEntries((await listRules(db)).map(r => [r.area, r]))
}

async function activePeople(db) {
  return must(await db.from('people').select('name').eq('active', true).eq('kind', 'human').order('name'), 'people').map(p => p.name)
}

async function votesFor(db, taskIds) {
  const out = {}
  for (let i = 0; i < taskIds.length; i += 200) {
    const rows = must(await db.from('approval_votes').select('task_id, voter, role, vote, notes, edits, lines, reject_reason, at').in('task_id', taskIds.slice(i, i + 200)), 'votes')
    for (const v of rows) (out[v.task_id] || (out[v.task_id] = [])).push(v)
  }
  return out
}

export async function notify(db, userName, { type, task, body, from = 'doddl HQ' }) {
  if (!userName) return
  const r = await db.from('notifications').insert([{
    user_name: userName, type, task_id: task ? task.id : null, task_title: task ? task.title : null, from_user: from,
    body: String(body || '').slice(0, 500),
  }])
  if (r.error) console.error('approvals: notification failed:', r.error.message)
}

/**
 * Called by ops.submitForApproval: works out approval_area, approvers, assigned_to and expires_at for a
 * new approval. Throws a 400 for an unknown area.
 */
export async function prepareSubmission(db, input, now = new Date()) {
  const area = input.approval_area ? String(input.approval_area).trim() : null
  let rule = null
  if (area) {
    rule = await getRule(db, area)
    if (!rule) {
      const areas = (await listRules(db)).map(r => r.area)
      throw approvalError(400, `Unknown approval_area "${area}". Areas: ${areas.join(', ')}`)
    }
  }
  return planSubmission({
    rule, area, assigned_to: input.assigned_to || null, artefact_type: input.artefact_type, artefact: input.artefact,
    expires_at: input.expires_at, weekly_spend: input.weekly_spend,
  }, now)
}

/** After a submission: tell the approvers in the app and on Teams. Never throws. */
export async function announceSubmission(db, task, { teams } = {}) {
  try {
    const names = task.approvers && task.approvers.length ? task.approvers : task.assigned_to ? [task.assigned_to] : []
    for (const n of names) await notify(db, n, { type: 'approval_request', task, body: `Waiting for you: ${task.title}` })
    if (teams) await teams.postApproval(task, 'new')
  } catch (e) {
    console.error('approvals: announce failed:', e.message)
  }
}

export async function loadApproval(db, taskId) {
  if (!isUuid(taskId)) throw approvalError(400, 'task_id must be a UUID')
  const t = must(await db.from('tasks').select(APPROVAL_FIELDS).eq('id', taskId).maybeSingle(), 'task')
  if (!t) throw approvalError(404, `No task ${taskId}`)
  return t
}

/**
 * POST /api/approvals/decide. Records the actor's vote and, when the votes add up, the decision.
 * Returns { task_id, vote, decided, decision, waiting_on }.
 */
export async function decide(db, actor, input = {}) {
  const task = await loadApproval(db, input.task_id)
  if (task.task_type !== 'approval') throw approvalError(409, 'This task is not an approval')
  if (task.archived_at) throw approvalError(409, 'Task is archived')
  if (task.decision) throw approvalError(409, `Already decided (${task.decision}${task.decision_by ? ` by ${task.decision_by}` : ''})`)
  const role = voterRole(task, actor)
  if (!role) {
    const who = [...(task.approvers || []), task.escalated_to].filter(Boolean)
    throw approvalError(403, `Only ${who.join(' or ')} can decide this one`)
  }
  const v = validateVote(input, lineIds(task.artefact_type, task.artefact))

  const ins = await db.from('approval_votes').insert([{ task_id: task.id, voter: actor, role, ...v }]).select('task_id, voter, role, vote, notes, edits, lines, reject_reason, at').single()
  if (ins.error) {
    if (ins.error.code === '23505') throw approvalError(409, 'You have already answered this one')
    throw approvalError(500, `vote: ${ins.error.message}`)
  }
  const votes = (await votesFor(db, [task.id]))[task.id] || [ins.data]
  const t = tally(task, votes)
  if (!t.decided) return { task_id: task.id, vote: ins.data.vote, decided: false, decision: null, waiting_on: t.waiting_on }

  const patch = {
    decision: t.decision, decision_by: t.decision_by, decision_at: new Date().toISOString(), decision_notes: t.decision_notes,
    decision_edits: t.decision_edits, line_decisions: t.line_decisions, reject_reason: t.reject_reason,
  }
  // Same as the old panel: an approval completes the task.
  if (APPROVED_FAMILY.includes(t.decision)) patch.status = 'done'
  const up = await db.from('tasks').update(patch).eq('id', task.id).is('decision', null).select('id, decision').maybeSingle()
  if (up.error) throw approvalError(up.error.code === 'P0001' ? 409 : 500, up.error.message)
  if (!up.data) {
    const now = await loadApproval(db, task.id)
    return { task_id: task.id, vote: ins.data.vote, decided: true, decision: now.decision, waiting_on: [] }
  }
  return { task_id: task.id, vote: ins.data.vote, decided: true, decision: t.decision, waiting_on: [] }
}

/** Decision detail for agents (GET /api/agent/decisions/:task_id, MCP get_decision). */
export async function decisionDetail(db, taskId) {
  const t = await loadApproval(db, taskId)
  const votes = (await votesFor(db, [t.id]))[t.id] || []
  return {
    id: t.id, title: t.title, task_type: t.task_type, approval_area: t.approval_area, approvers: t.approvers,
    expires_at: t.expires_at, escalated_to: t.escalated_to,
    decision: t.decision, decision_by: t.decision_by, decision_at: t.decision_at, decision_notes: t.decision_notes,
    decision_edits: t.decision_edits, line_decisions: t.line_decisions, reject_reason: t.reject_reason,
    votes: votes.map(v => ({ voter: v.voter, role: v.role, vote: v.vote, notes: v.notes, edits: v.edits, lines: v.lines, reject_reason: v.reject_reason, at: v.at })),
    waiting_on: t.decision ? [] : pendingVoters(t, votes),
    pending: t.task_type === 'approval' && !t.decision,
  }
}

/** One approval with everything its review screen needs. */
export async function approvalDetail(db, taskId) {
  const t = await loadApproval(db, taskId)
  const [votes, comments, rule] = await Promise.all([
    votesFor(db, [t.id]).then(m => m[t.id] || []),
    listComments(db, t.id),
    t.approval_area ? getRule(db, t.approval_area) : null,
  ])
  return { ...t, due_at: dueAt(t).toISOString(), votes, waiting_on: t.decision ? [] : pendingVoters(t, votes), comments, rule }
}

export async function approvalsInbox(db, actor, { decided_days = 30, now = new Date() } = {}) {
  const since = new Date(ms(now) - Math.max(1, Number(decided_days) || 30) * 24 * HOUR).toISOString()
  const fields = APPROVAL_FIELDS.replace(', artefact,', ',')
  const open = must(await db.from('tasks').select(fields).eq('task_type', 'approval').is('decision', null).is('archived_at', null).order('created_at').limit(500), 'open approvals')
  const recent = must(await db.from('tasks').select(fields).eq('task_type', 'approval').not('decision', 'is', null).is('archived_at', null).gte('decision_at', since).order('decision_at', { ascending: false }).limit(100), 'decided approvals')
  const all = [...open, ...recent]
  const [votes, rules] = await Promise.all([votesFor(db, all.map(t => t.id)), rulesMap(db)])
  return { ...buildInbox(all, votes, rules, actor, now), rules: Object.values(rules).map(r => ({ area: r.area, label: r.label, approver: r.approver, backup: r.backup, second_approver: r.second_approver, batch_mode: r.batch_mode })) }
}

// ─── comments ───────────────────────────────────────────────────────────────

export async function listComments(db, taskId) {
  return must(await db.from('approval_comments').select('id, task_id, author, body, anchor, resolved, resolved_by, resolved_at, created_at').eq('task_id', taskId).order('created_at'), 'comments')
}

export async function addComment(db, author, { task_id, body, anchor } = {}) {
  const task = await loadApproval(db, task_id) // 404 when the caller cannot see it
  const text = String(body || '').trim()
  if (!text) throw approvalError(400, 'body must not be empty')
  if (text.length > 5000) throw approvalError(400, 'body is too long (max 5,000 characters)')
  const row = { task_id: task.id, author, body: text, anchor: validateAnchor(anchor) }
  const ins = must(await db.from('approval_comments').insert([row]).select('id, task_id, author, body, anchor, resolved, created_at').single(), 'comment')
  // The approver hears about comments from others (agents replying, the second approver).
  for (const n of [task.assigned_to, ...(task.approvers || [])].filter((x, i, a) => x && a.findIndex(y => same(y, x)) === i)) {
    if (!same(n, author)) await notify(db, n, { type: 'approval_comment', task, body: `${author}: ${text}`, from: author })
  }
  return ins
}

export async function resolveComment(db, actor, { id, resolved = true } = {}) {
  if (!isUuid(id)) throw approvalError(400, 'id must be a comment UUID')
  const patch = resolved ? { resolved: true, resolved_by: actor, resolved_at: new Date().toISOString() } : { resolved: false, resolved_by: null, resolved_at: null }
  const row = must(await db.from('approval_comments').update(patch).eq('id', id).select('id, task_id, author, body, anchor, resolved, resolved_by, resolved_at, created_at').maybeSingle(), 'comment')
  if (!row) throw approvalError(404, `No comment ${id}`)
  return row
}

// ─── rules ──────────────────────────────────────────────────────────────────

export async function rulesWithLog(db, { limit = 100 } = {}) {
  const [rules, log] = await Promise.all([
    listRules(db),
    db.from('approval_rules_log').select('*').order('at', { ascending: false }).limit(Math.min(500, Number(limit) || 100)),
  ])
  return { rules, log: must(log, 'rules log') }
}

/** Agents read the rules before submitting; the read is stamped so the page shows who is up to date. */
export async function rulesForAgent(db, agentId) {
  const stamp = await db.from('approval_rules').update({ last_read_by: agentId, last_read_at: new Date().toISOString() }).neq('area', '')
  if (stamp.error) console.error('approvals: last_read stamp failed:', stamp.error.message)
  return { rules: await listRules(db) }
}

/**
 * PUT /api/approvals/rules/:area — Jon (approval_admin) only. Logged. move_waiting moves undecided cards
 * from the old approver / second approver to the new one. sysDb: a client without a viewer (moves cards
 * in projects the editor may not see).
 */
export async function updateRule(db, sysDb, actor, area, { changes, reason, move_waiting = false } = {}) {
  const me = must(await db.from('people').select('name, approval_admin').ilike('name', String(actor || '').trim()).maybeSingle(), 'person')
  if (!isRuleAdmin(me, actor)) throw approvalError(403, 'Only Jon can change who approves what')
  const why = String(reason || '').trim()
  if (!why) throw approvalError(400, 'Say why (reason) — it goes in the change log')
  const rule = await getRule(db, area)
  if (!rule) throw approvalError(404, `No approval area "${area}"`)
  const { patch, before, after } = validateRuleChange(rule, changes, await activePeople(db))
  if (!Object.keys(patch).length) throw approvalError(400, 'Nothing changed')

  const updated = must(await db.from('approval_rules').update({ ...patch, updated_by: actor, updated_at: new Date().toISOString() }).eq('area', area).select('*').single(), 'rule update')
  const entry = must(await db.from('approval_rules_log').insert([{
    area, changed_by: actor, change: describeRuleChange(rule.label, before, after), reason: why.slice(0, 1000), before, after,
  }]).select('*').single(), 'rules log')

  let moved = 0
  if (move_waiting) {
    const swaps = [['approver', 0], ['second_approver', 1]].filter(([k]) => k in patch)
    if (swaps.length) {
      const open = must(await sysDb.from('tasks').select('id, title, approvers, assigned_to').eq('approval_area', area).eq('task_type', 'approval').is('decision', null).is('archived_at', null), 'waiting cards')
      for (const t of open) {
        const votes = (await votesFor(sysDb, [t.id]))[t.id] || []
        let approvers = [...(t.approvers || [])]
        let changed = false
        for (const [k, slot] of swaps) {
          const old = before[k]
          const idx = approvers.findIndex((n, i) => (slot === 0 ? i === 0 : i > 0) && same(n, old))
          if (idx === -1 || votes.some(v => same(v.voter, old))) continue
          if (patch[k]) approvers[idx] = patch[k]
          else if (slot > 0) approvers.splice(idx, 1)
          else continue
          changed = true
        }
        approvers = approvers.filter((n, i, a) => n && a.findIndex(x => same(x, n)) === i)
        if (!changed || !approvers.length) continue
        const up = await sysDb.from('tasks').update({ approvers, assigned_to: approvers[0] }).eq('id', t.id).is('decision', null)
        if (up.error) { console.error('approvals: move failed:', up.error.message); continue }
        moved++
        for (const [k] of swaps) if (patch[k]) await notify(sysDb, patch[k], { type: 'approval_moved', task: t, body: `Moved to you from ${before[k] || 'nobody'}: ${t.title}`, from: actor })
      }
    }
  }
  return { rule: updated, log_entry: entry, moved }
}

// ─── the clock ──────────────────────────────────────────────────────────────

/**
 * One run of the hourly clock (pages/api/cron/approval-clock.js). db: a system client (no viewer).
 * teams: lib/server/teams.js (or a stub in tests). Returns a summary.
 */
export async function runApprovalClock(db, { teams = null, now = new Date() } = {}) {
  const summary = { checked: 0, reminded: 0, escalated: 0, expired: 0, errors: [] }
  const open = must(await db.from('tasks').select(APPROVAL_FIELDS.replace(', artefact,', ','))
    .eq('task_type', 'approval').is('decision', null).is('archived_at', null).not('expires_at', 'is', null).limit(1000), 'open approvals')
  if (!open.length) return summary
  const [rules, votes] = await Promise.all([rulesMap(db), votesFor(db, open.map(t => t.id))])
  const at = new Date(now).toISOString()

  for (const t of open) {
    summary.checked++
    const rule = rules[t.approval_area] || null
    const step = clockStep(t, rule, now)
    try {
      if (step.expire) {
        const daily = rule && rule.batch_mode === 'daily' && rule.reply_by
        const up = await db.from('tasks').update({
          decision: 'expired', decision_by: 'system', decision_at: at,
          decision_notes: daily ? `Not answered by the reply-by time (${String(rule.reply_by).slice(0, 5)})` : `No answer in ${EXPIRE_AFTER_H} hours. HQ re-checks before asking again.`,
        }).eq('id', t.id).is('decision', null).select('id').maybeSingle()
        if (up.error) throw new Error(up.error.message)
        if (up.data) summary.expired++
        continue
      }
      if (step.remind) {
        const up = await db.from('tasks').update({ reminded_at: at }).eq('id', t.id).is('reminded_at', null).select('id').maybeSingle()
        if (up.error) throw new Error(up.error.message)
        if (up.data) {
          summary.reminded++
          for (const n of pendingVoters(t, votes[t.id])) await notify(db, n, { type: 'approval_reminder', task: t, body: `Still waiting for you (24 hours): ${t.title}` })
          if (teams) await teams.postApproval({ ...t, reminded_at: at }, 'reminder')
        }
      }
      if (step.escalate_to) {
        const up = await db.from('tasks').update({ escalated_to: step.escalate_to, escalated_at: at }).eq('id', t.id).is('escalated_at', null).select('id').maybeSingle()
        if (up.error) throw new Error(up.error.message)
        if (up.data) {
          summary.escalated++
          const was = (t.approvers && t.approvers[0]) || t.assigned_to
          await notify(db, step.escalate_to, { type: 'approval_escalated', task: t, body: `${was || 'The approver'} has not answered in 48 hours. You are the backup: ${t.title}` })
          if (teams) await teams.postApproval({ ...t, escalated_to: step.escalate_to, escalated_at: at }, 'escalated')
        }
      }
    } catch (e) {
      summary.errors.push({ task_id: t.id, error: e.message })
    }
  }
  return summary
}

/** The 08:00 UK summary: one Teams card per approver with anything waiting. */
export async function runDailySummary(db, { teams, now = new Date() } = {}) {
  const open = must(await db.from('tasks').select(APPROVAL_FIELDS.replace(', artefact,', ','))
    .eq('task_type', 'approval').is('decision', null).is('archived_at', null).limit(1000), 'open approvals')
  const votes = await votesFor(db, open.map(t => t.id))
  const people = summaryByPerson(open, votes, now)
  let posted = 0
  for (const [name, s] of Object.entries(people)) {
    if (teams && (await teams.postSummary(name, s)).posted) posted++
  }
  return { people: Object.keys(people).length, posted, by_person: Object.fromEntries(Object.entries(people).map(([n, s]) => [n, { waiting: s.waiting, due_today: s.due_today, overdue: s.overdue, escalated: s.escalated }])) }
}
