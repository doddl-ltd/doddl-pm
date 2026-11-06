import { uiRoute, q } from '../../../lib/server/uiRoute'
import { approvalsInbox, approvalDetail } from '../../../lib/pm/approvals'

// GET /api/approvals                  the signed-in person's approvals inbox:
//                                     { tiles: {waiting, overdue, due_today, escalated}, badge, mine[], others[], decided[], rules[] }
// GET /api/approvals?task_id=<uuid>   one approval with votes, waiting_on, comments and its area's rule
// GET /api/approvals?decided_days=30  how far back "Decided" goes
export default uiRoute({
  GET: ({ req, db, user }) => {
    const id = q(req, 'task_id')
    if (id) return approvalDetail(db, id)
    return approvalsInbox(db, user.name, { decided_days: q(req, 'decided_days') })
  },
})
