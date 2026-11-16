import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { C, Panel, H2, Note } from './approvals/renderers/reviewKit'
import { FONT, WEIGHT, layoutBlock, lineOrigin, panelColour } from '../lib/pm/imagePaint'

// Listing images translated per market, in doddlHQ (lib/pm/imageTranslate.js, migration 39). Claude reads the words and
// translates them; this browser repaints each text panel and sets the translation in the brand font; Claude checks the
// result; a person approves each image, which then replaces the original in that market's master image set.
const LANG = { DE: 'German', FR: 'French', ES: 'Spanish', IT: 'Italian', NL: 'Dutch', BE: 'French (Belgium)', PL: 'Polish', SE: 'Swedish' }
const PER_IMAGE = 0.03
const STATE = {
  read: ['Read, not repainted yet', C.blueBg, C.blue], rendered: ['Checking', C.blueBg, C.blue], checked: ['Ready to approve', C.okBg, C.ok],
  problem: ['Check found a problem', C.warnBg, C.warn], approved: ['Approved: in the set', C.okBg, C.ok], rejected: ['Rejected', C.grey, C.muted],
  no_text: ['No text: nothing to translate', C.grey, C.muted], over_photo: ['Text over the photo: needs a designer', C.warnBg, C.warn],
}
const btn = (primary) => ({ minHeight: 32, padding: '0 12px', borderRadius: 8, border: `1px solid ${primary ? C.indigo : C.border}`, background: primary ? C.indigo : '#fff', color: primary ? '#fff' : C.indigo, font: "800 12.5px 'Nunito', sans-serif", cursor: 'pointer' })

async function loadBitmap(url) {
  const r = await apiFetch(`/api/listings/image-proxy?url=${encodeURIComponent(url)}`)
  if (!r.ok) throw new Error(`Could not load the image (${r.status})`)
  return createImageBitmap(await r.blob())
}

/** Repaint one image: each block's panel filled with its own colour, the translation set in the brand font. */
export async function paint(sourceUrl, blocks) {
  await Promise.all([document.fonts.load(`${WEIGHT.regular} 40px ${FONT}`), document.fonts.load(`${WEIGHT.bold} 40px ${FONT}`)])
  const bmp = await loadBitmap(sourceUrl)
  const W = bmp.width, H = bmp.height
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bmp, 0, 0)
  const measure = (t, size, bold) => { ctx.font = `${bold ? WEIGHT.bold : WEIGHT.regular} ${size}px ${FONT}`; return ctx.measureText(t).width }
  const flags = []
  for (const b of blocks) {
    const l = layoutBlock(b, W, H, measure)
    // The panel colour from the pixels just around the text (before anything is painted).
    const ring = []
    const f = l.fill, band = Math.max(2, Math.round(l.lineGap * 0.12))
    const read = (x, y, w, h) => { if (w < 1 || h < 1) return; const d = ctx.getImageData(Math.max(0, x), Math.max(0, y), Math.min(W, w), Math.min(H, h)).data; for (let i = 0; i < d.length; i += 16) ring.push([d[i], d[i + 1], d[i + 2]]) }
    read(f.x, f.y - band, f.w, band); read(f.x, f.y + f.h, f.w, band); read(f.x - band, f.y, band, f.h); read(f.x + f.w, f.y, band, f.h)
    const panel = panelColour(ring, b.background)
    if (!panel.flat) flags.push(`"${b.text.slice(0, 40)}" is not on a flat colour`)
    if (!l.fits) flags.push(`"${b.translated.slice(0, 40)}" had to be set small to fit`)
    ctx.fillStyle = panel.colour
    ctx.fillRect(f.x, f.y, f.w, f.h)
    ctx.fillStyle = b.color
    ctx.textBaseline = 'alphabetic'
    l.lines.forEach((line, i) => {
      let { x, y } = lineOrigin(l, b, i)
      for (const run of line.runs) { ctx.font = `${run.bold ? WEIGHT.bold : WEIGHT.regular} ${l.size}px ${FONT}`; ctx.fillText(run.t, x, y); x += ctx.measureText(run.t).width }
    })
  }
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'))
  return { blob, flags }
}

