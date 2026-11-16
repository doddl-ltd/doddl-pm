import { adminClient } from '../../../lib/server/admin'
import { constantTimeEqual } from '../../../lib/server/credentials'
import { syncMediaLibrary } from '../../../lib/pm/mediaLibrary'

// Vercel cron, daily: refresh the image library index from OneDrive "doddl HQ Knowledge/14 Media/imagery-index.csv".
export const config = { maxDuration: 120 }

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || !constantTimeEqual(String(req.headers.authorization || ''), `Bearer ${secret}`)) return res.status(401).json({ error: 'unauthorised' })
  try { return res.status(200).json(await syncMediaLibrary(adminClient('system'))) } catch (e) { return res.status(e.status || 500).json({ error: e.message }) }
}
