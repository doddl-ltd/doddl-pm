import { adminClient } from '../../../lib/server/admin'
import { constantTimeEqual } from '../../../lib/server/credentials'
import { runInbox } from '../../../lib/pm/b2bMail'

// Vercel cron, every 10 minutes (docs/b2b-campaigns/OUTREACH-MAIL.md "Inbox"): Graph delta on each trade mailbox's
// Inbox; bounces (hard -> suppression, soft -> one retry after 24 h), auto-replies (sequence pauses 7 days) and replies
// (rule classifier; sequence stops; a b2b_replies row for the named person, or auto for opt-outs / "not interested").
// Then mailbox / campaign health (auto-pause + alert) and the metrics roll-up. CRON_SECRET.
export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || !constantTimeEqual(String(req.headers.authorization || ''), `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'unauthorised' })
  }
  const out = await runInbox(adminClient('doddl PM outreach'))
  return res.status(out.errors && out.errors.length && !out.replies && !out.bounces ? 500 : 200).json(out)
}
