import { uiRoute } from '../../../lib/server/uiRoute'
import { productCategories, suggestCategories, decideCategory } from '../../../lib/pm/categories'

// Per-store categories (migration 41, lib/pm/categories.js).
// GET  /api/listings/categories?asin=                       each store: current browse nodes named, Amazon's ranked categories, the chosen one
// POST { op: 'suggest', asin }                              Claude suggests each store's category from Amazon's own names (about $0.05)
// POST { op: 'approve' | 'reject', asin, market }           a person's decision; an approved category is sent like any other piece
export const config = { maxDuration: 120 }

export default uiRoute({
  GET: async ({ req, db }) => ({ stores: await productCategories(db, req.query.asin) }),
  POST: async ({ req, db, user }) => {
    const b = req.body || {}
    return b.op === 'suggest' ? suggestCategories(db, user, b) : decideCategory(db, user, b)
  },
})
