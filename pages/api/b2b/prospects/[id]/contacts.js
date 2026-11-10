import { uiRoute, q } from '../../../../../lib/server/uiRoute'
import { listProspectContacts, addContact } from '../../../../../lib/pm/b2bMail'

// People only (never an agent route).
// GET  /api/b2b/prospects/:id/contacts  { prospect, contacts[] }
// POST /api/b2b/prospects/:id/contacts  { email, first_name?, last_name?, role?, is_primary? } -> { contact, mx_ok } (201)
export default uiRoute({
  GET: ({ req, db }) => listProspectContacts(db, q(req, 'id')),
  POST: ({ req, db, user }) => addContact(db, user.name, q(req, 'id'), req.body || {}),
}, { status: { POST: 201 } })
