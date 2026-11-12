import { uiRoute } from '../../../lib/server/uiRoute'
import { adminClient } from '../../../lib/server/admin'
import { approvalError as fail } from '../../../lib/pm/approvals'
import { MARKETS } from '../../../lib/pm/hq'

// POST /api/listings/image-upload { asin, locale, name, type, size } -> { upload_url, public_url }
// A one-time signed link the browser PUTs the file to (bucket listing-images, migration 33), and the public link that
// goes into the master's image set. Amazon fetches the image from that public link when the listing is patched.
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/tiff': 'tif', 'image/gif': 'gif' }
const MAX = 20 * 1024 * 1024

export default uiRoute({
  POST: async ({ req, user }) => {
    const b = req.body || {}
    const asin = String(b.asin || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) throw fail(400, 'asin must be a 10-character ASIN')
    if (!MARKETS.includes(b.locale)) throw fail(400, `locale must be one of ${MARKETS.join(', ')}`)
    const ext = TYPES[b.type]
    if (!ext) throw fail(400, 'Amazon takes JPEG, PNG, TIFF or GIF images')
    if (!(Number(b.size) > 0) || Number(b.size) > MAX) throw fail(400, 'Images must be under 20 MB')
    const base = String(b.name || 'image').replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image'
    const path = `${asin}/${b.locale}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${base}.${ext}`
    const store = adminClient(user.name).storage.from('listing-images')
    const { data, error } = await store.createSignedUploadUrl(path)
    if (error) throw fail(500, `upload link: ${error.message}`)
    return { upload_url: data.signedUrl, public_url: store.getPublicUrl(path).data.publicUrl, path }
  },
})
