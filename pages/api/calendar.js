import { uiRoute, q } from '../../lib/server/uiRoute'
import { calendar } from '../../lib/pm/hq'

// GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD  (inclusive, UK days; default this week Mon-Sun)
// -> { from, to, channels[], items[] (+ at, day, time, state: live|scheduled|waiting|planned, approval) }
export default uiRoute({
  GET: ({ req, db }) => calendar(db, { from: q(req, 'from'), to: q(req, 'to') }),
})
