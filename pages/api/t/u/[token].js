import { adminClient } from '../../../../lib/server/admin'
import { optOutInfo, optOut } from '../../../../lib/pm/b2bMail'
import { escapeHtml } from '../../../../lib/b2bMail/rules'

// Public (no sign-in, no tracking): the opt-out link in every B2B e-mail.
//   GET  shows a confirm page (a GET never opts out, so link scanners cannot unsubscribe people by accident)
//   POST (one click) suppresses the address, and with the box ticked the whole business; every sequence stops.
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;background:#f6f4fa;color:#222;margin:0;padding:24px 16px}main{max-width:520px;margin:40px auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e4dff0}h1{font-size:22px;margin:0 0 12px;color:#3D157D}p{line-height:1.5}button{background:#3D157D;color:#fff;border:0;border-radius:10px;font-size:16px;font-weight:700;padding:12px 20px;min-height:44px;cursor:pointer}label{display:flex;gap:8px;align-items:flex-start;margin:14px 0;line-height:1.4}input{width:20px;height:20px;margin:0}</style></head><body><main>${body}</main></body></html>`

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('X-Robots-Tag', 'noindex')
  const token = String(req.query.token || '')
  const db = adminClient('opt-out link')
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : (req.body || {})
      const r = await optOut(db, token, { wholeBusiness: body.business === '1' || body.business === 'on' || body.business === true })
      if (!r.ok) return res.status(404).send(page('Link not found', '<h1>This link is not available</h1><p>Reply “stop” to the e-mail and we will not contact you again.</p>'))
      return res.status(200).send(page('Unsubscribed', '<h1>You are unsubscribed</h1><p>doddl will not e-mail you again about this. Sorry for the bother.</p>'))
    }
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET, POST'); return res.status(405).send(page('Not allowed', '<h1>Not allowed</h1>')) }
    const info = await optOutInfo(db, token)
    if (!info.ok) return res.status(404).send(page('Link not found', '<h1>This link is not available</h1><p>Reply “stop” to the e-mail and we will not contact you again.</p>'))
    return res.status(200).send(page('Unsubscribe', `<h1>Stop e-mails from doddl?</h1><p>One click and we will not e-mail you again.</p>
<form method="post"><label><input type="checkbox" name="business" value="1"> Also stop e-mails to everyone at ${escapeHtml(info.business || 'this business')}</label><button type="submit">Unsubscribe</button></form>`))
  } catch (e) {
    console.error('b2b opt-out:', e.message)
    return res.status(500).send(page('Something went wrong', '<h1>Something went wrong</h1><p>Please reply “stop” to the e-mail instead and we will not contact you again.</p>'))
  }
}
