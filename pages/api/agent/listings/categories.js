import { agentRoute } from '../../../../lib/server/agentRoute'
import { saveCategories } from '../../../../lib/pm/categories'

// POST /api/agent/listings/categories { rows: [{ marketplace, asin, node, title, sales_rank, read_on }] } (scope
// keywords:write, migration 41): the categories Amazon ranks each doddl ASIN in, per store, sent daily by the Hub.
export const config = { api: { bodyParser: { sizeLimit: '8mb' } } }

export default agentRoute({
  POST: { scope: 'keywords:write', run: (req, db) => saveCategories(db, req.body || {}) },
})
