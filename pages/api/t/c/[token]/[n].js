import { adminClient } from '../../../../../lib/server/admin'
import { trackClick } from '../../../../../lib/pm/b2bMail'

// Public (no sign-in): a tracked link in a B2B e-mail. 302 ONLY to the URL stored on that message for link n; anything
// else is a 404 (no open redirect). HEAD requests, clicks within 60 s of sending and known link scanners are recorded
// as "scanner" and left out of reports.
export default async function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).end() }
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  let url = null
  try {
    url = await trackClick(adminClient('tracking'), { token: String(req.query.token || ''), n: String(req.query.n || ''), method: req.method, userAgent: String(req.headers['user-agent'] || '') })
  } catch (e) {
    console.error('b2b click:', e.message)
  }
  if (!url) return res.status(404).send('This link is not available.')
  res.writeHead(302, { Location: url })
  return res.end()
}
