import { adminClient } from '../../../lib/server/admin'
import { registerClient, OAuthError } from '../../../lib/server/oauth'

// RFC 7591 dynamic client registration (public clients only; redirect URIs
// limited to Claude's callback and loopback). Registration alone grants
// nothing: tokens need a doddl person to sign in and click Allow.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', 'content-type'); return res.status(204).end() }
  if (req.method !== 'POST') return res.status(405).json({ error: 'invalid_request', error_description: 'POST only' })
  try {
    const client = await registerClient(adminClient('oauth-register'), req.body || {})
    return res.status(201).json(client)
  } catch (e) {
    if (e instanceof OAuthError) return res.status(e.status).json({ error: e.code, error_description: e.message })
    throw e
  }
}
