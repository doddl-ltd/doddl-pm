import { agentRoute } from '../../../lib/server/agentRoute'
import { addLink } from '../../../lib/pm/ops'

// POST /api/agent/links  { task_id, url, kind?, label? } — evidence for a task.
export default agentRoute({
  POST: {
    scope: 'tasks:write',
    run: (req, db, principal) => { const b = req.body || {}; return addLink(db, principal, b.task_id, b) },
    status: 201,
  },
})
