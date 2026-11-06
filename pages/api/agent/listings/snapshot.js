import { agentRoute } from '../../../../lib/server/agentRoute'
import { postListingSnapshot } from '../../../../lib/pm/hq'

// POST /api/agent/listings/snapshot  { products: [], fields: [], events: [] }
// Bulk upsert: products on (asin, marketplace), fields on (asin, marketplace, field), events added once each.
// -> { products, fields, events_added }
export default agentRoute({
  POST: { scope: 'listings:write', run: (req, db) => postListingSnapshot(db, req.body || {}) },
})
