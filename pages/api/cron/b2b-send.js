import { adminClient } from '../../../lib/server/admin'
import { constantTimeEqual } from '../../../lib/server/credentials'
import { runSend } from '../../../lib/pm/b2bMail'

// Vercel cron, every 10 minutes (docs/b2b-campaigns/OUTREACH-MAIL.md "Sending"): for each warming/active trade mailbox
// inside its send window (Europe/London) with allowance left: queued retries and approved daily-batch lines, then
// follow-ups, then new businesses, each passing every hard rule. At most allowance / runs-left per run (randomly
// rounded, max 3), spaced 20–50 s apart. Nothing sends while the footer's registered address is TO CONFIRM.
// Authorised with CRON_SECRET, like the other crons.
export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || !constantTimeEqual(String(req.headers.authorization || ''), `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'unauthorised' })
  }
  const out = await runSend(adminClient('doddl PM outreach'))
  return res.status(out.errors && out.errors.length && !out.sent ? 500 : 200).json(out)
}
