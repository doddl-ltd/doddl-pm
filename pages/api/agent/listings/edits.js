import { agentRoute } from '../../../../lib/server/agentRoute'
import { listEditsForHq, updateEditsFromHq } from '../../../../lib/pm/hq'

// GET   /api/agent/listings/edits?status=submitted|in_approval  -> { edits: [...] } (with each listing's seller SKU)
// PATCH /api/agent/listings/edits  { updates: [{ id, status: in_approval|refused|sent|proposed, proposal_id?, approval_task_id?, hq_note? }] }
// HQ reads the edits Jon sent for approval and reports back what happened to each.
export default agentRoute({
  GET: { scope: 'listings:write', run: (req, db) => listEditsForHq(db, Array.isArray(req.query.status) ? req.query.status[0] : req.query.status) },
  PATCH: { scope: 'listings:write', run: (req, db) => updateEditsFromHq(db, req.body || {}) },
})
