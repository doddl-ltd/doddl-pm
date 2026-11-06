import { agentRoute, queryParam } from '../../../../lib/server/agentRoute'
import { listComments, addComment, loadApproval } from '../../../../lib/pm/approvals'

// GET  /api/agent/comments/:task_id   -> { comments[] }
// POST /api/agent/comments/:task_id   { body, anchor? } -> the comment, authored as agent:<id>
export default agentRoute({
  GET: {
    scope: 'tasks:read',
    run: async (req, db) => { const t = await loadApproval(db, queryParam(req, 'task_id')); return { comments: await listComments(db, t.id) } },
  },
  POST: {
    scope: 'approvals:write',
    run: (req, db, principal) => addComment(db, principal.actor, { ...(req.body || {}), task_id: queryParam(req, 'task_id') }),
    status: 201,
  },
})
