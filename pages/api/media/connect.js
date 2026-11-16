import { requireUser } from '../../../lib/server/msalVerify'
import { adminClient } from '../../../lib/server/admin'
import { startMediaConnect } from '../../../lib/pm/mediaLibrary'

// POST /api/media/connect (PM admin) -> { url }. The Microsoft sign-in for the image library: an encrypted 10-minute
// cookie carries the state and PKCE verifier to the shared callback (/api/b2b/mailboxes/callback), which sees the
// media cookie and finishes here (lib/pm/mediaLibrary finishMediaConnect).
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }) }
  const user = await requireUser(req, res)
  if (!user) return
  try {
    const out = await startMediaConnect(adminClient(user.name), user.name)
    res.setHeader('Set-Cookie', `${out.cookieName}=${out.cookie}; Path=/api/b2b/mailboxes; Max-Age=${out.maxAge}; HttpOnly; Secure; SameSite=Lax`)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ url: out.url })
  } catch (e) {
    if (e.expose) return res.status(e.status || 400).json({ error: e.message })
    console.error('media connect:', e.message)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
