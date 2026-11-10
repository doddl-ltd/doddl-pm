import { adminClient } from '../../../../lib/server/admin'
import { finishConnect, CONNECT_COOKIE } from '../../../../lib/pm/b2bMail'

// GET /api/b2b/mailboxes/callback?code=&state= (Microsoft redirects here). No MSAL header can ride on a redirect, so
// the caller is proved by the encrypted cookie set by POST /connect (state + PKCE verifier + who, 10 minutes).
// Always ends on the app: /?view=mailboxes&connected=<address> or &mailbox_error=<code>.
function cookieValue(req, name) {
  const raw = String(req.headers.cookie || '')
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end() }
  res.setHeader('Set-Cookie', `${CONNECT_COOKIE}=; Path=/api/b2b/mailboxes; Max-Age=0; HttpOnly; Secure; SameSite=Lax`)
  res.setHeader('Cache-Control', 'no-store')
  let out
  try {
    out = await finishConnect(adminClient('mailbox connect'), { query: req.query || {}, cookie: cookieValue(req, CONNECT_COOKIE) })
  } catch (e) {
    console.error('b2b mailbox callback:', e.message)
    out = { error: 'server' }
  }
  const q = new URLSearchParams({ view: 'mailboxes' })
  if (out.address) q.set('connected', out.address)
  else q.set('mailbox_error', out.error || 'unknown')
  res.writeHead(302, { Location: `/?${q}` })
  return res.end()
}
