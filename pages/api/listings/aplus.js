import { uiRoute, q } from '../../../lib/server/uiRoute'
import { aplusOp } from '../../../lib/pm/aplus'
import { approvalError as fail } from '../../../lib/pm/approvals'

// GET  /api/listings/aplus?asin=   -> { page, products: [{ marketplace, aplus }] } (the page and each market's A+ on Amazon)
// POST /api/listings/aplus { asin, op, ... }   brief, images, build (Claude, about $0.20), edit, approve, translate, send
// Nothing here writes to Amazon: "send" hands each market to HQ for checks and an approval card.
export const config = { maxDuration: 120 }

export default uiRoute({
  GET: async ({ req, db }) => {
    const asin = String(q(req, 'asin') || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) throw fail(400, 'asin is required')
    const [page, products, master] = await Promise.all([
      db.from('listing_aplus').select('*').eq('asin', asin).maybeSingle(),
      db.from('listing_products').select('marketplace, aplus, checked_at').eq('asin', asin),
      db.from('listing_masters').select('product, copy').eq('asin', asin).maybeSingle(),
    ])
    for (const r of [page, products, master]) if (r.error) throw fail(500, r.error.message)
    return { page: page.data || null, products: products.data || [], product: master.data ? master.data.product : null }
  },
  POST: ({ req, db, user }) => aplusOp(db, user, req.body || {}),
})
