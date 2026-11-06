import { adminClient } from '../../../lib/server/admin'
import { constantTimeEqual } from '../../../lib/server/credentials'
import { runApprovalClock } from '../../../lib/pm/approvals'
import { createTeams } from '../../../lib/server/teams'

// Vercel cron, hourly (docs/approvals-v2/CONTRACT.md "The clock"): for every open approval with an expiry,
//   24h without a decision -> remind the approver(s) in the app and on Teams (reminded_at)
//   48h                    -> escalate to the area's backup (escalated_to / escalated_at); they can now see and answer it
//   expires_at (72h, or a daily pack's reply-by time) -> decision 'expired' by 'system'
// Authorised with CRON_SECRET, like auto-triage.
export const config = { maxDuration: 120 }

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || !constantTimeEqual(String(req.headers.authorization || ''), `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'unauthorised' })
  }
  const summary = await runApprovalClock(adminClient('system'), { teams: createTeams() })
  return res.status(summary.errors.length && !summary.reminded && !summary.escalated && !summary.expired ? 500 : 200).json(summary)
}
