import { uiRoute, q } from '../../../../lib/server/uiRoute'
import { patchMailbox } from '../../../../lib/pm/b2bMail'

// PATCH /api/b2b/mailboxes/:id (PM admin) { daily_cap?, send_days?, send_window? {from, to}, signature_html?, display_name? }
// or { action: pause | resume | disconnect, reason? }. Disconnect deletes the stored token; queued e-mails move to the
// campaign's other mailboxes.
export default uiRoute({
  PATCH: ({ req, db, user }) => patchMailbox(db, user.name, q(req, 'id'), req.body || {}),
})