export function ImageTranslate({ master, locale, onUpload, onApproved }) {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const source = (((master.images || {}).UK) || []).filter((x) => x && x.slot !== 'MAIN' && x.url)
  const load = async () => {
    const r = await apiFetch(`/api/listings/image-translate?asin=${master.asin}&locale=${locale}`)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `Could not load the image translations (${r.status})`)
    setRows(j.translations || [])
  }
  useEffect(() => { setRows(null); load().catch((e) => setErr(e.message)) }, [master.asin, locale])
  const post = async (body) => {
    const r = await apiFetch('/api/listings/image-translate', { method: 'POST', body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `Could not do that (${r.status})`)
    return j
  }
  // One image all the way: read (Claude), repaint (here), upload, check (Claude).
  const one = async (img, redo = false) => {
    let t = await post({ op: 'read', asin: master.asin, locale, url: img.url, slot: img.slot, redo })
    if (t.status === 'read' || (redo && ['rendered', 'checked', 'problem'].includes(t.status))) {
      const { blob, flags } = await paint(img.url, (t.layout && t.layout.blocks) || [])
      const file = new File([blob], `${master.asin}-${locale}-${img.slot || 'img'}.png`, { type: 'image/png' })
      const url = await onUpload(file, locale)
      t = await post({ op: 'rendered', id: t.id, url })
      if (flags.length) t.flags = flags
    }
    return t
  }
  const runAll = async (list, redo = false) => {
    const est = (list.length * PER_IMAGE).toFixed(2)
    if (!window.confirm(`Translate ${list.length} image${list.length === 1 ? '' : 's'} into ${LANG[locale]} with Claude? About $${est}. Nothing changes on Amazon; you approve each image.`)) return
    setErr('')
    for (const [i, img] of list.entries()) {
      setBusy(`Image ${i + 1} of ${list.length}…`)
      try { await one(img, redo) } catch (e) { setErr(`${img.slot || 'Image'}: ${e.message}`) }
    }
    setBusy(''); await load().catch(() => {})
  }
  const decide = async (id, op) => {
    setBusy(op); setErr('')
    try { await post({ op, id, note: op === 'reject' ? window.prompt('Why? (optional)') || '' : '' }); await load(); if (op === 'approve' && onApproved) await onApproved() } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const byUrl = Object.fromEntries((rows || []).map((r) => [r.source_url, r]))
  const todo = source.filter((img) => !byUrl[img.url])
  const spent = (rows || []).reduce((n, r) => n + Number(r.cost_usd || 0), 0)
  return (
    <div style={{ marginTop: 14, padding: 14, background: C.bg, borderRadius: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <H2 style={{ margin: 0, flex: '1 1 300px', fontSize: 16 }}>Translate the images for {locale} ({LANG[locale]})</H2>
        {todo.length ? <button type="button" disabled={!!busy} onClick={() => runAll(todo)} style={btn(true)}>{busy || `Translate ${todo.length} image${todo.length === 1 ? '' : 's'} (about $${(todo.length * PER_IMAGE).toFixed(2)})`}</button> : busy ? <span style={{ fontSize: 13, fontWeight: 700 }}>{busy}</span> : null}
      </div>
      <Note style={{ marginTop: 4 }}>From the UK set (main image left out). Claude reads the words and translates them, doddlHQ repaints them in the brand font, Claude checks the result, and you approve each one before it replaces the original in the {locale} set.{spent ? ` Spent so far: $${spent.toFixed(2)}.` : ''}</Note>
      {err ? <p role="alert" style={{ color: C.bad, fontSize: 13, margin: '6px 0 0' }}>{err}</p> : null}
      {rows && rows.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, marginTop: 12 }}>
          {source.map((img) => {
            const t = byUrl[img.url]
            if (!t) return null
            const [label, bg, fg] = STATE[t.status] || STATE.read
            const problems = (t.check_result && t.check_result.problems) || []
            return (
              <div key={img.url} style={{ background: '#fff', borderRadius: 12, padding: 10, border: `1px solid ${C.line}` }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <img src={img.url} alt={`${img.slot} in English`} loading="lazy" style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'contain', background: C.bg, borderRadius: 6 }} />
                  {t.url ? <img src={t.url} alt={`${img.slot} in ${LANG[locale]}`} loading="lazy" style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'contain', background: C.bg, borderRadius: 6 }} /> : <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: C.muted, background: C.bg, borderRadius: 6 }}>–</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                  <b style={{ fontSize: 13 }}>{img.slot}</b>
                  <span style={{ fontSize: 12, fontWeight: 800, borderRadius: 999, padding: '2px 9px', background: bg, color: fg }}>{label}</span>
                </div>
                {problems.length ? <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5 }}>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul> : null}
                {t.layout && t.layout.note ? <p style={{ margin: '6px 0 0', fontSize: 12.5, color: C.muted }}>{t.layout.note}</p> : null}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {['checked', 'problem'].includes(t.status) ? <button type="button" disabled={!!busy} onClick={() => decide(t.id, 'approve')} style={btn(true)}>Approve</button> : null}
                  {['checked', 'problem', 'read', 'over_photo'].includes(t.status) ? <button type="button" disabled={!!busy} onClick={() => decide(t.id, 'reject')} style={btn(false)}>Reject</button> : null}
                  {t.status !== 'approved' ? <button type="button" disabled={!!busy} onClick={() => runAll([img], true)} style={btn(false)}>Redo</button> : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
