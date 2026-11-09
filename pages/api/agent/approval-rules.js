import { agentRoute } from '../../../lib/server/agentRoute'
import { rulesForAgent } from '../../../lib/pm/approvals'

// GET /api/agent/approval-rules -> { rules[] }. Stamps last_read_by / last_read_at with the agent's id.
export default agentRoute({
  GET: { scope: 'tasks:read', run: (req, db, principal) => rulesForAgent(db, principal.agent_id) },
})
