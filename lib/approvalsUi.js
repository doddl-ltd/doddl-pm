// Pure helpers for the Approvals v2 screens (no React): labels, the clock chips, inbox grouping.
// Kept free of JSX so node:test can cover them (test/approvalsUi.test.mjs).

export const C = {
  ink: '#190e3e', indigo: '#3D157D', muted: '#5B5470', soft: '#4A4458', faint: '#8F88A6',
  line: '#E4E0EE', line2: '#EFECF5', bg: '#F6F4FA', tint: '#EEE9F8', mark: '#F1ECFB', grey: '#F0EEF4', border: '#CFC8E0',
}

export const TONES = {
  ok:    { bg: '#E2F2E7', color: '#1E6B3A' },
  warn:  { bg: '#FBE9D2', color: '#8A4B00' },
  bad:   { bg: '#F8E1E1', color: '#A12B2B' },
  grey:  { bg: '#EEECF2', color: '#4A4458' },
  info:  { bg: '#EEE9F8', color: '#3D157D' },
  muted: { bg: '#F0EEF4', color: '#4A4458' },
}

export const TYPE_LABELS = {
  pr_link: 'Pull request', deploy_plan: 'Deployment plan', copy: 'Copy', document: 'Document', design: 'Design',
  ad_creative: 'Ad creative', video: 'Video', social_pack: 'Social week pack', email: 'Email', listing_change: 'Listing change', pack: 'Pack',
  b2b_definition: 'B2B definition', b2b_sample: 'B2B sample', b2b_sequence: 'B2B emails and flow', b2b_golive: 'B2B go-live',
}

// Types that carry something to look at before deciding.
const PREVIEW_TYPES = ['ad_creative', 'video', 'social_pack', 'email', 'listing_change', 'design', 'copy']

export const OUTCOMES = {
  approved:            { label: 'Approved', tone: 'ok' },
  approved_with_edits: { label: 'Approved with edits', tone: 'ok' },
  partially_approved:  { label: 'Partly approved', tone: 'ok' },
  revision_requested:  { label: 'Sent back', tone: 'warn' },
  rejected:            { label: 'Rejected', tone: 'bad' },
  expired:             { label: 'Expired', tone: 'grey' },
}

export const REJECT_REASONS = [
  { value: 'timing', label: 'Wrong timing' },
  { value: 'off_brand', label: 'Off brand or wrong tone' },
  { value: 'evidence', label: 'Evidence not convincing' },
  { value: 'money', label: 'Not worth the money', send: 'other' },
  { value: 'other', label: 'Something else' },
]
export const REJECT_LABEL = { timing: 'Wrong timing', off_brand: 'Off brand or wrong tone', evidence: 'Evidence not convincing', other: 'Something else' }

export const BATCH_LABEL = { single: 'Always single', off: 'Off', weekly: 'Weekly pack', daily: 'Daily pack', monthly: 'Monthly plan', pack: 'Pack' }
const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }

export const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase() && !!String(a || '').trim()
const ms = (v) => new Date(v).getTime()
const HOUR = 3600_000

export function typeLabel(t) { return TYPE_LABELS[t] || (t ? String(t).replace(/_/g, ' ') : 'Approval') }

/** "Wed 4 Nov 09:05" in UK time. */
export function fmtWhen(iso, { time = true } = {}) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const opts = { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }
  if (time) Object.assign(opts, { hour: '2-digit', minute: '2-digit', hour12: false })
  return d.toLocaleString('en-GB', opts).replace(/,/g, '')
}

/** "Wednesday 4 November" in UK time. */
export function fmtToday(now = new Date()) {
  return now.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' }).replace(/,/g, '')
}

