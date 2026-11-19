import { uiRoute, q } from '../../../lib/server/uiRoute'
import { listEvidenceAll } from '../../../lib/pm/familiesServer'

// GET /api/listings/evidence?store=UK&asin=B0...&reason=daily|before|after&from=YYYY-MM-DD&to=YYYY-MM-DD
// -> every evidence snapshot (newest first, up to 400) with short-lived screenshot links.
export default uiRoute({
  GET: ({ req, db }) => listEvidenceAll(db, { store: q(req, 'store'), asin: q(req, 'asin'), reason: q(req, 'reason'), from: q(req, 'from'), to: q(req, 'to') }),
})
