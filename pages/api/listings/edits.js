import { uiRoute, q } from '../../../lib/server/uiRoute'
import { saveListingEdit, submitListingEdits, withdrawListingEdit } from '../../../lib/pm/hq'

// POST  /api/listings/edits        { asin, marketplace, kind: field|attribute, name, value, live?, note? } -> the saved edit
// POST  /api/listings/edits        { action: 'submit', asin, marketplace } -> send that listing's saved edits for approval
// PATCH /api/listings/edits?id=    withdraw a proposed edit -> the edit (status withdrawn)
// Nothing is sent to Amazon from here: HQ checks submitted edits, raises the approval card, and only an approved change
// can be sent (and only once the send step is switched on).
export default uiRoute({
  POST: ({ req, db, user }) => ((req.body || {}).action === 'submit' ? submitListingEdits(db, user, req.body) : saveListingEdit(db, user, req.body || {})),
  PATCH: ({ req, db, user }) => withdrawListingEdit(db, user, q(req, 'id')),
})
