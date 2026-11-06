// Teams delivery for approvals (CONTRACT.md "Teams", board 7): an Adaptive Card per new approval (and for
// the 24h reminder and the 48h escalation), and the 08:00 UK summary per approver.
//
// Delivery is a Teams incoming webhook in TEAMS_APPROVALS_WEBHOOK_URL (Jon loads it himself). Without it every
// call is a no-op that logs "teams: not configured". Cards link to the approval in doddl PM; approving inside
// Teams is not part of v2. Never throws: a Teams outage must not block a submission or the clock.

const DEFAULT_BASE = 'https://doddl-pm.vercel.app'
const TIMEOUT_MS = 5000

export function appBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || DEFAULT_BASE).replace(/\/$/, '')
}

/** Deep link the UI opens: the Approvals view with this card. */
export function approvalLink(taskId, base = appBaseUrl()) {
  return `${base}/?view=approvals&task=${encodeURIComponent(taskId)}`
}

const KIND_TEXT = {
  new: 'New approval',
  reminder: 'Reminder: waiting 24 hours',
  escalated: 'Escalated to you (48 hours)',
}

const fmt = (iso) => {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function wrap(card) {
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card }] }
}

/** Adaptive Card for one approval. kind: new | reminder | escalated. Pure. */
export function approvalCard(task, kind = 'new', base = appBaseUrl()) {
  const who = kind === 'escalated' ? task.escalated_to : (task.approvers && task.approvers.length ? task.approvers.join(' and ') : task.assigned_to)
  const facts = [
    task.approval_area && { title: 'Area', value: task.area_label || task.approval_area },
    who && { title: kind === 'escalated' ? 'Backup' : 'Approver', value: who },
    task.agent_id && { title: 'From', value: task.agent_id },
    task.expires_at && { title: 'Expires', value: fmt(task.expires_at) },
  ].filter(Boolean)
  return wrap({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: KIND_TEXT[kind] || KIND_TEXT.new, size: 'Small', weight: 'Bolder', color: kind === 'new' ? 'Accent' : 'Attention' },
      { type: 'TextBlock', text: task.title || 'Approval', size: 'Medium', weight: 'Bolder', wrap: true },
      facts.length && { type: 'FactSet', facts },
    ].filter(Boolean),
    actions: [{ type: 'Action.OpenUrl', title: 'Open in doddl PM', url: approvalLink(task.id, base) }],
  })
}

/** Adaptive Card for one person's 08:00 summary. Pure. */
export function summaryCard(person, s, base = appBaseUrl()) {
  const items = (s.items || []).slice(0, 10).map(i => ({
    type: 'TextBlock', wrap: true, spacing: 'Small',
    text: `${i.overdue ? '**Overdue** · ' : ''}${i.escalated ? '**Escalated** · ' : ''}[${i.title}](${approvalLink(i.id, base)})`,
  }))
  return wrap({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: `Good morning ${person}: approvals for today`, size: 'Medium', weight: 'Bolder', wrap: true },
      { type: 'FactSet', facts: [
        { title: 'Waiting', value: String(s.waiting || 0) },
        { title: 'Due today', value: String(s.due_today || 0) },
        { title: 'Overdue', value: String(s.overdue || 0) },
        { title: 'Escalated', value: String(s.escalated || 0) },
      ] },
      ...items,
      (s.items || []).length > 10 && { type: 'TextBlock', text: `and ${s.items.length - 10} more`, isSubtle: true },
    ].filter(Boolean),
    actions: [{ type: 'Action.OpenUrl', title: 'Open Approvals', url: `${base}/?view=approvals` }],
  })
}

async function post(payload, { url, fetchImpl }) {
  if (!url) {
    console.log('teams: not configured')
    return { posted: false, reason: 'not configured' }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal })
    if (!r.ok) {
      console.error(`teams: webhook answered ${r.status}`)
      return { posted: false, reason: `status ${r.status}` }
    }
    return { posted: true }
  } catch (e) {
    console.error('teams: post failed:', e.name === 'AbortError' ? 'timeout' : e.message)
    return { posted: false, reason: 'error' }
  } finally {
    clearTimeout(timer)
  }
}

/** { postApproval(task, kind), postSummary(person, summary) }. The webhook URL is never logged. */
export function createTeams({ url = process.env.TEAMS_APPROVALS_WEBHOOK_URL, fetchImpl = globalThis.fetch, base = appBaseUrl() } = {}) {
  return {
    configured: !!url,
    postApproval: (task, kind = 'new') => post(approvalCard(task, kind, base), { url, fetchImpl }),
    postSummary: (person, summary) => post(summaryCard(person, summary, base), { url, fetchImpl }),
  }
}
