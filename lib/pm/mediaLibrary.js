// The doddl image library (migration 37). 17,035 files filed from SharePoint into OneDrive "doddl HQ Knowledge/14 Media"
// on 2026-11-10, each with a row in imagery-index.csv. doddlHQ reads it through Microsoft Graph with a stored sign-in
// (Jon 2026-11-16 "Yes, connect it"): the index is refreshed daily, thumbnails come straight from OneDrive, and a file
// is copied (once) into the public listing-images store only when it is used on Amazon.
//
// Only paths under "doddl HQ Knowledge/14 Media" are ever addressed (feedback: documents and media come only from the
// doddl HQ Knowledge folder). The sign-in uses the "doddl PM outreach" Entra app and its existing return address
// (/api/b2b/mailboxes/callback, which hands media sign-ins over here), scopes offline_access User.Read Files.Read.
import { b2bError } from '../b2b'
import { decryptSecret, encryptSecret, pkcePair, randomState } from '../b2bMail/crypto'
import { mailConfig, requireConfig, needsAdminConsent, adminConsentUrl } from '../b2bMail/graph'
import { isPmAdmin } from './b2bMail'

export const MEDIA_SCOPES = ['offline_access', 'User.Read', 'Files.Read']
export const MEDIA_COOKIE = 'media_connect'
export const ROOT = 'doddl HQ Knowledge'
export const LIBRARY = `${ROOT}/14 Media`
const GRAPH = 'https://graph.microsoft.com/v1.0'
const IMAGE = /\.(jpe?g|png|webp|gif|tiff?|heic|bmp)$/i
const VIDEO = /\.(mp4|mov|m4v|avi|webm)$/i

function must(r, what) { if (r.error) throw b2bError(500, `${what}: ${r.error.message}`); return r.data }

// ─── sign-in ─────────────────────────────────────────────────────────────────
async function tokenCall(cfg, body, fetchImpl = fetch) {
  const r = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: MEDIA_SCOPES.join(' '), ...body }).toString(),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const e = b2bError(r.status === 400 || r.status === 401 ? 401 : 502, `Microsoft sign-in failed: ${j.error || r.status}`)
    e.code = j.error || null
    e.description = j.error_description || ''
    throw e
  }
  return { access_token: j.access_token, refresh_token: j.refresh_token || null, expires_in: Number(j.expires_in) || 3600 }
}

/** POST /api/media/connect (PM admin) -> { url, cookie }: Microsoft sign-in for the library. */
export async function startMediaConnect(db, actor) {
  if (!(await isPmAdmin(db, actor))) throw b2bError(403, 'Only a PM admin can connect the image library')
  const cfg = requireConfig()
  const { verifier, challenge } = pkcePair()
  const state = randomState()
  const q = new URLSearchParams({
    client_id: cfg.clientId, response_type: 'code', redirect_uri: cfg.redirectUri, response_mode: 'query',
    scope: MEDIA_SCOPES.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  })
  const cookie = encryptSecret(JSON.stringify({ kind: 'media', state, verifier, by: actor, exp: Date.now() + 10 * 60_000 }))
  return { url: `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/authorize?${q}`, cookie, cookieName: MEDIA_COOKIE, maxAge: 600 }
}

