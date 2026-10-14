import { adminClient } from '../../lib/server/admin'
import { requireUser } from '../../lib/server/msalVerify'
import { listInbox, triageInbox } from '../../lib/pm/ops'

// Triage screen API (signed-in doddl staff).
// GET  /api/triage?status=new
// POST /api/triage { id, decision: accept|dismiss, accept_actions?, edits?, project_id?, notes? }
export default async function handler(req, res) {
  const user = await requireUser(req, res)
  if (!user) return
  const db = adminClient(user.name)
  const principal = { actor: user.name, agent_id: null, on_behalf_of: null, scopes: [] }
  try {
    if (req.method === 'GET') {
      return res.status(200).json(await listInbox(db, { status: req.query.status || 'new', limit: req.query.limit, offset: req.query.offset }))
    }
    if (req.method === 'POST') {
      const { id, ...rest } = req.body || {}
      return res.status(200).json(await triageInbox(db, principal, id, rest))
    }
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    if (e.expose) return res.status(e.status || 400).json({ error: e.message })
    throw e
  }
}
