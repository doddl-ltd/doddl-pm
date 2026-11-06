// Ad review (artefact_type ad_creative; boards AdReview / AdReviewPhone).
// Every placement preview, per-variant words (edits → edits.variants[id]), checks, picture rights, why,
// what happens after yes, and a per-variant answer (lines[variant.id] = approved | edited | rejected).
import { useState } from 'react'
import {
  C, Panel, H2, Lbl, Note, Ph, Seg, Pill, Pills, Tick, Radio, Field, inputStyle, Checks, Steps, WhyBlock, Table,
  PhoneFrame, SafeZones, Avatar, mini, Fold, Cols, Col, Btn, text,
} from './reviewKit'

const PLATFORMS = [
  { value: 'meta', label: 'Facebook and Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'amazon_sb', label: 'Amazon Sponsored Brands' },
]
const PHONE_PLACES = [
  { value: 'feed', label: 'Instagram feed', platform: 'meta' },
  { value: 'story', label: 'Stories, Reels', platform: 'meta' },
  { value: 'fb', label: 'Facebook feed', platform: 'meta' },
  { value: 'market', label: 'Marketplace', platform: 'meta' },
  { value: 'tiktok', label: 'TikTok', platform: 'tiktok' },
  { value: 'amazon', label: 'Amazon', platform: 'amazon_sb' },
]
const COPY_FIELDS = ['primary_text', 'headline', 'description', 'cta']
const CTAS = ['Shop now', 'Learn more', 'Buy now', 'Order now', 'Get offer', 'See more']

/** The variant as it will run: the artefact's copy with the approver's edits on top. */
export function variantWithEdits(v, edits) {
  const e = (edits && edits.variants && edits.variants[v.id]) || {}
  const out = { ...v }
  for (const k of COPY_FIELDS) if (typeof e[k] === 'string') out[k] = e[k]
  return out
}

function hostOf(url) {
  if (!url) return 'doddl.com'
  try { return new URL(url.startsWith('http') ? url : `https://${url}`).host.replace(/^www\./, '') } catch (_) { return 'doddl.com' }
}

/** A preview you can click to pin a comment to a spot ({kind:'point', placement, x, y}). */
function Pinnable({ placement, comments, pending, onPin, children, disabled }) {
  const pins = (comments || []).filter(c => c.anchor && c.anchor.kind === 'point' && c.anchor.placement === placement)
  const click = (e) => {
    if (disabled) return
    const r = e.currentTarget.getBoundingClientRect()
    onPin({ placement, x: Math.round(((e.clientX - r.left) / r.width) * 100) / 100, y: Math.round(((e.clientY - r.top) / r.height) * 100) / 100 })
  }
  const dot = (x, y, label, hot) => (
    <span key={label + x + y} aria-hidden="true" style={{ position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`, transform: 'translate(-50%,-50%)', width: 22, height: 22, borderRadius: '50%', background: hot ? C.bad : C.indigo, color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff', pointerEvents: 'none', zIndex: 3 }}>{label}</span>
  )
  return (
    <div onClick={click} style={{ position: 'relative', cursor: disabled ? 'default' : 'crosshair' }}>
      {children}
      {pins.map((c, i) => dot(c.anchor.x, c.anchor.y, String(i + 1)))}
      {pending && pending.placement === placement ? dot(pending.x, pending.y, '+', true) : null}
    </div>
  )
}

function FeedIG({ v, img }) {
  return (
    <PhoneFrame>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}><Avatar /><span style={mini}><b>doddl</b><br />Sponsored</span></div>
      <Ph url={img.url} alt={img.label} style={{ height: 292 }}>{img.label}<br />4:5</Ph>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, padding: '8px 10px', background: C.bg }}>
        <span style={mini}><b>{v.headline}</b></span>
        <span style={{ ...mini, border: `1px solid ${C.border}`, borderRadius: 6, padding: '3px 8px', fontWeight: 800, whiteSpace: 'nowrap' }}>{v.cta || 'Shop now'}</span>
      </div>
      <p style={{ ...mini, margin: 0, padding: '8px 10px 12px' }}><b>doddl</b> {(v.primary_text || '').slice(0, 70)} {(v.primary_text || '').length > 70 ? <span style={{ color: C.faint }}>… more</span> : null}</p>
    </PhoneFrame>
  )
}

function Story({ v, img, safe, dark, height = 420, note }) {
  return (
    <PhoneFrame dark={dark}>
      <Ph dark={dark} url={img.url} alt={img.label} style={{ height, alignItems: 'flex-end' }}>
        {safe ? <SafeZones /> : null}
        <div style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', gap: 6, alignItems: 'center', zIndex: 1 }}><Avatar size={20} /><span style={{ ...mini, color: dark ? '#fff' : C.ink }}><b>doddl</b> · Sponsored</span></div>
        <div style={{ position: 'absolute', top: '45%', left: 0, right: 0, textAlign: 'center', padding: '0 16px', zIndex: 1 }}>
          {v.overlay ? <span style={{ fontSize: 17, fontWeight: 800, color: dark ? '#fff' : C.ink }}>{v.overlay}</span> : null}
          <br /><span style={mini}>{note || `${img.label} · 9:16`}</span>
        </div>
        {dark ? (
          <div style={{ position: 'absolute', left: 10, bottom: 16, right: 56, color: '#fff', textAlign: 'left', zIndex: 1 }}>
            <span style={mini}><b>doddl</b> · Sponsored</span><br /><span style={mini}>{(v.primary_text || '').slice(0, 70)}</span>
          </div>
        ) : (
          <div style={{ width: '100%', padding: '0 12px 14px', boxSizing: 'border-box', zIndex: 1 }}><div style={{ background: '#fff', borderRadius: 8, textAlign: 'center', padding: 8, fontSize: 12, fontWeight: 800, color: C.ink }}>{v.cta || 'Shop now'}</div></div>
        )}
      </Ph>
    </PhoneFrame>
  )
}

function FeedFB({ v, img, landing }) {
  return (
    <PhoneFrame>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}><Avatar /><span style={mini}><b>doddl</b><br />Sponsored</span></div>
      <p style={{ ...mini, margin: 0, padding: '0 10px 8px' }}>{v.primary_text}</p>
      <Ph url={img.url} alt={img.label} style={{ height: 230 }}>{img.label}<br />1:1</Ph>
      <div style={{ padding: '8px 10px 12px', background: C.bg }}>
        <span style={{ ...mini, color: C.muted }}>{hostOf(landing).toUpperCase()}</span><br />
        <span style={mini}><b>{v.headline}</b></span><br />
        {v.description ? <span style={{ ...mini, color: C.muted }}>{v.description}</span> : null}
      </div>
    </PhoneFrame>
  )
}

function Marketplace({ v, img, landing }) {
  return (
    <div style={{ width: 220, flex: 'none', border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
      <Ph url={img.url} alt={img.label} style={{ height: 150 }}>{img.label}<br />1:1</Ph>
      <p style={{ ...mini, margin: 0, padding: '8px 10px' }}><b>{v.headline}</b><br /><span style={{ color: C.muted }}>{hostOf(landing)}</span></p>
    </div>
  )
}

function AmazonSB({ v, isMobile }) {
  const tiles = ['Product 1', 'Product 2', 'Product 3']
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: isMobile ? 12 : 14, display: 'flex', gap: isMobile ? 10 : 16, alignItems: 'center', flexWrap: 'wrap', maxWidth: 860, background: '#fff' }}>
      <Ph style={{ width: isMobile ? 70 : 120, height: isMobile ? 36 : 60 }}>doddl logo</Ph>
      <div style={{ flex: '1 1 160px' }}>
        <p style={{ margin: 0, fontSize: isMobile ? 15 : 18, fontWeight: 800 }}>{v.headline}</p>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: C.blue, fontWeight: 800 }}>Shop doddl ›</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, width: isMobile ? '100%' : 'auto' }}>
        {tiles.map(t => <Ph key={t} url={null} style={{ width: isMobile ? 'auto' : 110, height: isMobile ? 80 : 110 }}>{t}</Ph>)}
      </div>
    </div>
  )
}

function Caption({ children, style }) {
  return <p style={{ fontSize: 12, fontWeight: 800, color: C.muted, textAlign: 'center', margin: '8px 0 0', ...style }}>{children}</p>
}

const DEC = [
  { value: 'approved', label: 'Approve', short: 'Approve' },
  { value: 'edited', label: 'Approve with my edits', short: 'Edits' },
  { value: 'rejected', label: 'Send back', short: 'Send back' },
]

export default function AdReview({ task, artefact, isMobile, readOnly, lines = {}, setLines, edits = {}, setEdits, comments = [], onComment }) {
  const a = artefact || {}
  const variants = (Array.isArray(a.variants) ? a.variants : []).filter(Boolean)
  const [platform, setPlatform] = useState(PLATFORMS.some(p => p.value === a.platform) ? a.platform : 'meta')
  const [vi, setVi] = useState(0)
  const [safe, setSafe] = useState(true)
  const [place, setPlace] = useState(a.platform === 'tiktok' ? 'tiktok' : a.platform === 'amazon_sb' ? 'amazon' : 'feed')
  const [pending, setPending] = useState(null)
  const [pinText, setPinText] = useState('')
  const [busy, setBusy] = useState(false)

  if (!variants.length) return <Panel><Note>This ad has no variants to show.</Note></Panel>
  const raw = variants[Math.min(vi, variants.length - 1)]
  const v = variantWithEdits(raw, edits)
  const name = raw.name || raw.id
  const img = { label: (raw.image && raw.image.label) || 'Ad picture', url: raw.image && raw.image.url }
  const landing = a.landing_url

  const setCopy = (key, val) => {
    if (readOnly) return
    const ev = (edits && edits.variants) || {}
    const cur = { ...(ev[raw.id] || {}) }
    if (val === (raw[key] || '')) delete cur[key]; else cur[key] = val
    const nextV = { ...ev }
    if (Object.keys(cur).length) nextV[raw.id] = cur; else delete nextV[raw.id]
    const next = { ...(edits || {}) }
    if (Object.keys(nextV).length) next.variants = nextV; else delete next.variants
    setEdits && setEdits(next)
    if (Object.keys(cur).length && lines[raw.id] !== 'rejected' && lines[raw.id] !== 'edited') setLines && setLines({ ...lines, [raw.id]: 'edited' })
  }
  const setDecision = (id, val) => { if (!readOnly && setLines) setLines({ ...lines, [id]: val }) }

  const addPin = async () => {
    if (!pending || !pinText.trim() || !onComment) return
    setBusy(true)
    try { await onComment(pinText.trim(), { kind: 'point', placement: pending.placement, x: pending.x, y: pending.y }); setPinText(''); setPending(null) } finally { setBusy(false) }
  }
  const canPin = !!onComment
  const pinProps = (placement) => ({ placement, comments, pending, onPin: setPending, disabled: !canPin })
  const pointComments = comments.filter(c => c.anchor && c.anchor.kind === 'point')

  const tiktokNote = (
    <div style={{ maxWidth: 420, fontSize: 14, lineHeight: 1.5, color: C.body }}>
      <p style={{ margin: '0 0 8px', fontWeight: 800, color: C.ink }}>TikTok needs a video</p>
      <p style={{ margin: 0 }}>{raw.video_task_id ? 'This ad uses a video that is approved on its own review screen. It cannot run until that video is approved.' : 'No video is attached to this variant yet.'} The red bands show where TikTok’s buttons and caption cover the picture: keep text and faces out of them.</p>
    </div>
  )

  // ── previews ──
  const desktopPreviews = (
    <div className="scroll-x" style={{ display: 'flex', gap: 22, padding: '6px 2px 12px', alignItems: 'flex-start', flexDirection: platform === 'amazon_sb' ? 'column' : 'row' }}>
      {platform === 'meta' ? (<>
        <div><Pinnable {...pinProps('ig_feed')}><FeedIG v={v} img={img} /></Pinnable><Caption>Instagram feed 4:5</Caption></div>
        <div><Pinnable {...pinProps('stories_reels')}><Story v={v} img={img} safe={safe} /></Pinnable><Caption>Stories and Reels 9:16</Caption></div>
        <div><Pinnable {...pinProps('fb_feed')}><FeedFB v={v} img={img} landing={landing} /></Pinnable><Caption>Facebook feed 1:1</Caption></div>
        <div><Pinnable {...pinProps('marketplace')}><Marketplace v={v} img={img} landing={landing} /></Pinnable><Caption>Marketplace and right column</Caption></div>
      </>) : null}
      {platform === 'tiktok' ? (<>
        <div><Pinnable {...pinProps('tiktok')}><Story v={v} img={img} safe={safe} dark height={440} note={`${img.label} · 9:16 video`} /></Pinnable><Caption>TikTok in-feed 9:16</Caption></div>
        {tiktokNote}
      </>) : null}
      {platform === 'amazon_sb' ? (<>
        <Pinnable {...pinProps('amazon_sb')}><AmazonSB v={v} /></Pinnable>
        <Caption style={{ textAlign: 'left' }}>Sponsored Brands headline banner, top of search results. Headline limit 50 characters; Amazon moderation takes up to 72 hours after you approve.</Caption>
      </>) : null}
    </div>
  )
  const phonePreview = (() => {
    const map = {
      feed: ['ig_feed', <FeedIG v={v} img={img} />],
      story: ['stories_reels', <Story v={v} img={img} safe={safe} />],
      fb: ['fb_feed', <FeedFB v={v} img={img} landing={landing} />],
      market: ['marketplace', <Marketplace v={v} img={img} landing={landing} />],
      tiktok: ['tiktok', <Story v={v} img={img} safe={safe} dark note="Needs the approved video" />],
      amazon: ['amazon_sb', <AmazonSB v={v} isMobile />],
    }
    const [pl, el] = map[place] || map.feed
    return <div style={{ display: 'flex', justifyContent: 'center' }}><Pinnable {...pinProps(pl)}>{el}</Pinnable></div>
  })()

  const pinBox = canPin && (pending || pointComments.length) ? (
    <div style={{ marginTop: 10 }}>
      {pointComments.length ? (
        <ol style={{ margin: '0 0 8px', paddingLeft: 20, fontSize: 13, lineHeight: 1.5, listStyle: 'decimal' }}>
          {pointComments.map(c => <li key={c.id || c.created_at}><b>{c.author}</b> on {String(c.anchor.placement).replace(/_/g, ' ')}: {c.body}{c.resolved ? <span style={{ color: C.muted }}> · resolved</span> : null}</li>)}
        </ol>
      ) : null}
      {pending ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label htmlFor="ad-pin" style={{ fontSize: 13, fontWeight: 800 }}>Comment on this spot ({pending.placement.replace(/_/g, ' ')})</label>
          <input id="ad-pin" value={pinText} onChange={e => setPinText(e.target.value)} placeholder="What needs changing here?" style={{ ...inputStyle, flex: '1 1 220px', width: 'auto' }} />
          <Btn onClick={addPin} disabled={busy || !pinText.trim()}>Add</Btn>
          <Btn onClick={() => setPending(null)}>Cancel</Btn>
        </div>
      ) : null}
    </div>
  ) : null

  const variantTabs = (
    <Seg label="Ad" value={String(Math.min(vi, variants.length - 1))} onChange={x => setVi(Number(x))}
      options={variants.map((x, i) => ({ value: String(i), label: `${x.name || x.id}${isMobile && lines[x.id] ? (lines[x.id] === 'rejected' ? ' ✕' : ' ✓') : ''}` }))} />
  )

  const words = (
    <>
      <Field id="ad-pt" label="Primary text" hint={`${(v.primary_text || '').length} characters · first 125 show before “more”`}>
        <textarea id="ad-pt" rows={isMobile ? 4 : 3} style={inputStyle} value={v.primary_text || ''} readOnly={readOnly} onChange={e => setCopy('primary_text', e.target.value)} />
      </Field>
      <Field id="ad-hl" label="Headline" hint={`${(v.headline || '').length} of ${platform === 'amazon_sb' ? 50 : 40}`}>
        <input id="ad-hl" style={inputStyle} value={v.headline || ''} readOnly={readOnly} onChange={e => setCopy('headline', e.target.value)} />
      </Field>
      <Field id="ad-ds" label="Description" hint="Facebook feed only">
        <input id="ad-ds" style={inputStyle} value={v.description || ''} readOnly={readOnly} onChange={e => setCopy('description', e.target.value)} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: isMobile ? 0 : 12 }}>
        <Field id="ad-cta" label="Button">
          <select id="ad-cta" style={inputStyle} value={v.cta || ''} disabled={readOnly} onChange={e => setCopy('cta', e.target.value)}>
            {[...new Set([v.cta, raw.cta, ...CTAS].filter(Boolean))].map(o => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field id="ad-url" label="Lands on"><input id="ad-url" style={{ ...inputStyle, background: C.bg }} value={landing || 'Not given'} readOnly /></Field>
      </div>
      {a.utm ? <Note style={{ marginTop: 10 }}>Tracking added automatically: {a.utm}</Note> : null}
    </>
  )

  const runs = [['Audience', a.audience], ['Placements', text(a.placements)], ['Budget', a.budget_text], ['Dates', a.dates_text], ['Campaign', [a.campaign, a.ad_set].filter(Boolean).join(' · ')]].filter(x => x[1])
  const whereRuns = runs.length ? (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: '10px 20px', fontSize: 14, lineHeight: 1.45 }}>
      {runs.map(([k, val]) => <div key={k}><Lbl>{k}</Lbl>{val}</div>)}
    </div>
  ) : <Note>The agent did not say where this runs.</Note>

  const running = (a.running_now || []).filter(Boolean)
  const picture = (
    <>
      <Ph url={img.url} alt={img.label} style={{ height: 120, borderRadius: 10 }}>{img.label}</Ph>
      <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.5, color: C.body }}>
        {raw.image && raw.image.path ? <>{raw.image.path}<br /></> : null}
        {raw.image && raw.image.rights ? raw.image.rights : 'No picture rights given: ask the agent before approving.'}
      </p>
    </>
  )
  const why = raw.why || a.why
  const afterYes = (a.after_yes || []).filter(Boolean)

  const decideRow = (x) => (
    <fieldset key={x.id} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 14px', margin: 0, minWidth: 0 }}>
      <legend style={{ fontWeight: 800, fontSize: 14, padding: '0 6px' }}>{x.name || x.id}</legend>
      {DEC.map(d => <Radio key={d.value} name={`ad-dec-${x.id}`} checked={lines[x.id] === d.value} disabled={readOnly} onChange={() => setDecision(x.id, d.value)}>{d.label}</Radio>)}
    </fieldset>
  )
  const yes = variants.filter(x => lines[x.id] && lines[x.id] !== 'rejected').map(x => x.name || x.id)
  const no = variants.filter(x => lines[x.id] === 'rejected').map(x => x.name || x.id)
  const summary = !yes.length && !no.length ? 'No answer per ad yet: pick one for each ad.' : `${yes.length ? `Approve ${yes.join(' and ')}` : 'Approve none'}${no.length ? `; send ${no.join(' and ')} back` : ''}.`

  if (isMobile) {
    const cur = lines[raw.id]
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {variantTabs}
        <Pills label="Placement">{PHONE_PLACES.map(p => <Pill key={p.value} on={place === p.value} onClick={() => setPlace(p.value)} style={{ minHeight: 40, fontSize: 13 }}>{p.label}</Pill>)}</Pills>
        <Panel pad="14px">
          {phonePreview}
          {place === 'tiktok' ? <div style={{ marginTop: 10 }}>{tiktokNote}</div> : null}
          <Tick checked={safe} onChange={setSafe} style={{ justifyContent: 'center' }}>Show safe zones</Tick>
          {pinBox}
        </Panel>
        <Panel pad="14px"><H2>Checks on {name}</H2><Checks checks={raw.checks || a.checks} /></Panel>
        <Fold title="Words, link and edits">{words}</Fold>
        <Fold title="Where it runs and why">{whereRuns}{why ? <div style={{ marginTop: 10 }}><WhyBlock why={why} evidence={a.evidence} /></div> : null}</Fold>
        <Fold title="The picture">{picture}</Fold>
        {running.length ? <Fold title="Already running in this campaign">{running.map((r, i) => <p key={i} style={{ margin: i ? '8px 0 0' : 0, fontSize: 14, lineHeight: 1.45 }}><b>{r.name}</b> · spend {text(r.spend) || '–'} · click rate {text(r.ctr) || '–'} · cost per sale {text(r.cpa) || '–'}{r.note ? <><br /><span style={{ color: C.muted }}>{r.note}</span></> : null}</p>)}</Fold> : null}
        {afterYes.length ? <Fold title="After you say yes"><Steps items={afterYes} /></Fold> : null}
        <Panel pad="14px">
          <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 800 }}>{name}: your answer</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            {DEC.map(d => (
              <button key={d.value} type="button" disabled={readOnly} aria-pressed={cur === d.value} onClick={() => setDecision(raw.id, d.value)}
                style={{ minHeight: 48, borderRadius: 12, font: "800 15px 'Nunito', sans-serif", border: `1px solid ${cur === d.value ? C.indigo : C.border}`, background: cur === d.value ? C.indigo : '#fff', color: cur === d.value ? '#fff' : C.ink, cursor: readOnly ? 'default' : 'pointer' }}>{d.short}</button>
            ))}
          </div>
          <Note style={{ marginTop: 8 }}>{summary}</Note>
        </Panel>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
        <Seg label="Platform" options={PLATFORMS} value={platform} onChange={setPlatform} />
        {variantTabs}
        <Tick checked={safe} onChange={setSafe} style={{ marginLeft: 'auto' }}>Show safe zones</Tick>
      </div>

      <Panel style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
          <H2>{name}: how it looks in every placement</H2>
          {canPin ? <Note>Click a preview to pin a comment to that spot</Note> : null}
        </div>
        {desktopPreviews}
        {pinBox}
      </Panel>

      <Cols style={{ marginTop: 20 }}>
        <Col basis={520}>
          <Panel>
            <H2>Words on {name}</H2>
            <Note>{readOnly ? 'The words as they were decided.' : 'Edit here and the previews update. Any edit goes back through the Brand checker before it runs.'}</Note>
            {words}
          </Panel>
          <Panel><H2>Where it runs and what it spends</H2>{whereRuns}</Panel>
          {running.length ? (
            <Panel>
              <H2>Already running in this campaign</H2>
              <Note style={{ marginBottom: 10 }}>Last 7 days, so you can see what these new ads have to beat.</Note>
              <Table head={['Ad', 'Spend', 'Click rate', 'Cost per sale', 'Agent says']} rows={running.map(r => [r.name, text(r.spend), text(r.ctr), text(r.cpa), r.note || ''])} />
            </Panel>
          ) : null}
        </Col>
        <Col basis={380}>
          <Panel><H2>Checks on {name}</H2><Checks checks={raw.checks || a.checks} /></Panel>
          <Panel><H2>The picture</H2>{picture}</Panel>
          {why || (a.evidence || []).length ? <Panel><H2>Why the agent made this</H2><WhyBlock why={why} evidence={a.evidence} expected={a.expected_effect} undo={a.undo} /></Panel> : null}
          {afterYes.length ? <Panel><H2>After you say yes</H2><Steps items={afterYes} /></Panel> : null}
        </Col>
      </Cols>

      <Panel style={{ marginTop: 20 }}>
        <H2>Your answer, ad by ad</H2>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, variants.length)}, minmax(0, 1fr))`, gap: 14 }}>
          {variants.map(decideRow)}
        </div>
        <Note style={{ marginTop: 10 }}>{summary} Anything sent back needs a note to the agent.</Note>
      </Panel>
    </div>
  )
}
