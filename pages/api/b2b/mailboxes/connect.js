import { requireUser } from '../../../../lib/server/msalVerify'
import { adminClient } from '../../../../lib/server/admin'
import { startConnect } from '../../../../lib/pm/b2bMail'

// POST /api/b2b/mailboxes/connect { login_hint? } (PM admin) -> { url }. Sets an encrypted, httpOnly cookie (10 min)
// with the OAuth state, the PKCE verifier and who started it; the browser then opens url and signs in AS the trade
// mailbox. Microsoft returns to /api/b2b/mailboxes/callback.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }) }
  const user = await requireUser(req, res)
  if (!user) return
  try {
    const db = adminClient(user.name)
    const body = req.body || {}
    const out = await startConnect(db, user.name, { loginHint: typeof body.login_hint === 'string' ? body.login_hint.slice(0, 200) : undefined })
    res.setHeader('Set-Cookie', `${out.cookieName}=${out.cookie}; Path=/api/b2b/mailboxes; Max-Age=${out.maxAge}; HttpOnly; Secure; SameSite=Lax`)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ url: out.url })
  } catch (e) {
    if (e.expose) return res.status(e.status || 400).json({ error: e.message })
    console.error('b2b mailbox connect:', e.message)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
