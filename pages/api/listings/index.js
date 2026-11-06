import { uiRoute, q } from '../../../lib/server/uiRoute'
import { listListings } from '../../../lib/pm/hq'

// GET /api/listings[?marketplace=UK]  -> { fields[], marketplaces[], counts, listings[] (+ cells {field: status}, overall, drifted) }
export default uiRoute({
  GET: ({ req, db }) => listListings(db, { marketplace: q(req, 'marketplace') }),
})
