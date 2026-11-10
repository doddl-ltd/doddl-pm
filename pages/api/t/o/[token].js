import { adminClient } from '../../../../lib/server/admin'
import { trackOpen } from '../../../../lib/pm/b2bMail'

// Public (no sign-in): the 1x1 open pixel /api/t/o/<token>.gif. Only present in e-mails of campaigns that switched
// opens on, and only recorded for those; always answers with the same transparent GIF.
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export default async function handler(req, res) {
  const token = String(req.query.token || '').replace(/\.gif$/i, '')
  if (req.method === 'GET') {
    try { await trackOpen(adminClient('tracking'), { token, userAgent: String(req.headers['user-agent'] || '') }) } catch (e) { console.error('b2b open:', e.message) }
  }
  res.setHeader('Content-Type', 'image/gif')
  res.setHeader('Cache-Control', 'no-store, private')
  res.setHeader('Content-Length', GIF.length)
  return res.status(200).end(req.method === 'HEAD' ? undefined : GIF)
}
