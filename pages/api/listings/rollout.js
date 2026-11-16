import { uiRoute } from '../../../lib/server/uiRoute'
import { getRollout, rolloutOp } from '../../../lib/pm/rollout'

// GET  /api/listings/rollout[?asin=]   one product's rollout (every store x every piece, from the master to live on
//                                       Amazon), or every product's summary
// POST /api/listings/rollout { op: start | stop | push, asin, budget?, markets? }
//        start  the listing agent starts making this product's translations and images (within the budget, USD)
//        stop   pause the agent for this product
//        push   send what is approved to Amazon: listing edits that Doddl HQ checks and asks approval for, as before
export const config = { maxDuration: 60 }

export default uiRoute({
  GET: async ({ req, db }) => getRollout(db, { asin: req.query.asin }),
  POST: async ({ req, db, user }) => rolloutOp(db, user, req.body || {}),
})
