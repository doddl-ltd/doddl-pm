import { uiRoute } from '../../../lib/server/uiRoute'
import { decide } from '../../../lib/pm/approvals'

// POST /api/approvals/decide
// { task_id, outcome: approved|approved_with_edits|partially_approved|revision_requested|rejected,
//   notes?, edits?, lines?: {"<line_id>": approved|rejected|edited|push|keep|edit, "<line_id>:edit": value},
//   reject_reason?: timing|off_brand|evidence|other }
// -> { task_id, vote, decided, decision, waiting_on[] }
// Only the approver, the second approver (two-approver areas) or the escalated backup may answer.
export default uiRoute({
  POST: ({ req, db, user }) => decide(db, user.name, req.body || {}),
})
