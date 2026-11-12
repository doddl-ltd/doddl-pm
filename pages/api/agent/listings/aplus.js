import { agentRoute } from '../../../../lib/server/agentRoute'
import { listAplusForHq, updateAplusFromHq } from '../../../../lib/pm/aplus'

// GET   /api/agent/listings/aplus?status=submitted|in_approval|sent  -> { items: [{ asin, market, modules, images, ... }] }
// PATCH /api/agent/listings/aplus  { updates: [{ asin, market, status, note?, ref?, approval_task_id?, proposal_id? }] }
// HQ reads the A+ pages sent for approval per market and reports back what happened to each.
export default agentRoute({
  GET: { scope: 'listings:write', run: (req, db) => listAplusForHq(db, Array.isArray(req.query.status) ? req.query.status[0] : req.query.status) },
  PATCH: { scope: 'listings:write', run: (req, db) => updateAplusFromHq(db, req.body || {}) },
})
