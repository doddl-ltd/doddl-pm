import { uiRoute, q } from '../../../../lib/server/uiRoute'
import { rulesWithLog } from '../../../../lib/pm/approvals'

// GET /api/approvals/rules[?log_limit=100]  -> { rules[], log[] (newest first) }
export default uiRoute({
  GET: ({ req, db }) => rulesWithLog(db, { limit: q(req, 'log_limit') }),
})
