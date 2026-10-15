import { agentRoute } from '../../../lib/server/agentRoute'
import { submitForApproval } from '../../../lib/pm/ops'

// POST /api/agent/artefacts
// Body: { task_id?, artefact_type, artefact, staging_url? } — without task_id,
// also pass create-task fields (title, project/project_id, ...) and a new
// approval task is created. A task that already has a decision is immutable.
export default agentRoute({
  POST: {
    scope: 'approvals:write',
    run: (req, db, principal) => submitForApproval(db, principal, req.body || {}),
  },
})
