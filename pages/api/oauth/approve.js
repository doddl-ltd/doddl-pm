import { adminClient } from '../../../lib/server/admin'
import { requireUser } from '../../../lib/server/msalVerify'
import { getClient, validateAuthorizeParams, issueCode, OAuthError } from '../../../lib/server/oauth'

// Called by /oauth/authorize after the signed-in person clicks Allow.
// Body: the authorize query params. Bearer: their MSAL ID token.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const user = await requireUser(req, res)
  if (!user) return
  const p = req.body || {}
  try {
    const db = adminClient(`oauth-approve (${user.name})`)
    validateAuthorizeParams(p, await getClient(db, p.client_id))
    const code = await issueCode(db, user, p)
    const target = new URL(p.redirect_uri)
    target.searchParams.set('code', code)
    if (p.state) target.searchParams.set('state', p.state)
    return res.status(200).json({ redirect: target.toString() })
  } catch (e) {
    if (e instanceof OAuthError) return res.status(e.status).json({ error: e.code, error_description: e.message })
    throw e
  }
}