function span(msLeft) {
  const m = Math.max(0, Math.round(msLeft / 60000))
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/**
 * The "answer by" chip for an open approval: { text, tone }.
 * Escalated → counts down to the expiry. Overdue → how long overdue (and "reminded"). Else hours to due (warn under 12h).
 */
export function dueChip(row, now = new Date()) {
  if (!row || row.decision) return null
  const t = ms(now)
  if (row.escalated_to && row.expires_at) return { text: `Expires in ${span(ms(row.expires_at) - t)}`, tone: 'bad' }
  const due = row.due_at ? ms(row.due_at) : null
  if (due == null || Number.isNaN(due)) return { text: 'No deadline', tone: 'grey' }
  if (row.overdue || t > due) return { text: `Overdue ${span(t - due)}${row.reminded_at ? ' · reminded' : ''}`, tone: 'bad' }
  const left = due - t
  return { text: `Due in ${span(left)}`, tone: left < 12 * HOUR ? 'warn' : 'ok' }
}

export function outcomeChip(decision) {
  return OUTCOMES[decision] || (decision ? { label: String(decision).replace(/_/g, ' '), tone: 'grey' } : null)
}

/** "Jon · backup Chris · weekly pack" */
export function ruleNote(rule) {
  if (!rule) return ''
  const bits = [rule.approver || 'Approver not set']
  if (rule.backup) bits.push(`backup ${rule.backup}`)
  if (rule.second_approver) bits.push(`second ${rule.second_approver}`)
  const b = batchText(rule)
  if (b && !['Off', 'Always single'].includes(b)) bits.push(b.charAt(0).toLowerCase() + b.slice(1))
  return bits.join(' · ')
}

export function batchText(rule) {
  if (!rule) return ''
  const m = rule.batch_mode
  if (m === 'weekly') return rule.batch_day ? `Weekly, ${DAY_LABEL[rule.batch_day] || rule.batch_day}` : 'Weekly pack'
  if (m === 'daily') return rule.reply_by ? `Daily, reply by ${String(rule.reply_by).slice(0, 5)}` : 'Daily pack'
  if (m === 'pack') return rule.max_pack ? `Pack, max ${rule.max_pack}` : 'Pack'
  return BATCH_LABEL[m] || ''
}

/** Small flags on an inbox row: Pack, Preview, n of m approved, Was X's. */
export function rowFlags(row, me) {
  const out = []
  if (row.escalated_to_me && Array.isArray(row.approvers) && row.approvers[0]) out.push(`Was ${row.approvers[0]}’s`)
  if (row.artefact_type === 'pack') out.push(row.line_count ? `Pack of ${row.line_count}` : 'Pack')
  else if (row.artefact_type === 'social_pack') out.push(row.line_count ? `Week pack · ${row.line_count} posts` : 'Week pack')
  if (PREVIEW_TYPES.includes(row.artefact_type) || row.staging_url) out.push('Preview')
  const slots = Array.isArray(row.approvers) ? row.approvers.filter(Boolean) : []
  if (slots.length > 1) {
    const yes = (row.votes || []).filter(v => ['approved', 'approved_with_edits', 'partially_approved'].includes(v.vote)).length
    out.push(`${yes} of ${slots.length} approved`)
  }
  if (row.voted) out.push('You answered')
  return out
}

/** Who a card is waiting on, with "you" for the signed-in person. */
export function whoText(names, me) {
  const list = (names || []).filter(Boolean).map(n => (same(n, me) ? 'you' : n))
  return list.length ? list.join(', ') : '—'
}

/**
 * "Waiting for me" grouped by area: escalated-to-me first, then areas in the rules' order, then anything
 * without an area (pre-v2 approvals). Each group oldest first.
 */
export function groupMine(rows, rules = []) {
  const order = new Map((rules || []).map((r, i) => [r.area, i]))
  const byArea = new Map()
  const escalated = []
  for (const r of rows || []) {
    if (r.escalated_to_me) { escalated.push(r); continue }
    const key = r.approval_area || '__other'
    if (!byArea.has(key)) byArea.set(key, [])
    byArea.get(key).push(r)
  }
  const oldest = (a, b) => ms(a.created_at) - ms(b.created_at)
  const ruleOf = (area) => (rules || []).find(r => r.area === area) || null
  const groups = []
  if (escalated.length) groups.push({ key: '__escalated', area: 'Escalated to you', escalated: true, rule: null, items: escalated.sort(oldest) })
  const keys = [...byArea.keys()].sort((a, b) => (order.has(a) ? order.get(a) : 999) - (order.has(b) ? order.get(b) : 999) || String(a).localeCompare(String(b)))
  for (const k of keys) {
    const items = byArea.get(k).sort(oldest)
    const rule = k === '__other' ? null : ruleOf(k)
    groups.push({ key: k, area: k === '__other' ? 'Other approvals' : (rule?.label || items[0].area_label || k), rule, items })
  }
  return groups
}

/** Areas that cannot work as set: no approver. */
export function rulesNeedingPerson(rules) {
  return (rules || []).filter(r => !r.approver)
}

/** May this person vote on this approval now? */
export function canVote(task, me) {
  if (!task || task.decision || task.task_type !== 'approval') return false
  if ((task.votes || []).some(v => same(v.voter, me))) return false
  const slots = Array.isArray(task.approvers) ? task.approvers.filter(Boolean) : []
  if (!slots.length) return true
  return slots.some(n => same(n, me)) || same(task.escalated_to, me)
}

/** Weekly money per currency over the ticked pack lines: { GBP: 42, USD: -35 }. */
export function packTotals(artefact, lines) {
  const out = {}
  for (const g of (artefact && artefact.groups) || []) {
    for (const l of (g && g.lines) || []) {
      const d = l && l.weekly_delta
      if (!d || typeof d.amount !== 'number' || !d.currency) continue
      const v = lines ? lines[l.id] : 'approved'
      if (v === 'rejected' || v === 'keep') continue
      out[d.currency] = (out[d.currency] || 0) + d.amount
    }
  }
  return out
}

const SYMBOL = { GBP: '£', USD: '$', EUR: '€', JPY: '¥', AUD: 'A$', CAD: 'C$' }
export function money(amount, currency, { sign = true } = {}) {
  const sym = SYMBOL[currency] || `${currency} `
  const abs = Math.abs(Math.round(amount * 100) / 100)
  const n = Number.isInteger(abs) ? String(abs) : abs.toFixed(2)
  return `${sign ? (amount < 0 ? '−' : '+') : amount < 0 ? '−' : ''}${sym}${n}`
}

/** Count of lines that go ahead / go back in a lines object (":edit" keys ignored). */
export function lineTally(lines) {
  let yes = 0, no = 0
  for (const [k, v] of Object.entries(lines || {})) {
    if (k.includes(':')) continue
    if (['approved', 'edited', 'edit', 'push'].includes(v)) yes++
    else if (['rejected', 'keep'].includes(v)) no++
  }
  return { yes, no }
}

/** The approval's own timeline for the History panel. */
export function trail(task) {
  const out = []
  if (task.created_at) out.push({ at: task.created_at, text: `${task.agent_id || 'Someone'} raised it${task.approvers?.[0] ? ` for ${task.approvers.join(' and ')}` : ''}` })
  if (task.reminded_at) out.push({ at: task.reminded_at, text: 'Reminder sent (24 hours)' })
  if (task.escalated_at) out.push({ at: task.escalated_at, text: `Escalated to ${task.escalated_to || 'the backup'} (48 hours)` })
  for (const v of task.votes || []) out.push({ at: v.at, text: `${v.voter}: ${(OUTCOMES[v.vote] || { label: v.vote }).label.toLowerCase()}` })
  if (task.decision && task.decision_at) out.push({ at: task.decision_at, text: `Decided: ${(OUTCOMES[task.decision] || { label: task.decision }).label.toLowerCase()}${task.decision_by ? ` (${task.decision_by})` : ''}` })
  return out.sort((a, b) => ms(a.at) - ms(b.at))
}

export const IDEA_STATUS = {
  new:       { label: 'With HQ', tone: 'info' },
  picked_up: { label: 'HQ has picked it up', tone: 'warn' },
  briefed:   { label: 'Briefed', tone: 'ok' },
  declined:  { label: 'Not taken', tone: 'grey' },
}
