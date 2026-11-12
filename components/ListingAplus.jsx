// The A+ builder for one ASIN (lib/pm/aplus.js, migration 34): brief, image library, Claude's layout, edit and preview,
// translations, and sending the page to each market. Nothing here writes to Amazon.
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { C, Panel, H2, Note, Chip, Pill, Btn, fmtWhen } from './approvals/renderers/reviewKit'
import { MODULES, MAX_MODULES, ALT_MAX, aplusProblems, fits, aplusLiveState, modulesFor } from '../lib/pm/aplusModel'
import { liveAplus } from './ListingContent'

const MARKETS = ['UK', 'US', 'CA', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'IE', 'PL', 'SE']
const LOCALES = ['DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'PL', 'SE']
const SEND = { submitted: ['With HQ for checks', C.blueBg, C.blue], in_approval: ['Waiting for approval', C.warnBg, C.warn], sent: ['Created on Amazon', C.blueBg, C.blue], refused: ['Refused', C.badBg, C.bad], live: ['Live', C.okBg, C.ok], rejected: ['Rejected by Amazon', C.badBg, C.bad] }
const LIVE = { live: ['Live', C.okBg, C.ok], waiting: ['With Amazon for review', C.warnBg, C.warn], problem: ['Rejected by Amazon', C.badBg, C.bad] }
const input = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, font: "14px/1.45 'Nunito', sans-serif" }
const small = { minHeight: 30, padding: '0 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.indigo, font: "800 12px 'Nunito', sans-serif", cursor: 'pointer' }
const blank = (type) => ({ type, headline: '', body: '', image: '', overlay: 'dark', side: 'left', bullets: [''], blocks: Array.from({ length: MODULES[type].blocks || 0 }, () => ({ headline: '', body: '', image: '' })) })

function imageSize(file) {
  return new Promise((resolve) => {
    const u = URL.createObjectURL(file), im = new Image()
    im.onload = () => { resolve({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(u) }
    im.onerror = () => { resolve(null); URL.revokeObjectURL(u) }
    im.src = u
  })
}

function Count({ v, max }) { const n = [...String(v || '')].length; return <span style={{ fontSize: 11, color: n > max ? C.bad : C.faint, fontWeight: 700 }}>{n}/{max}</span> }
function Text({ label, v, max, onChange, rows }) {
  return (
    <label style={{ display: 'block', marginTop: 8 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 800, color: C.muted }}>{label}<Count v={v} max={max} /></span>
      {rows ? <textarea value={v || ''} rows={rows} onChange={e => onChange(e.target.value)} style={input} /> : <input value={v || ''} onChange={e => onChange(e.target.value)} style={input} />}
    </label>
  )
}
function ImagePick({ value, images, size, onChange }) {
  const ok = images.filter(x => fits(x, size))
  return (
    <label style={{ display: 'block', marginTop: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: C.muted }}>Image ({size[0]}×{size[1]} or larger, that shape)</span>
      <select value={value || ''} onChange={e => onChange(e.target.value)} style={{ ...input, minHeight: 38 }}>
        <option value="">Choose an image…</option>
        {ok.map(x => <option key={x.id} value={x.id}>{x.name || x.id} · {x.w}×{x.h}</option>)}
        {images.filter(x => !ok.includes(x)).map(x => <option key={x.id} value={x.id} disabled>{x.name || x.id} · {x.w}×{x.h} (too small for this slot)</option>)}
      </select>
    </label>
  )
}

/** A scaled look at a module, close to how Amazon lays it out (970 px wide on Amazon). */
function Preview({ m, images, scale }) {
  const by = Object.fromEntries(images.map(x => [x.id, x]))
  const Img = ({ id, w, h }) => { const x = by[id]; return x ? <img src={x.url} alt={x.alt || ''} style={{ width: w * scale, height: h * scale, objectFit: 'cover', display: 'block', background: C.grey }} /> : <div style={{ width: w * scale, height: h * scale, background: C.grey, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: 11 }}>image</div> }
  const H = ({ t, size = 18 }) => t ? <p style={{ margin: '0 0 4px', fontWeight: 800, fontSize: size * scale + 4, lineHeight: 1.25 }}>{t}</p> : null
  const P = ({ t }) => t ? <p style={{ margin: 0, fontSize: 13 * scale + 3, lineHeight: 1.45, whiteSpace: 'pre-wrap', color: C.body }}>{t}</p> : null
  const d = MODULES[m.type]
  const W = 970 * scale
  let inner = null
  if (m.type === 'header') inner = <><H t={m.headline} size={22} /><Img id={m.image} w={970} h={600} /><div style={{ marginTop: 6 }}><P t={m.body} /></div></>
  if (m.type === 'overlay') inner = <div style={{ position: 'relative' }}><Img id={m.image} w={970} h={300} /><div style={{ position: 'absolute', left: 16 * scale + 6, top: 16 * scale + 6, maxWidth: W * 0.4, background: m.overlay === 'light' ? 'rgba(255,255,255,.85)' : 'rgba(20,12,40,.7)', color: m.overlay === 'light' ? C.ink : '#fff', padding: 8, borderRadius: 4 }}><p style={{ margin: 0, fontWeight: 800, fontSize: 18 * scale + 4 }}>{m.headline}</p><p style={{ margin: 0, fontSize: 12 * scale + 3 }}>{m.body}</p></div></div>
  if (m.type === 'side') inner = <div style={{ display: 'flex', gap: 12, flexDirection: m.side === 'right' ? 'row-reverse' : 'row' }}><Img id={m.image} w={300} h={300} /><div style={{ flex: 1 }}><H t={m.headline} /><P t={m.body} /></div></div>
  if (m.type === 'highlights') inner = <div style={{ display: 'flex', gap: 12 }}><Img id={m.image} w={300} h={300} /><div style={{ flex: 1 }}><H t={m.headline} /><ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 * scale + 3 }}>{(m.bullets || []).filter(Boolean).map((b, i) => <li key={i}>{b}</li>)}</ul></div></div>
  if (m.type === 'text') inner = <><H t={m.headline} /><P t={m.body} /></>
  if (m.type === 'three' || m.type === 'four') inner = <><H t={m.headline} /><div style={{ display: 'flex', gap: 10 }}>{(m.blocks || []).map((b, i) => <div key={i} style={{ width: d.block.image[0] * scale }}><Img id={b.image} w={d.block.image[0]} h={d.block.image[1]} /><div style={{ marginTop: 4 }}><H t={b.headline} size={14} /><P t={b.body} /></div></div>)}</div></>
  return <div style={{ width: W, maxWidth: '100%', background: '#fff', border: `1px dashed ${C.line}`, padding: 8, overflow: 'hidden' }}>{inner}</div>
}

function ModuleEditor({ m, i, n, images, onChange, onMove, onRemove }) {
  const d = MODULES[m.type]
  const set = (k, v) => onChange({ ...m, [k]: v })
  const setBlock = (k, key, v) => onChange({ ...m, blocks: m.blocks.map((b, j) => j === k ? { ...b, [key]: v } : b) })
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ flex: 1 }}>Module {i + 1}: {d.label}</b>
        <button type="button" style={small} disabled={i === 0} onClick={() => onMove(-1)}>Move up</button>
        <button type="button" style={small} disabled={i === n - 1} onClick={() => onMove(1)}>Move down</button>
        <button type="button" style={{ ...small, color: C.bad }} onClick={onRemove}>Remove</button>
      </div>
      <Text label="Headline" v={m.headline} max={d.headline} onChange={v => set('headline', v)} />
      {d.body ? <Text label="Text" v={m.body} max={d.body} rows={m.type === 'overlay' ? 2 : 4} onChange={v => set('body', v)} /> : null}
      {d.image ? <ImagePick value={m.image} images={images} size={d.image} onChange={v => set('image', v)} /> : null}
      {m.type === 'overlay' ? <label style={{ display: 'block', marginTop: 8, fontSize: 13 }}>Text box <select value={m.overlay} onChange={e => set('overlay', e.target.value)}><option value="dark">dark</option><option value="light">light</option></select></label> : null}
      {m.type === 'side' ? <label style={{ display: 'block', marginTop: 8, fontSize: 13 }}>Image on the <select value={m.side} onChange={e => set('side', e.target.value)}><option value="left">left</option><option value="right">right</option></select></label> : null}
      {d.bullets ? (
        <div>
          {(m.bullets || []).map((b, k) => <Text key={k} label={`Key point ${k + 1}`} v={b} max={d.bullet} onChange={v => set('bullets', m.bullets.map((x, j) => j === k ? v : x))} />)}
          {(m.bullets || []).length < d.bullets ? <button type="button" style={{ ...small, marginTop: 6 }} onClick={() => set('bullets', [...(m.bullets || []), ''])}>Add a key point</button> : null}
        </div>
      ) : null}
      {d.blocks ? (m.blocks || []).map((b, k) => (
        <div key={k} style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.line2}` }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.indigo }}>Block {k + 1}</span>
          <ImagePick value={b.image} images={images} size={d.block.image} onChange={v => setBlock(k, 'image', v)} />
          <Text label="Headline" v={b.headline} max={d.block.headline} onChange={v => setBlock(k, 'headline', v)} />
          <Text label="Text" v={b.body} max={d.block.body} rows={3} onChange={v => setBlock(k, 'body', v)} />
        </div>
      )) : null}
      <p style={{ margin: '12px 0 4px', fontSize: 12, fontWeight: 800, color: C.muted, textTransform: 'uppercase' }}>Preview</p>
      <Preview m={m} images={images} scale={0.6} />
    </div>
  )
}

export function AplusBuilder({ asin, isMobile, onUpload }) {
  const [data, setData] = useState(null)
  const [mods, setMods] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [brief, setBrief] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [addType, setAddType] = useState('header')
  const [locale, setLocale] = useState('DE')
  const [vmods, setVmods] = useState(null)
  const [pick, setPick] = useState([])

  const load = async () => {
    const r = await apiFetch(`/api/listings/aplus?asin=${encodeURIComponent(asin)}`)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `Could not load the A+ page (${r.status})`)
    setData(j); setMods(j.page ? j.page.modules : null); setBrief(j.page ? j.page.brief : ''); setDirty(false); setVmods(null)
    return j
  }
  useEffect(() => { setData(null); load().catch(e => setErr(e.message)) }, [asin]) // eslint-disable-line react-hooks/exhaustive-deps
  const op = async (body, label) => {
    setErr(''); setBusy(label || 'Saving…')
    try {
      const r = await apiFetch('/api/listings/aplus', { method: 'POST', body: JSON.stringify({ asin, ...body }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `Could not do that (${r.status})`)
      await load()
      return j
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }
  const page = data && data.page
  const images = (page && page.images) || []
  const problems = useMemo(() => (mods ? aplusProblems(mods, images) : []), [mods, images])
  if (!data) return <Panel style={{ marginTop: 16 }}>{err ? <p role="alert" style={{ color: C.bad }}>{err}</p> : <Note>Loading the A+ page…</Note>}</Panel>

  const onAmazon = (() => { const uk = data.products.find(p => p.marketplace === 'UK') || data.products[0]; return uk ? liveAplus(uk.aplus || []).live : [] })()
  if (!page) return (
    <Panel style={{ marginTop: 16 }}>
      <H2>A+ page</H2>
      <Note>Build a new A+ page for this product: write a brief, upload the images, and Claude lays out the modules. You check and edit every word, approve it, then send it to each market.{onAmazon.length ? ` Live on Amazon UK now: ${onAmazon.map(d => d.name).join('; ')}.` : ''}</Note>
      {err ? <p role="alert" style={{ color: C.bad, fontSize: 13 }}>{err}</p> : null}
      <Btn primary onClick={() => op({ op: 'create', name: data.product ? `doddl A+ ${data.product}` : '' })}>Start an A+ page</Btn>
    </Panel>
  )

  const upload = async (e) => {
    const files = [...(e.target.files || [])]; e.target.value = ''
    for (const [i, f] of files.entries()) {
      setBusy(`Uploading ${i + 1} of ${files.length}…`); setErr('')
      try {
        const px = await imageSize(f)
        if (!px) throw new Error(`${f.name}: PM could not read its size; upload a JPEG or PNG`)
        const url = await onUpload(f, 'APLUS')
        const r = await apiFetch('/api/listings/aplus', { method: 'POST', body: JSON.stringify({ asin, op: 'image_add', url, w: px.w, h: px.h, name: f.name }) })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not add the image')
      } catch (x) { setErr(x.message); break }
    }
    setBusy(''); await load().catch(() => {})
  }
  const setMod = (i, m) => { setMods(mods.map((x, j) => j === i ? m : x)); setDirty(true) }
  const move = (i, d) => { const s = mods.slice(); const j = i + d; [s[i], s[j]] = [s[j], s[i]]; setMods(s); setDirty(true) }
  const v = (page.variants || {})[locale]
  const vm = vmods || (v ? v.modules : null)
  const approved = page.status === 'approved'
  const sendable = MARKETS.filter(m => modulesFor(page, m))

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: approved ? C.okBg : C.warnBg, color: approved ? C.ok : C.warn, borderRadius: 12, padding: '10px 14px', marginTop: 16 }}>
        <b style={{ flex: '1 1 260px', fontSize: 14 }}>{approved ? `Approved by ${page.approved_by}` : 'Draft: not approved yet'}{page.cost_usd ? ` · Claude so far: $${Number(page.cost_usd).toFixed(2)}` : ''}</b>
        {approved ? <Btn onClick={() => op({ op: 'reopen' })}>Reopen for edits</Btn> : <Btn primary disabled={!!busy || dirty || problems.length > 0} onClick={() => op({ op: 'approve' })}>Approve the page</Btn>}
      </div>
      {err ? <p role="alert" style={{ color: C.bad, fontSize: 13 }}>{err}</p> : null}
      {busy ? <p style={{ color: C.indigo, fontSize: 13, fontWeight: 700 }}>{busy}</p> : null}
      {onAmazon.length ? <Note>Live on Amazon UK now: {onAmazon.map(d => `${d.name} (${d.modules.length} modules)`).join('; ')}. Its modules are on each market tab.</Note> : null}

      <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: 14 }}>
        <H2>Brief</H2>
        <Note style={{ marginTop: 0 }}>What the page should say: who it is for, the points to land, the order, anything to avoid. Claude uses this, the master copy and the images.</Note>
        <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={6} style={input} placeholder="e.g. Lead with how the cutlery helps toddlers feed themselves from 18 months; show the short handles and the knife that cuts safely; end with the brand story of two parents who designed it." />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <Btn disabled={brief === page.brief || !!busy} onClick={() => op({ op: 'brief', brief })}>Save the brief</Btn>
        </div>
      </Panel>

      <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
        <H2>A+ images</H2>
        <Note style={{ marginTop: 0 }}>Banners are 970×600 (or 970×300 for text on the image); module images are 300×300 or 220×220. Larger is fine: PM crops to the shape from the centre.</Note>
        <label style={{ ...small, background: C.indigo, color: '#fff', border: 0, display: 'inline-flex', alignItems: 'center', minHeight: 36, fontSize: 13 }}>
          Upload A+ images
          <input type="file" accept="image/jpeg,image/png" multiple style={{ display: 'none' }} onChange={upload} disabled={!!busy} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 150 : 200}px, 1fr))`, gap: 12, marginTop: 12 }}>
          {images.map(x => {
            const ok = Object.entries(MODULES).filter(([, d]) => (d.image && fits(x, d.image)) || (d.block && fits(x, d.block.image))).map(([, d]) => d.label)
            return (
              <figure key={x.id} style={{ margin: 0, border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                <img src={x.url} alt={x.alt || ''} loading="lazy" style={{ width: '100%', height: 130, objectFit: 'contain', background: C.bg, display: 'block' }} />
                <figcaption style={{ padding: 8, fontSize: 12 }}>
                  <b>{x.w}×{x.h}</b> <span style={{ color: C.muted }}>{x.name}</span>
                  <div style={{ color: ok.length ? C.muted : C.bad, marginTop: 2 }}>{ok.length ? `Fits: ${ok.join(', ')}` : 'Too small for any module'}</div>
                  <input defaultValue={x.alt} maxLength={ALT_MAX} placeholder="Alt text: what the image shows" onBlur={e => { if (e.target.value !== x.alt) op({ op: 'image_alt', id: x.id, alt: e.target.value }) }} style={{ ...input, marginTop: 6, fontSize: 12, padding: '6px 8px' }} />
                  <button type="button" style={{ ...small, color: C.bad, marginTop: 6 }} onClick={() => op({ op: 'image_remove', id: x.id })}>Remove</button>
                </figcaption>
              </figure>
            )
          })}
        </div>
      </Panel>

      <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
        <H2>Modules (UK English)</H2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Btn primary disabled={!!busy || !page.brief.trim() || !images.length} onClick={() => { if (!mods.length || window.confirm('Claude will replace the current modules (and clear the translations). Carry on?')) op({ op: 'build' }, 'Claude is building the page (about 30 seconds)…') }}>Build with Claude (about $0.20)</Btn>
          {!page.brief.trim() || !images.length ? <span style={{ fontSize: 13, color: C.muted }}>Save a brief and upload images first.</span> : null}
          <span style={{ flex: 1 }} />
          <select value={addType} onChange={e => setAddType(e.target.value)} style={{ ...input, width: 'auto', minHeight: 36 }}>{Object.entries(MODULES).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}</select>
          <button type="button" style={{ ...small, minHeight: 36 }} disabled={mods.length >= MAX_MODULES} onClick={() => { setMods([...mods, blank(addType)]); setDirty(true) }}>Add a module</button>
        </div>
        {mods.map((m, i) => <ModuleEditor key={i} m={m} i={i} n={mods.length} images={images} onChange={x => setMod(i, x)} onMove={d => move(i, d)} onRemove={() => { setMods(mods.filter((_, j) => j !== i)); setDirty(true) }} />)}
        {problems.length && mods.length ? <div style={{ marginTop: 12, background: C.warnBg, color: C.warn, borderRadius: 10, padding: '8px 12px', fontSize: 13 }}><b>Before it can be approved:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div> : null}
        {dirty ? <div style={{ position: 'sticky', bottom: 8, marginTop: 12, display: 'flex', gap: 8, background: C.soft, padding: 10, borderRadius: 10 }}><b style={{ flex: 1, alignSelf: 'center' }}>Unsaved changes</b><Btn onClick={() => { setMods(page.modules); setDirty(false) }}>Undo</Btn><Btn primary disabled={!!busy} onClick={() => op({ op: 'modules', modules: mods })}>Save the modules</Btn></div> : null}
      </Panel>

      <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
        <H2>Translations</H2>
        <Note style={{ marginTop: 0 }}>Layout and images follow the UK English page; only the words are translated. Your approval is the language review HQ needs before it sends to that store.</Note>
        <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {LOCALES.map(l => { const s = (page.variants || {})[l]; return <Pill key={l} on={locale === l} onClick={() => { setLocale(l); setVmods(null) }} style={{ minHeight: 34 }}>{l}{s ? (s.status === 'approved' ? ' ✓' : ' ·') : ''}</Pill> })}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Btn primary disabled={!!busy || !approved} onClick={() => op({ op: 'translate', locale }, `Claude is translating into ${locale}…`)}>{v ? 'Translate again' : 'Translate with Claude'} (about $0.03)</Btn>
          {!approved ? <span style={{ fontSize: 13, color: C.muted }}>Approve the UK English page first.</span> : null}
          {v ? <Chip bg={v.status === 'approved' ? C.okBg : C.warnBg} fg={v.status === 'approved' ? C.ok : C.warn}>{v.status === 'approved' ? `Approved by ${v.approved_by}` : 'Draft: check it, then approve'}</Chip> : null}
        </div>
        {vm ? vm.map((m, i) => {
          const en = page.modules[i] || {}
          const row = (label, enT, t, set) => (
            <div key={label} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10, marginTop: 8 }}>
              <div style={{ fontSize: 13, color: C.muted }}><b style={{ display: 'block', fontSize: 11, textTransform: 'uppercase' }}>{label}</b>{enT}</div>
              <textarea value={t || ''} rows={Math.min(6, Math.ceil(String(t || '').length / 70) + 1)} onChange={e => setVmods(set(e.target.value))} style={input} />
            </div>
          )
          const upd = (fn) => (val) => vm.map((x, j) => (j === i ? fn(JSON.parse(JSON.stringify(x)), val) : x))
          return (
            <div key={i} style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${C.line2}` }}>
              <b style={{ fontSize: 13 }}>Module {i + 1}: {MODULES[m.type].label}</b>
              {row('Headline', en.headline, m.headline, upd((x, val) => { x.headline = val; return x }))}
              {m.body != null && en.body ? row('Text', en.body, m.body, upd((x, val) => { x.body = val; return x })) : null}
              {(m.bullets || []).map((b, k) => row(`Key point ${k + 1}`, (en.bullets || [])[k], b, upd((x, val) => { x.bullets[k] = val; return x })))}
              {(m.blocks || []).map((b, k) => [row(`Block ${k + 1} headline`, ((en.blocks || [])[k] || {}).headline, b.headline, upd((x, val) => { x.blocks[k].headline = val; return x })), row(`Block ${k + 1} text`, ((en.blocks || [])[k] || {}).body, b.body, upd((x, val) => { x.blocks[k].body = val; return x }))])}
            </div>
          )
        }) : null}
        {v ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {vmods ? <Btn disabled={!!busy} onClick={() => op({ op: 'variant_modules', locale, modules: vmods })}>Save the {locale} text</Btn> : null}
            {v.status !== 'approved' || vmods ? <Btn primary disabled={!!busy || !!vmods} onClick={() => op({ op: 'variant_approve', locale })}>Approve the {locale} text</Btn> : null}
          </div>
        ) : null}
      </Panel>

      <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 20 }}>
        <H2>Send to the markets</H2>
        <Note style={{ marginTop: 0 }}>Each market you send goes to HQ: it checks the page, Amazon validates it, and you get an approval card. Once approved, HQ creates the page on Amazon and submits it for Amazon's review (usually up to 7 days). The daily read shows when it is live.</Note>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {MARKETS.map(m => {
            const s = (page.sends || {})[m]
            const live = aplusLiveState(s, data.products.find(p => p.marketplace === m))
            const [lab, bg, fg] = live ? LIVE[live.state] : s ? SEND[s.status] || [s.status, C.grey, C.muted] : [sendable.includes(m) ? 'Ready to send' : 'Translation not approved', C.grey, C.muted]
            const can = approved && sendable.includes(m) && !(s && ['submitted', 'in_approval'].includes(s.status))
            return (
              <label key={m} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', border: `1px solid ${C.line}`, borderRadius: 10, padding: 8, opacity: can ? 1 : 0.75 }}>
                <input type="checkbox" disabled={!can} checked={pick.includes(m)} onChange={e => setPick(e.target.checked ? [...pick, m] : pick.filter(x => x !== m))} style={{ marginTop: 3 }} />
                <span style={{ flex: 1 }}><b>Amazon {m}</b><br /><Chip bg={bg} fg={fg}>{lab}</Chip>{live ? <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 2 }}>{live.why}</span> : s && s.note ? <span style={{ display: 'block', fontSize: 12, color: C.muted, marginTop: 2 }}>{s.note}</span> : null}{s && s.at ? <span style={{ display: 'block', fontSize: 11, color: C.faint }}>sent {fmtWhen(s.at)}</span> : null}</span>
              </label>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Btn primary disabled={!approved || !pick.length || !!busy} onClick={async () => { await op({ op: 'send', markets: pick }); setPick([]) }}>Send {pick.length || ''} market{pick.length === 1 ? '' : 's'} for approval</Btn>
        </div>
      </Panel>
    </div>
  )
}
