import { uiRoute, q } from '../../../lib/server/uiRoute'
import { addComment, resolveComment, listComments, loadApproval } from '../../../lib/pm/approvals'

// GET   /api/approvals/comment?task_id=<uuid>   the approval's comments, oldest first
// POST  /api/approvals/comment  { task_id, body, anchor? }   anchor: {kind:'time',t} | {kind:'point',placement,x,y} | {kind:'field',field} | {kind:'line',line_id}
// PATCH /api/approvals/comment  { id, resolved?: true|false }  resolve (or reopen) a comment
export default uiRoute({
  GET: async ({ req, db }) => {
    const t = await loadApproval(db, q(req, 'task_id'))
    return { comments: await listComments(db, t.id) }
  },
  POST: ({ req, db, user }) => addComment(db, user.name, req.body || {}),
  PATCH: ({ req, db, user }) => resolveComment(db, user.name, { id: (req.body || {}).id, resolved: (req.body || {}).resolved !== false }),
}, { status: { POST: 201 } })
