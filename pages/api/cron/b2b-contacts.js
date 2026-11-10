import { adminClient } from '../../../lib/server/admin'
import { constantTimeEqual } from '../../../lib/server/credentials'
import { runContacts } from '../../../lib/pm/b2bMail'

// Vercel cron, every 10 minutes (docs/b2b-campaigns/OUTREACH-MAIL.md "Contacts"): PM's deterministic website extractor
// for approved / found businesses not yet checked (max 12 a run): home page, /contact, /contact-us, /about, robots.txt
// honoured, 5 s timeout, 2 pages a second. Role addresses -> usable; personal ones -> suggested for a person. MX checked.
export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || !constantTimeEqual(String(req.headers.authorization || ''), `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'unauthorised' })
  }
  const out = await runContacts(adminClient('doddl PM contacts'))
  return res.status(200).json(out)
}
