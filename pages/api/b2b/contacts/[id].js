import { uiRoute, q } from '../../../../lib/server/uiRoute'
import { patchContact } from '../../../../lib/pm/b2bMail'

// People only. PATCH /api/b2b/contacts/:id { first_name?, last_name?, role?, email?, is_primary? } or { action: accept | reject }.
// DELETE = reject (nothing is deleted; a rejected address is never mailed).
export default uiRoute({
  PATCH: ({ req, db, user }) => patchContact(db, user.name, q(req, 'id'), req.body || {}),
  DELETE: ({ req, db, user }) => patchContact(db, user.name, q(req, 'id'), { action: 'reject' }),
})
