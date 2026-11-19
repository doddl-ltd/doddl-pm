import { uiRoute, q } from '../../../lib/server/uiRoute'
import { listFamilies, getFamily, familyOp, listCleanup } from '../../../lib/pm/familiesServer'

// GET /api/listings/families             -> the overview (one row per family)
// GET /api/listings/families?code=P-...  -> one family's page
// GET /api/listings/families?view=cleanup -> the clean-up list across every family
// POST { op: sync | slot | keyword_add | keyword_remove | signoff | cleanup, family_code, ... }
// Nothing here writes to Amazon.
export default uiRoute({
  GET: ({ req, db }) => (q(req, 'view') === 'cleanup' ? listCleanup(db) : q(req, 'code') ? getFamily(db, q(req, 'code')) : listFamilies(db)),
  POST: ({ req, db, user }) => familyOp(db, user, req.body || {}),
})
