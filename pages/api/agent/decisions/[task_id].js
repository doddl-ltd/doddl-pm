import { agentRoute, queryParam } from '../../../../lib/server/agentRoute'
import { getDecision } from '../../../../lib/pm/ops'

// GET /api/agent/decisions/:task_id
// -> { id, title, task_type, approval_area, approvers, expires_at, escalated_to, decision, decision_by, decision_at,
//      decision_notes, decision_edits, line_decisions, reject_reason, votes[], waiting_on[], pending }
export default agentRoute({
  GET: { scope: 'tasks:read', run: (req, db) => getDecision(db, queryParam(req, 'task_id')) },
})
