import { adminClient } from '../../../lib/server/admin'
import { constantTimeEqual } from '../../../lib/server/credentials'
import { runAutoTriage, createClaudeClient, AUTO_ACTOR, DEFAULT_THRESHOLD } from '../../../lib/pm/autoTriage'

// Vercel cron, every 5 minutes: Claude files captured actions (lib/pm/autoTriage.js).
// Off without ANTHROPIC_API_KEY or with AUTO_TRIAGE=off: items then simply wait in Triage.
export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || !constantTimeEqual(String(req.headers.authorization || ''), `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'unauthorised' })
  }
  if (process.env.AUTO_TRIAGE === 'off') return res.status(200).json({ enabled: false, reason: 'AUTO_TRIAGE=off' })
  if (!process.env.ANTHROPIC_API_KEY) return res.status(200).json({ enabled: false, reason: 'ANTHROPIC_API_KEY not set' })
  const threshold = Number(process.env.AUTO_TRIAGE_THRESHOLD) || DEFAULT_THRESHOLD
  const summary = await runAutoTriage({ db: adminClient(AUTO_ACTOR), claude: createClaudeClient(), threshold })
  // 503 when paused (credit, key, outage) so the failure shows in Vercel's cron and function logs.
  const status = summary.paused ? 503 : summary.errors.length && !summary.filed && !summary.needs_review ? 500 : 200
  return res.status(status).json({ enabled: true, threshold, ...summary })
}
