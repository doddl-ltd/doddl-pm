import { agentRoute } from '../../../../lib/server/agentRoute'
import { addReplies } from '../../../../lib/pm/b2b'

// POST /api/agent/b2b/replies { replies: [{ campaign_id, prospect_hq_ref | prospect_id, kind, summary, draft?, assigned_to?,
// due_at?, ref? }] }  -> { added, replies: [{ id, status, assigned_to, due_at, created }] }
export default agentRoute({
  POST: { scope: 'b2b:write', run: (req, db) => addReplies(db, req.body || {}) },
})
