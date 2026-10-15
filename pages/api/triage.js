import { adminClient } from '../../lib/server/admin'
import { requireUser } from '../../lib/server/msalVerify'
import { listInbox, triageInbox } from '../../lib/pm/ops'
import { undoAutoTriage } from '../../lib/pm/autoTriage'

// Triage screen API (signed-in doddl staff).
// GET  /api/triage?view=review            items that need a person (new / partial)
// GET  /api/triage?view=filed             what Claude filed automatically (latest first)
// POST /api/triage { id, decision: accept|dismiss|undo, accept_actions?, edits?, project_id?, notes? }
export default async function handler(req, res) {
  const user = await requireUser(req, res)
  if (!user) return
  const db = adminClient(user.name)
  const principal = { actor: user.name, agent_id: null, on_behalf_of: null, scopes: [] }
  try {
    if (req.method === 'GET') {
      const view = req.query.view || 'review'
      if (view === 'filed') {
        return res.status(200).json(await listInbox(db, { status: 'all', auto_status: 'filed,needs_review,undone', limit: req.query.limit || 50, offset: req.query.offset, onlyAutoTouched: true }))
      }
      return res.status(200).json(await listInbox(db, { status: req.query.status || 'new,partial', limit: req.query.limit, offset: req.query.offset }))
    }
    if (req.method === 'POST') {
      const { id, decision, ...rest } = req.body || {}
      if (decision === 'undo') return res.status(200).json(await undoAutoTriage(db, principal, id))
      return res.status(200).json(await triageInbox(db, principal, id, { decision, ...rest }))
    }
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    if (e.expose) return res.status(e.status || 400).json({ error: e.message })
    throw e
  }
}
