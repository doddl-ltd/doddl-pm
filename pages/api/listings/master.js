import { uiRoute } from '../../../lib/server/uiRoute'
import { saveMasterChange } from '../../../lib/pm/hq'

// POST /api/listings/master { asin, op: copy|attribute|keep|images|approve|reopen, ... } -> the master
// The master listing (UK English copy, one attribute set, images per locale). Nothing here is sent to Amazon.
export default uiRoute({
  POST: ({ req, db, user }) => saveMasterChange(db, user, req.body || {}),
})