/** The callback's media branch: store the sign-in once the library folder is found. Returns { ok } or { error }. */
export async function finishMediaConnect(db, { query = {}, cookie, fetchImpl = fetch, now = new Date() }) {
  const cfg = mailConfig()
  if (query.error) return { error: needsAdminConsent({ code: query.error, description: query.error_description }) ? 'admin_consent' : String(query.error).slice(0, 60), admin_consent_url: adminConsentUrl(cfg) }
  let saved
  try { saved = JSON.parse(decryptSecret(cookie)) } catch { return { error: 'expired' } }
  if (!saved || saved.kind !== 'media' || saved.exp < now.getTime() || !query.state || query.state !== saved.state) return { error: 'state' }
  let t
  try { t = await tokenCall(cfg, { grant_type: 'authorization_code', code: String(query.code || ''), redirect_uri: cfg.redirectUri, code_verifier: saved.verifier }, fetchImpl) } catch (e) {
    return { error: needsAdminConsent(e) ? 'admin_consent' : 'token' }
  }
  if (!t.refresh_token) return { error: 'no_refresh' }
  const auth = { authorization: `Bearer ${t.access_token}` }
  const me = await (await fetchImpl(`${GRAPH}/me?$select=mail,userPrincipalName`, { headers: auth })).json().catch(() => ({}))
  const folder = await fetchImpl(`${GRAPH}/me/drive/root:/${encodePath(LIBRARY)}?$select=id,name,folder`, { headers: auth })
  if (!folder.ok) return { error: 'no_library' }
  must(await db.from('media_connection').upsert({ id: 'knowledge', account: me.mail || me.userPrincipalName || null, token_enc: encryptSecret(t.refresh_token), status: 'connected', status_reason: null, connected_by: saved.by, connected_at: now.toISOString() }), 'media connection')
  return { ok: true }
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/')
let cached = null // { token, exp }

/** A Graph caller on the stored sign-in, limited to the library folder. */
export async function libraryGraph(db, { fetchImpl = fetch } = {}) {
  const c = must(await db.from('media_connection').select('*').eq('id', 'knowledge').maybeSingle(), 'media connection')
  if (!c || !c.token_enc || c.status === 'disconnected') throw b2bError(409, 'The image library is not connected yet')
  const cfg = requireConfig()
  async function token() {
    if (cached && cached.exp > Date.now() + 60_000) return cached.token
    let t
    try { t = await tokenCall(cfg, { grant_type: 'refresh_token', refresh_token: decryptSecret(c.token_enc) }, fetchImpl) } catch (e) {
      if (e.code === 'invalid_grant' || e.code === 'interaction_required') await db.from('media_connection').update({ status: 'error', status_reason: 'Sign in again: Microsoft ended the connection' }).eq('id', 'knowledge')
      throw e
    }
    cached = { token: t.access_token, exp: Date.now() + t.expires_in * 1000 }
    if (t.refresh_token) await db.from('media_connection').update({ token_enc: encryptSecret(t.refresh_token) }).eq('id', 'knowledge')
    return cached.token
  }
  const inLibrary = (rel) => {
    const p = String(rel || '').replace(/^\/+/, '')
    if (!p.startsWith('14 Media/') || p.includes('..')) throw b2bError(400, 'Only files in 14 Media can be read')
    return `${ROOT}/${p}`
  }
  return {
    /** GET a file or folder by its path inside "doddl HQ Knowledge" (it must be under 14 Media). */
    async get(rel, suffix = '', { raw = false } = {}) {
      const r = await fetchImpl(`${GRAPH}/me/drive/root:/${encodePath(inLibrary(rel))}${suffix}`, { headers: { authorization: `Bearer ${await token()}` }, redirect: 'follow' })
      if (raw) return r
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw b2bError(r.status === 404 ? 404 : 502, `OneDrive: ${r.status} ${(j.error && j.error.code) || ''}`.trim())
      return j
    },
    /** Graph JSON batch (up to 20 requests). */
    async batch(requests) {
      const r = await fetchImpl(`${GRAPH}/$batch`, { method: 'POST', headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' }, body: JSON.stringify({ requests }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw b2bError(502, `OneDrive batch: ${r.status}`)
      return j.responses || []
    },
    inLibrary,
  }
}

// ─── the index ───────────────────────────────────────────────────────────────
/** Parse imagery-index.csv (quoted CSV, BOM, header row). */
export function parseIndex(text) {
  const rows = []
  let row = [], cell = '', q = false
  const s = String(text || '').replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some(c => c !== '')) rows.push(row) }
  const [head, ...body] = rows
  if (!head) return []
  const ix = Object.fromEntries(head.map((h, i) => [h.trim(), i]))
  const get = (r, k) => (ix[k] == null ? '' : String(r[ix[k]] ?? '').trim())
  return body.map(r => {
    const path = get(r, 'file_path')
    const name = path.split('/').pop()
    return {
      image_id: get(r, 'image_id'), type: get(r, 'type') || path.split('/')[1] || 'Other', master_sku: get(r, 'master_sku') || null,
      file_path: path, name, kind: IMAGE.test(name) ? 'image' : VIDEO.test(name) ? 'video' : 'other',
      channels_allowed: get(r, 'channels_allowed') || null, usage_rights: get(r, 'usage_rights') || null, agent_use: get(r, 'agent_use') || null, notes: get(r, 'notes') || null,
    }
  }).filter(x => x.image_id && x.file_path.startsWith('14 Media/'))
}

/** Daily (cron) and "Sync now": read imagery-index.csv from OneDrive and refresh media_library. */
export async function syncMediaLibrary(db, { fetchImpl = fetch, now = new Date() } = {}) {
  const g = await libraryGraph(db, { fetchImpl })
  const r = await g.get('14 Media/imagery-index.csv', ':/content', { raw: true })
  if (!r.ok) throw b2bError(502, `Could not read imagery-index.csv (${r.status})`)
  const rows = parseIndex(await r.text()).map(x => ({ ...x, synced_at: now.toISOString() }))
  for (let i = 0; i < rows.length; i += 500) must(await db.from('media_library').upsert(rows.slice(i, i + 500), { onConflict: 'image_id', ignoreDuplicates: false }), 'media library')
  must(await db.from('media_connection').update({ synced_at: now.toISOString(), synced_count: rows.length, status: 'connected', status_reason: null }).eq('id', 'knowledge'), 'media connection')
  return { synced: rows.length }
}

// ─── search, thumbnails, use ────────────────────────────────────────────────
/** GET /api/media: the connection, the type folders, and a page of files with thumbnail links. */
export async function searchMedia(db, { q = '', sku = '', type = '', channel = '', kind = 'image', page = 0, size = 48 } = {}, { fetchImpl = fetch } = {}) {
  const c = must(await db.from('media_connection').select('account, status, status_reason, connected_by, connected_at, synced_at, synced_count').eq('id', 'knowledge').maybeSingle(), 'media connection')
  const n = Math.min(Math.max(Number(size) || 48, 1), 96)
  let query = db.from('media_library').select('image_id, type, master_sku, file_path, name, kind, channels_allowed, notes, used_url', { count: 'exact' }).order('type').order('file_path').range(Number(page) * n, Number(page) * n + n - 1)
  if (kind) query = query.eq('kind', kind)
  // The index has no master SKU filled in yet (product images are filed by product folder), so a product search also
  // matches the folder and file names.
  if (sku) { const s = String(sku).trim().replace(/[%,()]/g, ''); query = query.or(`master_sku.ilike.${s},file_path.ilike.%${s}%`) }
  if (type) query = query.eq('type', String(type))
  if (channel) query = query.or(`channels_allowed.ilike.%${String(channel).replace(/[^a-z-]/gi, '')}%,channels_allowed.eq.all`)
  for (const w of String(q).trim().split(/\s+/).filter(Boolean).slice(0, 5)) query = query.or(`file_path.ilike.%${w.replace(/[%,()]/g, '')}%,notes.ilike.%${w.replace(/[%,()]/g, '')}%`)
  const res = await query
  const files = must(res, 'media library')
  let thumbs = {}
  if (files.length && c && c.status === 'connected') {
    try { thumbs = await thumbnails(db, files, { fetchImpl }) } catch { /* the grid still lists the files */ }
  }
  const types = must(await db.from('media_library').select('type').limit(20000), 'media types')
  return {
    connection: c || { status: 'disconnected' },
    types: [...new Set(types.map(t => t.type))].sort(),
    total: res.count || 0, page: Number(page) || 0, size: n,
    files: files.map(f => ({ ...f, thumb: thumbs[f.image_id] || null })),
  }
}

/** Thumbnail links (short-lived, pre-signed by Microsoft) for a page of files, 20 per Graph batch. */
export async function thumbnails(db, files, { fetchImpl = fetch } = {}) {
  const g = await libraryGraph(db, { fetchImpl })
  const out = {}
  for (let i = 0; i < files.length; i += 20) {
    const part = files.slice(i, i + 20)
    const res = await g.batch(part.map((f, k) => ({ id: String(k), method: 'GET', url: `/me/drive/root:/${encodePath(g.inLibrary(f.file_path))}:/thumbnails/0/medium` })))
    for (const r of res) { const f = part[Number(r.id)]; if (f && r.status === 200 && r.body && r.body.url) out[f.image_id] = r.body.url }
  }
  return out
}

/** POST /api/media { op: 'use', image_id }: copy one library file into listing-images (once) for Amazon. */
export async function useMedia(db, { image_id }, { fetchImpl = fetch } = {}) {
  const f = must(await db.from('media_library').select('*').eq('image_id', String(image_id || '')).maybeSingle(), 'media library')
  if (!f) throw b2bError(404, `No library file ${image_id}`)
  if (f.used_url) return { image_id: f.image_id, url: f.used_url }
  if (f.kind !== 'image') throw b2bError(400, 'Only images can be used on Amazon listings')
  const g = await libraryGraph(db, { fetchImpl })
  const r = await g.get(f.file_path, ':/content', { raw: true })
  if (!r.ok) throw b2bError(502, `Could not read ${f.name} from OneDrive (${r.status})`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length > 25 * 1024 * 1024) throw b2bError(413, `${f.name} is over 25 MB`)
  const ext = (f.name.match(/\.([a-z0-9]+)$/i) || [, 'jpg'])[1].toLowerCase()
  const key = `library/${f.image_id}.${ext === 'jpeg' ? 'jpg' : ext}`
  const type = r.headers.get('content-type') || (ext === 'png' ? 'image/png' : 'image/jpeg')
  const up = await db.storage.from('listing-images').upload(key, buf, { contentType: type, upsert: true })
  if (up.error) throw b2bError(500, `listing-images: ${up.error.message}`)
  const url = db.storage.from('listing-images').getPublicUrl(key).data.publicUrl
  must(await db.from('media_library').update({ used_url: url }).eq('image_id', f.image_id), 'media library')
  return { image_id: f.image_id, url }
}
