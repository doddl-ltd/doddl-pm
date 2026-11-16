import { adminClient } from '../../../lib/server/admin'
import { constantTimeEqual } from '../../../lib/server/credentials'
import { runMasterAudit } from '../../../lib/pm/masterAudit'

// Vercel cron, daily after HQ's read of every Amazon listing: every listing compared with its master, field by field
// and attribute by attribute (migration 36). Raises a draft Seller Support case where Amazon has not applied what was
// sent. Reads only; nothing is written to Amazon.
export const config = { maxDuration: 120 }

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || !constantTimeEqual(String(req.headers.authorization || ''), `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'unauthorised' })
  }
  try {
    return res.status(200).json(await runMasterAudit(adminClient('system')))
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message })
  }
}
