import { adminClient } from '../../lib/server/admin'
import { bearerFrom } from '../../lib/server/msalVerify'
import { resolveBearer, hasScope, constantTimeEqual } from '../../lib/server/credentials'
import { captureInbox } from '../../lib/pm/ops'

// Email / Teams intake (Power Automate). Captured items land in the triage
// inbox — a person accepts them into tasks — instead of becoming tasks
// directly. Request body is unchanged from the original flow:
//   { title, notes, source, assigned_to, assigned_email, message_id, project_id }
// Auth (new): header "x-intake-key: <INTAKE_KEY>" (Power Automate) or an
// agent bearer key with the inbox:write scope.
// Responses: 201 { id, message } when captured, 200 { id, message: 'duplicate skipped' }.

const TEAM = {
  'jon@doddl.com':       'Jon',
  'laura@doddl.com':     'Laura',
  'catherine@doddl.com': 'Cat',
  'finance@doddl.com':   'Chris',
  'hello@doddl.com':     'Cathy',
}

async function authorised(req) {
  const key = req.headers['x-intake-key']
  if (key && process.env.INTAKE_KEY && constantTimeEqual(String(key), process.env.INTAKE_KEY)) return 'intake:power-automate'
  const principal = await resolveBearer(bearerFrom(req), adminClient('auth'))
  if (principal && hasScope(principal, 'inbox:write')) return principal.actor
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const actor = await authorised(req)
  if (!actor) return res.status(401).json({ error: 'Missing or invalid x-intake-key' })

  const { title, notes, source, assigned_to, assigned_email, message_id, project_id } = req.body || {}
  if (!title) return res.status(400).json({ error: 'title is required' })

  const owner = assigned_to || (assigned_email ? TEAM[String(assigned_email).toLowerCase()] : null) || null
  const due = new Date()
  due.setDate(due.getDate() + 2)

  try {
    const out = await captureInbox(adminClient(actor), { actor, agent_id: actor }, {
      source: ['email', 'teams', 'teamsmaestro'].includes(source) ? source : 'email',
      source_ref: message_id || null,
      title,
      body: notes || null,
      participants: assigned_email ? [String(assigned_email).toLowerCase()] : [],
      assigned_to: owner && Object.values(TEAM).includes(owner) ? owner : null,
      proposed_actions: [{
        kind: 'create_task',
        title,
        assigned_to: owner && Object.values(TEAM).includes(owner) ? owner : undefined,
        project_id: project_id || undefined,
        due_date: due.toISOString().split('T')[0],
        notes: notes || undefined,
      }],
    })
    if (!out.created) return res.status(200).json({ message: 'duplicate skipped', id: out.id })
    return res.status(201).json({ message: 'captured for triage', id: out.id })
  } catch (e) {
    if (e.expose) return res.status(e.status || 400).json({ error: e.message })
    throw e
  }
}
