import { requireUser } from '../../../lib/server/msalVerify'
import { AMAZON_IMAGE, UPLOADED_IMAGE } from '../../../lib/pm/hq'

// GET /api/listings/image-proxy?url=   one listing image (Amazon's or the listing image store's) served from doddlHQ's own
// address, so the browser can repaint it on a canvas (image translation). Only those two hosts; signed-in people only.
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end() }
  const user = await requireUser(req, res)
  if (!user) return
  const url = String(req.query.url || '')
  if (!(AMAZON_IMAGE.test(url) || UPLOADED_IMAGE.test(url))) return res.status(400).json({ error: 'url must be an Amazon image or one in the listing image store' })
  const r = await fetch(url)
  if (!r.ok) return res.status(502).json({ error: `Could not fetch the image (${r.status})` })
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Image over 25 MB' })
  res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg')
  res.setHeader('Cache-Control', 'private, max-age=3600')
  return res.status(200).send(buf)
}
