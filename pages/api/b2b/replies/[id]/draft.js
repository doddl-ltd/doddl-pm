import { uiRoute, q } from '../../../../../lib/server/uiRoute'
import { draftInOutlook } from '../../../../../lib/pm/b2bMail'

// POST /api/b2b/replies/:id/draft  "Draft in Outlook": a reply draft (with the reply's draft text, if any) in the trade
// mailbox, threaded on their e-mail. PM never sends it; the person finishes and sends it in Outlook. -> { web_link, mailbox }
export default uiRoute({
  POST: ({ req, db, user }) => draftInOutlook(db, user.name, q(req, 'id')),
})
