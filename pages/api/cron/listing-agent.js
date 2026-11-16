import { adminClient } from '../../../lib/server/admin'
import { constantTimeEqual } from '../../../lib/server/credentials'
import { runListingAgent } from '../../../lib/pm/listingAgent'

// Vercel cron every 10 minutes: the listing agent (lib/pm/listingAgent.js) makes what is missing for every approved
// master whose rollout a person started: translations with Brand Analytics keywords, translated images, A+ translations.
// Within each rollout's budget. Everything it makes waits for a person; nothing is written to Amazon.
export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || !constantTimeEqual(String(req.headers.authorization || ''), `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'unauthorised' })
  }
  try {
    return res.status(200).json(await runListingAgent(adminClient('system'), { deadline: Date.now() + 280_000 }))
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message })
  }
}
