import { agentRoute } from '../../../lib/server/agentRoute'
import { syncWorkstream } from '../../../lib/pm/programmes'

// POST /api/agent/workstreams { kind, title, programme?, key?, project? }
// Links an agent / session / chat to its PM project (creating programme + project if needed).
export default agentRoute({
  POST: {
    scope: 'tasks:write',
    run: (req, db, principal) => syncWorkstream(db, principal, req.body || {}),
  },
})
