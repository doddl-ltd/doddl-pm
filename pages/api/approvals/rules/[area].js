import { uiRoute, q } from '../../../../lib/server/uiRoute'
import { adminClient } from '../../../../lib/server/admin'
import { updateRule } from '../../../../lib/pm/approvals'

// PUT /api/approvals/rules/:area  { changes: {approver?, backup?, second_approver?, spend_threshold_weekly?, threshold_currency?,
//   threshold_also_needs?, batch_mode?, batch_day?, reply_by?, max_pack?, label?, what?, note?}, reason, move_waiting? }
// Jon only (people.approval_admin). Logged in approval_rules_log. move_waiting moves undecided cards to the new approver.
// -> { rule, log_entry, moved }
export default uiRoute({
  PUT: ({ req, db, user }) => updateRule(db, adminClient(user.name), user.name, q(req, 'area'), req.body || {}),
})
