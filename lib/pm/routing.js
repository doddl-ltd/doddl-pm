// Fixed homes for captured work (Jon, 2026-10-21):
//   meeting notes                       -> project "Meeting Note Actions", one group per meeting named
//                                          "<date> · <meeting title>", every action a task in it
//   Teams "Send to doddl PM" + flagged  -> project "Adhoc Teams / Emails Tasks", every action a task
//   e-mails
// These are filed as they come, with no Claude call: doddl-transcribe already extracted the actions (owner,
// due date) from the meeting, message or e-mail, and a person chose to send the message or flag the e-mail.
// Claude chats and agents still go through auto-triage (lib/pm/autoTriage.js).

export const ROUTES = {
  meeting: { project: 'Meeting Note Actions', groupPerItem: true, description: 'Actions from meeting notes (doddl-transcribe). One group per meeting, named with its date.' },
  teams: { project: 'Adhoc Teams / Emails Tasks', description: 'Tasks from Teams messages sent to doddl PM and from flagged e-mails, awaiting completion.' },
  email: { project: 'Adhoc Teams / Emails Tasks', description: 'Tasks from Teams messages sent to doddl PM and from flagged e-mails, awaiting completion.' },
}

export function routeFor(item) {
  return (item && ROUTES[item.source]) || null
}

/** "21 Oct 2026 · Weekly catch-up": the meeting's UK date, then its calendar title. */
export function meetingGroupName(item) {
  const when = Date.parse(item.occurred_at || item.created_at || '')
  const date = Number.isFinite(when)
    ? new Date(when).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' })
    : 'Undated'
  const title = String((item.payload && item.payload.subject) || item.title || 'Meeting').replace(/\s+/g, ' ').trim()
  return `${date} · ${title}`.slice(0, 200)
}

/** Newest meeting first: groups sort by position ascending, so use minus the meeting's minute. */
export function meetingGroupPosition(item) {
  const when = Date.parse(item.occurred_at || item.created_at || '')
  return Number.isFinite(when) ? -Math.floor(when / 60000) : 0
}

function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
}

/**
 * Pure: the create operations for a routed item. Owners must be real people (else unassigned), dates valid.
 * @returns {{index:number, op:'create', title:string, assigned_to:string|null, due_date:string|null, confidence:number, reason:string}[]}
 */
export function routedOps(item, actions, people, reason) {
  const byName = new Map(people.map(n => [String(n).toLowerCase(), n]))
  return actions.map((a, index) => ({
    index,
    op: 'create',
    title: String(a.title || item.title || 'Captured action').slice(0, 300),
    assigned_to: a.assigned_to ? byName.get(String(a.assigned_to).trim().toLowerCase()) || null : null,
    due_date: isIsoDate(a.due_date) ? a.due_date : null,
    status: null,
    progress: null,
    confidence: 1,
    reason,
  }))
}
