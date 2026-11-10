import { uiRoute } from '../../../../lib/server/uiRoute'
import { listMailboxes } from '../../../../lib/pm/b2bMail'

// GET /api/b2b/mailboxes  { is_admin, setup {ready, missing[], redirect_uri, admin_consent_url}, mailboxes[] } with health:
// status, warm-up week, today's allowance / sent, 7-day sends, bounce and reply rate, last poll, reason if paused.
// Every signed-in person can read it (the go-live card lists the mailboxes); no token is ever returned.
export default uiRoute({
  GET: ({ db, user }) => listMailboxes(db, user.name),
})
