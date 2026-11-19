import { uiRoute } from '../../../lib/server/uiRoute'
import { listRankAll } from '../../../lib/pm/familiesServer'

// GET /api/listings/rank -> every child ASIN in UK, DE, FR, US: best rank, stars, reviews, change on a week, alerts.
export default uiRoute({
  GET: ({ db }) => listRankAll(db),
})
