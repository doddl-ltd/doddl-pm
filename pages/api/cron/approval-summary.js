import { adminClient } from '../../../lib/server/admin'
import { constantTimeEqual } from '../../../lib/server/credentials'
import { runDailySummary, londonParts } from '../../../lib/pm/approvals'
import { createTeams } from '../../../lib/server/teams'

// Vercel cron at 07:00 and 08:00 UTC; only the run that lands on 08:00 UK time posts, so the summary
// follows British Summer Time without changing the schedule. One Teams card per approver: waiting,
// due today, overdue, escalated. ?force=1 posts now (still needs CRON_SECRET).
export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || !constantTimeEqual(String(req.headers.authorization || ''), `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'unauthorised' })
  }
  const hour = londonParts(new Date()).hour
  if (hour !== 8 && req.query.force !== '1') return res.status(200).json({ skipped: true, reason: `UK hour is ${hour}, the summary goes at 08:00` })
  const teams = createTeams()
  const out = await runDailySummary(adminClient('system'), { teams })
  return res.status(200).json({ teams_configured: teams.configured, ...out })
}
