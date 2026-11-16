import { agentRoute } from '../../../../lib/server/agentRoute'
import { saveKeywords } from '../../../../lib/pm/keywords'

// POST /api/agent/listings/keywords { marketplace, rows: [{ asin, search_query, query_volume, asin_impressions,
//   asin_clicks, asin_purchases, is_brand_term, period_from, period_to }] }   (scope keywords:write, migration 40)
// The Hub sends each store's Brand Analytics searches per ASIN once a day (doddl-analytics agg.amazon_asin_keywords);
// the store's rows are replaced. The listing agent writes local keywords from them.
export const config = { api: { bodyParser: { sizeLimit: '8mb' } } }

export default agentRoute({
  POST: { scope: 'keywords:write', run: (req, db) => saveKeywords(db, req.body || {}) },
})
