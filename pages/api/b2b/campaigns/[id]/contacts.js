import { uiRoute, q } from '../../../../../lib/server/uiRoute'
import { campaignContacts } from '../../../../../lib/pm/b2bMail'

// People only. GET /api/b2b/campaigns/:id/contacts  "Contacts to add": { suggested[] (found on websites, to accept or
// reject), missing[] (businesses with no usable address), counts }.
export default uiRoute({
  GET: ({ req, db }) => campaignContacts(db, q(req, 'id')),
})
