import { uiRoute, q } from '../../../../lib/server/uiRoute'
import { getListing } from '../../../../lib/pm/hq'

// GET /api/listings/:asin/:marketplace  -> { product, fields[], events[], approvals[] (listing_change approvals for it) }
export default uiRoute({
  GET: ({ req, db }) => getListing(db, q(req, 'asin'), q(req, 'marketplace')),
})
