import { uiRoute, q } from '../../../../lib/server/uiRoute'
import { patchReply } from '../../../../lib/pm/b2b'

// PATCH /api/b2b/replies/:id { status?: sent|closed|needs_person, draft? }. Sending is a person's action: answer from the
// trade mailbox in Outlook, then mark it sent here.
export default uiRoute({
  PATCH: ({ req, db, user }) => patchReply(db, user.name, q(req, 'id'), req.body || {}),
})
