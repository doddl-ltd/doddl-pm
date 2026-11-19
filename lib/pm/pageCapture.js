// Amazon page capture (stars, review count, full-page screenshot) sent by the Chrome capture on Jon's PC.
// Writes listing_evidence (every capture) and listing_reviews_daily (daily captures). Screenshots live in the
// private storage bucket listing-evidence as <MKT>/<ASIN>/<date>_<reason>_<HHMMSS>.jpg.

export const EVIDENCE_BUCKET = 'listing-evidence'
const MARKETS = ['UK', 'DE', 'FR', 'US', 'ES', 'IT', 'CA', 'NL', 'BE', 'IE', 'PL', 'SE']
const REASONS = ['daily', 'before', 'after']
const STATUSES = ['ok', 'no_reviews', 'missing', 'blocked', 'error']

function bad(msg) { const e = new Error(msg); e.status = 400; return e }

export function checkCapture(b) {
  if (!/^[A-Z0-9]{10}$/.test(b.asin || '')) throw bad('asin must be a 10-character ASIN')
  if (!MARKETS.includes(b.marketplace)) throw bad('unknown marketplace')
  if (!REASONS.includes(b.reason || 'daily')) throw bad('reason must be daily, before or after')
}

export function captureKey(b, now = new Date()) {
  const iso = now.toISOString()
  return `${b.marketplace}/${b.asin}/${iso.slice(0, 10)}_${b.reason || 'daily'}_${iso.slice(11, 19).replace(/:/g, '')}.jpg`
}

export async function captureUploadUrl(db, b) {
  checkCapture(b)
  const key = captureKey(b)
  const { data, error } = await db.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(key)
  if (error) throw new Error(`upload url: ${error.message}`)
  return { key, signed_url: data.signedUrl }
}

export async function saveCapture(db, b, principal) {
  checkCapture(b)
  const v = b.values || {}
  const status = STATUSES.includes(v.status) ? v.status : 'error'
  const rating = v.rating == null ? null : Number(v.rating)
  const reviews = v.reviews == null ? null : parseInt(v.reviews, 10)
  if (rating != null && !(rating >= 1 && rating <= 5)) throw bad('rating must be 1-5')
  const key = b.key && b.key.startsWith(`${b.marketplace}/${b.asin}/`) ? b.key : null
  const values = { rating, reviews, title: v.title || null, url: v.url || null, status }
  if (status !== 'blocked') {
    const { error } = await db.from('listing_evidence').insert({
      asin: b.asin, marketplace: b.marketplace, reason: b.reason || 'daily', change_ref: b.change_ref || null,
      values, screenshot_key: key, created_by: principal && principal.agent_id ? `agent:${principal.agent_id}` : 'agent',
    })
    if (error) throw new Error(`evidence: ${error.message}`)
  }
  if ((b.reason || 'daily') === 'daily') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : new Date().toISOString().slice(0, 10)
    const { error } = await db.from('listing_reviews_daily').upsert({
      asin: b.asin, marketplace: b.marketplace, date, rating, reviews, source: 'page', status, screenshot_key: key, received_at: new Date().toISOString(),
    }, { onConflict: 'asin,marketplace,date' })
    if (error) throw new Error(`reviews: ${error.message}`)
  }
  return { ok: true, key }
}

/** Short-lived links to view screenshots (bucket is private). */
export async function signShots(db, keys, seconds = 3600) {
  const list = [...new Set(keys.filter(Boolean))]
  if (!list.length) return {}
  const { data, error } = await db.storage.from(EVIDENCE_BUCKET).createSignedUrls(list, seconds)
  if (error || !data) return {}
  return Object.fromEntries(data.filter(d => d.signedUrl).map(d => [d.path, d.signedUrl]))
}
