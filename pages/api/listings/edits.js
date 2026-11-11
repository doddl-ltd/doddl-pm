import { uiRoute, q } from '../../../lib/server/uiRoute'
import { saveListingEdit, withdrawListingEdit } from '../../../lib/pm/hq'

// POST  /api/listings/edits        { asin, marketplace, kind: field|attribute, name, value, live?, note? } -> the saved edit
// PATCH /api/listings/edits?id=    withdraw a proposed edit -> the edit (status withdrawn)
// Edits are saved in PM only; nothing is sent to Amazon from here.
export default uiRoute({
  POST: ({ req, db, user }) => saveListingEdit(db, user, req.body || {}),
  PATCH: ({ req, db, user }) => withdrawListingEdit(db, user, q(req, 'id')),
})
