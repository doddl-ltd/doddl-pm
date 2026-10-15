import { adminClient } from '../../../lib/server/admin'
import { exchangeCode, refreshTokens, OAuthError } from '../../../lib/server/oauth'

// Token endpoint. Accepts application/x-www-form-urlencoded (Claude's
// format, parsed by Next's default body parser) and JSON.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', 'content-type'); return res.status(204).end() }
  if (req.method !== 'POST') return res.status(405).json({ error: 'invalid_request', error_description: 'POST only' })
  const body = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : (req.body || {})
  try {
    const db = adminClient('oauth-token')
    if (body.grant_type === 'authorization_code') return res.status(200).json(await exchangeCode(db, body))
    if (body.grant_type === 'refresh_token') return res.status(200).json(await refreshTokens(db, body))
    throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token')
  } catch (e) {
    if (e instanceof OAuthError) return res.status(e.status).json({ error: e.code, error_description: e.message })
    throw e
  }
}
