import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'

// The doddl image library (OneDrive "doddl HQ Knowledge/14 Media", 17k files filed from SharePoint): connect it once,
// search by words, type folder, product (master SKU) and channel. With onPick it is a picker: the chosen image is copied
// once into the listing image store and its public link handed back (A+ pages, master listing images).
const ink = '#3D157D'
const CHANNELS = [['', 'Any channel'], ['amazon', 'Amazon'], ['website', 'Website'], ['social', 'Social'], ['email', 'Email'], ['print', 'Print'], ['retail-b2b', 'Retail and B2B']]
const field = { minHeight: 42, border: '2px solid #3D157D', borderRadius: 999, padding: '0 14px', font: "700 14px 'Nunito', sans-serif", color: ink, background: '#fff' }
const pill = (on) => ({ minHeight: 38, padding: '0 16px', borderRadius: 999, border: '2px solid #3D157D', background: on ? ink : '#fff', color: on ? '#fff' : ink, font: "900 13.5px 'Nunito', sans-serif", cursor: 'pointer' })
const ERRORS = { admin_consent: 'Microsoft needs an admin to allow the library connection first.', no_library: 'Signed in, but that account has no "doddl HQ Knowledge/14 Media" folder. Sign in as the account that owns it.', state: 'The sign-in took too long. Try again.', expired: 'The sign-in took too long. Try again.', token: 'Microsoft did not complete the sign-in. Try again.' }

export default function MediaView({ onPick, pickLabel = 'Use this image', defaultSku = '', defaultType = '', defaultChannel = '', compact = false }) {
  const [f, setF] = useState({ q: '', sku: defaultSku, type: defaultType, channel: defaultChannel, kind: 'image', page: 0 })
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    if (p.get('library') === 'connected') setNote('Connected. Reading the library index now…')
    if (p.get('library_error')) setErr(ERRORS[p.get('library_error')] || `The connection did not finish (${p.get('library_error')}).`)
  }, [])
  const load = async (x = f) => {
    const q = new URLSearchParams(Object.entries(x).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)]))
    const r = await apiFetch(`/api/media?${q}`)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `Could not load the library (${r.status})`)
    setData(j)
    return j
  }
  useEffect(() => {
    let live = true
    const t = setTimeout(() => { load(f).then(async (j) => {
      // First visit after connecting: build the index straight away.
      if (live && j.connection && j.connection.status === 'connected' && !j.connection.synced_at) await sync()
    }).catch(e => live && setErr(e.message)) }, f.q ? 300 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [f.q, f.sku, f.type, f.channel, f.kind, f.page])
  const set = (k, v) => setF((x) => ({ ...x, [k]: v, page: k === 'page' ? v : 0 }))
  const connect = async () => {
    setBusy('connect'); setErr('')
    try { const r = await apiFetch('/api/media/connect', { method: 'POST', body: '{}' }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Could not start the sign-in (${r.status})`); window.location.assign(j.url) } catch (e) { setErr(e.message); setBusy('') }
  }
  const sync = async () => {
    setBusy('sync'); setErr('')
    try { const r = await apiFetch('/api/media', { method: 'POST', body: JSON.stringify({ op: 'sync' }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Could not read the library (${r.status})`); setNote(`${j.synced.toLocaleString('en-GB')} files in the library.`); await load() } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const use = async (file) => {
    setBusy(file.image_id); setErr('')
    try { const r = await apiFetch('/api/media', { method: 'POST', body: JSON.stringify({ op: 'use', image_id: file.image_id }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Could not use that image (${r.status})`); await onPick({ ...file, url: j.url }) } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const c = (data && data.connection) || {}
  const connected = c.status === 'connected'
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1
  return (
    <div style={{ color: ink, fontFamily: "'Nunito', sans-serif", display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1180 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: connected ? '#d6ebe7' : '#f2ece5', borderRadius: '20px 20px 20px 6px', padding: '12px 16px' }}>
        <span style={{ flex: '1 1 320px', fontSize: 14, fontWeight: 700, lineHeight: 1.45 }}>
          {connected
            ? <><b>Library connected</b>{c.account ? ` as ${c.account}` : ''}: doddl HQ Knowledge › 14 Media{c.synced_at ? ` · ${(c.synced_count || 0).toLocaleString('en-GB')} files, read ${new Date(c.synced_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</>
            : c.status === 'error' ? <><b>Library needs signing in again.</b> {c.status_reason || ''}</>
              : <><b>Connect the image library.</b> Sign in once with the Microsoft account that holds doddl HQ Knowledge. doddlHQ only reads 14 Media.</>}
        </span>
        {connected ? <button type="button" onClick={sync} disabled={!!busy} style={pill(false)}>{busy === 'sync' ? 'Reading…' : 'Sync now'}</button> : null}
        {!connected ? <button type="button" onClick={connect} disabled={!!busy} style={pill(true)}>{busy === 'connect' ? 'Opening Microsoft…' : 'Connect the image library'}</button> : null}
      </div>
      {note ? <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>{note}</p> : null}
      {err ? <p role="alert" style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: '#dd6c92' }}>{err}</p> : null}
      {data && data.total + (data.types || []).length ? (<>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="search" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Search names and notes" aria-label="Search the library" style={{ ...field, flex: '1 1 260px' }} />
          <input value={f.sku} onChange={(e) => set('sku', e.target.value)} placeholder="Product or code" aria-label="Product or code" style={{ ...field, width: 190 }} />
          <select value={f.type} onChange={(e) => set('type', e.target.value)} aria-label="Folder" style={field}><option value="">Every folder</option>{(data.types || []).map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <select value={f.channel} onChange={(e) => set('channel', e.target.value)} aria-label="Channel" style={field}>{CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {!onPick ? <select value={f.kind} onChange={(e) => set('kind', e.target.value)} aria-label="Kind" style={field}><option value="image">Images</option><option value="video">Video</option><option value="">Everything</option></select> : null}
        </div>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>{data.total.toLocaleString('en-GB')} file{data.total === 1 ? '' : 's'}{pages > 1 ? ` · page ${data.page + 1} of ${pages}` : ''}</p>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 140 : 170}px, 1fr))`, gap: 12 }}>
          {data.files.map((x) => (
            <div key={x.image_id} style={{ background: '#f2ece5', borderRadius: '18px 18px 18px 6px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ aspectRatio: '1 / 1', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {x.thumb ? <img src={x.thumb} alt={x.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 12, fontWeight: 800, color: '#947FB6' }}>{x.kind === 'video' ? 'Video' : 'No preview'}</span>}
              </div>
              <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                <span title={x.file_path} style={{ fontSize: 12.5, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700 }}>{[x.master_sku, x.type.replace(/^\d+ /, ''), x.channels_allowed].filter(Boolean).join(' · ')}</span>
                {onPick && x.kind === 'image' ? <button type="button" onClick={() => use(x)} disabled={!!busy} style={{ ...pill(true), minHeight: 32, marginTop: 'auto', fontSize: 12.5 }}>{busy === x.image_id ? 'Copying…' : pickLabel}</button> : null}
              </div>
            </div>
          ))}
        </div>
        {pages > 1 ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={f.page === 0} onClick={() => set('page', f.page - 1)} style={pill(false)}>‹ Previous</button>
            <button type="button" disabled={f.page + 1 >= pages} onClick={() => set('page', f.page + 1)} style={pill(false)}>Next ›</button>
          </div>
        ) : null}
      </>) : null}
    </div>
  )
}
