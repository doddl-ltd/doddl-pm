import { agentRoute } from '../../../lib/server/agentRoute'
import { submitForApproval } from '../../../lib/pm/ops'
import { createTeams } from '../../../lib/server/teams'

// POST /api/agent/artefacts
// Body: { task_id?, artefact_type, artefact, staging_url?, approval_area?, expires_at?, weekly_spend? } — without
// task_id, also pass create-task fields (title, project/project_id, ...) and a new approval task is created.
// approval_area sets the approver(s) from approval_rules (assigned_to overrides the first approver); the
// approval expires at expires_at, a daily pack's reply-by time, or after 72 hours. A decided task is immutable.
export default agentRoute({
  POST: {
    scope: 'approvals:write',
    run: (req, db, principal) => submitForApproval(db, principal, req.body || {}, { teams: createTeams() }),
  },
})
