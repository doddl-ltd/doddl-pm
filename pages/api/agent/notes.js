import { agentRoute } from '../../../lib/server/agentRoute'
import { addNote } from '../../../lib/pm/ops'

// POST /api/agent/notes  { task_id, body } — appends a comment; never overwrites.
export default agentRoute({
  POST: {
    scope: 'tasks:write',
    run: (req, db, principal) => addNote(db, principal, (req.body || {}).task_id, (req.body || {}).body),
    status: 201,
  },
})
