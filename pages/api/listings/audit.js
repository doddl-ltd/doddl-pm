import { uiRoute } from '../../../lib/server/uiRoute'
import { getMasterAudit, runMasterAudit } from '../../../lib/pm/masterAudit'

// GET  /api/listings/audit[?asin=]   the latest master check, one row per listing
// POST /api/listings/audit            run the check now (it also runs daily after HQ reads Amazon)
export const config = { maxDuration: 120 }

export default uiRoute({
  GET: async ({ req, db }) => getMasterAudit(db, { asin: req.query.asin }),
  POST: async ({ db }) => runMasterAudit(db),
})
