import { uiRoute, q } from '../../lib/server/uiRoute'
import { studio } from '../../lib/pm/hq'

// GET /api/studio[?type=ad|video|social|email|listing|amazon_ads|website|outreach|recipe][&include_done=1]
// -> { stages[], items[] (+ hours_in_stage, stuck, approval), counts, stuck[], approved_where[] }
export default uiRoute({
  GET: ({ req, db }) => studio(db, { type: q(req, 'type'), include_done: !!q(req, 'include_done') }),
})
