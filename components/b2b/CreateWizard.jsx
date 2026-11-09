// Create a campaign (board B2BCreate): five steps, starting with the business type. The draft saves as you go
// (POST /api/b2b/campaigns once, then PATCH /api/b2b/campaigns/:id); "Send for approval" posts .../submit, which
// makes the b2b_definition card for the outreach approver.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { C, Panel, H2, Lbl, Note, Chip, Btn, Pill, inputStyle, selectStyle, StateLine } from '../approvals/renderers/reviewKit'
import { BackLink } from '../approvals/ui'
import { DefRow, Tag, font } from './kit'
import {
  GOALS, OFFERS, CHANNELS, COUNTRIES, COUNTRY_CODES, WIZARD_STEPS, ALWAYS_RULES, cleanDefinition, definitionFromType, submitProblems,
  suggestedName, goalName, offerName, channelName, countryName,
} from '../../lib/b2b'

const SAVE_FIELDS = ['name', 'business_type_id', 'definition', 'goal', 'offers', 'market', 'volume', 'sample_size', 'pace', 'channels', 'people', 'approver']

function blankForm() {
  return {
    name: '', business_type_id: null, definition: cleanDefinition({}), goal: { id: null, target: '', by: '' }, offers: [], market: { country: null, regions: [], language: null },
    volume: null, sample_size: null, pace: '', channels: ['email', 'phone', 'post'], people: { replies: null, calls: null }, approver: null,
  }
}

function fromCampaign(c) {
  const f = blankForm()
  for (const k of SAVE_FIELDS) if (c[k] != null) f[k] = c[k]
  f.definition = cleanDefinition(c.definition || {})
  f.goal = { id: null, target: '', by: '', ...(c.goal || {}) }
  f.market = { country: null, regions: [], language: null, ...(c.market || {}) }
  f.people = { replies: null, calls: null, ...(c.people || {}) }
  return f
}

/** Apply a business type: its definition and defaults (goal, offers, country, sample). */
function withType(f, t) {
  const d = (t && t.defaults) || {}
  const country = d.country && COUNTRIES[d.country] ? d.country : f.market.country
  return {
    ...f,
    business_type_id: t ? t.id : null,
    definition: { ...definitionFromType(t), own_words: f.definition.own_words },
    goal: { ...f.goal, id: d.goal || f.goal.id },
    offers: Array.isArray(d.offers) ? d.offers : f.offers,
    market: country ? { country, regions: (COUNTRIES[country].regions || []).slice(0, 2), language: COUNTRIES[country].language } : f.market,
    sample_size: d.sample_size || f.sample_size,
    channels: country && country !== 'GB' ? [...new Set([...f.channels, 'linkedin'])] : f.channels,
  }
}

function TagEditor({ items, kind, onChange, label }) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const add = () => { const v = text.trim(); if (v) onChange([...(items || []), v]); setText(''); setAdding(false) }
  return (
    <div>
      {(items || []).map((x, i) => <Tag key={`${x}-${i}`} kind={kind} onRemove={() => onChange(items.filter((_, j) => j !== i))}>{x}</Tag>)}
      {adding ? (
        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', maxWidth: '100%' }}>
          <input autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } if (e.key === 'Escape') setAdding(false) }}
            aria-label={`Add to ${label}`} style={{ ...inputStyle, width: 240, maxWidth: '100%', minHeight: 36, padding: '6px 10px' }} />
          <Btn onClick={add} style={{ minHeight: 36, padding: '0 12px', fontSize: 13 }}>Add</Btn>
        </span>
      ) : (
        <Btn onClick={() => setAdding(true)} style={{ minHeight: 32, padding: '0 10px', fontSize: 13 }} aria-label={`Add to ${label}`}>+ Add</Btn>
      )}
    </div>
  )
}

function Choice({ on, onClick, title, desc, extra }) {
  return (
    <button type="button" aria-pressed={!!on} onClick={onClick}
      style={{ border: `2px solid ${on ? C.indigo : C.line}`, boxShadow: on ? '0 0 0 3px #E3D9F7' : 'none', borderRadius: 14, background: '#fff', padding: 14, textAlign: 'left', font: 'inherit', color: C.ink, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <b style={{ fontSize: 15 }}>{title}</b>
      {desc ? <span style={{ fontSize: 13, color: C.muted, lineHeight: 1.4 }}>{desc}</span> : null}
      {extra ? <span style={{ fontSize: 12, fontWeight: 800, color: C.indigo }}>{extra}</span> : null}
    </button>
  )
}

function CheckRow({ checked, onChange, title, desc }) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid #F1EEF6', fontSize: 14, lineHeight: 1.45, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: C.indigo, marginTop: 2, flex: 'none' }} />
      <span><b>{title}</b>{desc ? <><br /><span style={{ color: C.muted }}>{desc}</span></> : null}</span>
    </label>
  )
}

export default function CreateWizard({ isMobile, fetcher, campaignId, typeId, onBack, onSubmitted }) {
  const [types, setTypes] = useState(null)
  const [people, setPeople] = useState([])
  const [form, setForm] = useState(blankForm)
  const [id, setId] = useState(campaignId)
  const [estimate, setEstimate] = useState(null)
  const [step, setStep] = useState(0)
  const [loadErr, setLoadErr] = useState('')
  const [saveState, setSaveState] = useState('')   // '', 'saving', 'saved', error text
  const [saveType, setSaveType] = useState(false)
  const [typeSaved, setTypeSaved] = useState(false)
  const [nameTouched, setNameTouched] = useState(!!campaignId)
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState('')
  const dirty = useRef(new Set())
  const timer = useRef(null)
  const idRef = useRef(campaignId)
  const formRef = useRef(form)
  formRef.current = form

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const t = await fetcher('/api/b2b/business-types')
        if (!live) return
        setTypes(t.types || []); setPeople(t.people || [])
        if (campaignId) {
          const d = await fetcher(`/api/b2b/campaigns/${campaignId}`)
          if (!live) return
          setForm(fromCampaign(d.campaign)); setEstimate(d.campaign.estimate || null)
        } else {
          const pick = (t.types || []).find(x => x.id === typeId) || (t.types || []).find(x => x.is_template)
          if (pick) { setForm(f => withType(f, pick)); dirty.current = new Set(SAVE_FIELDS) }
        }
      } catch (e) { if (live) setLoadErr(e.message) }
    })()
    return () => { live = false }
  }, [fetcher, campaignId, typeId])

  const curType = useMemo(() => (types || []).find(t => t.id === form.business_type_id) || null, [types, form.business_type_id])
  const suggested = suggestedName(curType ? curType.name : (form.definition.name || ''), form.goal.id, form.market.country)
  const shownName = nameTouched ? form.name : (form.name || suggested)

  const save = useCallback(async () => {
    clearTimeout(timer.current)
    const f = formRef.current
    const fields = [...dirty.current]
    if (!fields.length && idRef.current) return idRef.current
    dirty.current = new Set()
    const body = Object.fromEntries(fields.map(k => [k, f[k]]))
    if (!nameTouched && !f.name) body.name = suggested
    setSaveState('saving')
    try {
      let c
      if (!idRef.current) {
        c = await fetcher('/api/b2b/campaigns', { method: 'POST', body: JSON.stringify(Object.fromEntries(SAVE_FIELDS.map(k => [k, k === 'name' ? (f.name || suggested) : f[k]]))) })
        idRef.current = c.id; setId(c.id)
      } else if (Object.keys(body).length) {
        c = await fetcher(`/api/b2b/campaigns/${idRef.current}`, { method: 'PATCH', body: JSON.stringify(body) })
      }
      setSaveState('saved')
      return idRef.current
    } catch (e) {
      fields.forEach(k => dirty.current.add(k))
      setSaveState(e.message)
      throw e
    }
  }, [fetcher, nameTouched, suggested])

  const set = (patch) => {
    setForm(f => ({ ...f, ...patch }))
    Object.keys(patch).forEach(k => dirty.current.add(k))
    setSaveState('')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { save().catch(() => {}) }, 900)
  }
  const setDef = (patch) => set({ definition: { ...formRef.current.definition, ...patch } })
  useEffect(() => () => clearTimeout(timer.current), [])

  const pickType = (t) => { const f = withType(formRef.current, t); set(Object.fromEntries(SAVE_FIELDS.map(k => [k, f[k]]))) }
  const goStep = async (n) => { setStep(Math.max(0, Math.min(4, n))); if (typeof window !== 'undefined') window.scrollTo(0, 0); save().catch(() => {}) }

  const saveAsType = async () => {
    if (!saveType || typeSaved) return
    const f = formRef.current
    const t = await fetcher('/api/b2b/business-types', { method: 'POST', body: JSON.stringify({ name: f.definition.name || (curType && curType.name) || shownName, definition: f.definition, defaults: { goal: f.goal.id, offers: f.offers, country: f.market.country, sample_size: f.sample_size } }) })
    setTypeSaved(true); setTypes(ts => [...(ts || []), { ...t, campaigns: 0, learned_count: 0 }])
  }

  const submit = async () => {
    setSubmitErr('')
    const problems = submitProblems({ ...form, name: shownName })
    if (problems.length) { setSubmitErr(problems.join('. ')); return }
    setSubmitting(true)
    try {
      if (!nameTouched && !form.name) { dirty.current.add('name'); setForm(f => ({ ...f, name: suggested })); formRef.current = { ...formRef.current, name: suggested } }
      await saveAsType().catch(e => { throw new Error(`Could not save the business type: ${e.message}`) })
      const cid = await save()
      await fetcher(`/api/b2b/campaigns/${cid}/submit`, { method: 'POST', body: '{}' })
      onSubmitted(cid)
    } catch (e) { setSubmitErr(e.message) } finally { setSubmitting(false) }
  }

  if (loadErr) return <div style={{ fontFamily: font }}><BackLink onClick={onBack}>‹ B2B campaigns</BackLink><StateLine error={loadErr} /></div>
  if (!types) return <div style={{ fontFamily: font }}><BackLink onClick={onBack}>‹ B2B campaigns</BackLink><StateLine loading /></div>

  const country = form.market.country ? COUNTRIES[form.market.country] : null
  const d = form.definition
  const saved = (types || []).filter(t => !t.is_template)
  const templates = (types || []).filter(t => t.is_template)
  const cols = isMobile ? 'minmax(0, 1fr)' : 'repeat(3, minmax(0, 1fr))'
  const people2 = people.length ? people : ['Jon', 'Laura']
  const saveLine = saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Draft saved' : saveState ? `Not saved: ${saveState}` : id ? 'Draft saved as you go' : 'Saves as you go'

  // ── step 1 ──
  const step1 = (
    <>
      <Panel>
        <H2 style={{ margin: '0 0 4px', fontSize: 18 }}>1 · What kind of business?</H2>
        <Note style={{ margin: '0 0 14px', fontSize: 14 }}>Each example comes with who they are, who decides, where HQ finds them and the usual rules. Pick one to start.</Note>
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12 }}>
          {templates.map(t => <Choice key={t.id} on={form.business_type_id === t.id} onClick={() => pickType(t)} title={t.name} desc={t.description} />)}
        </div>
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="own" style={{ fontSize: 13, fontWeight: 800 }}>Or describe it in your own words</label>
          <textarea id="own" rows={2} value={d.own_words || ''} onChange={e => setDef({ own_words: e.target.value })} style={inputStyle}
            placeholder="For example: family-run hotels in Cornwall with a kids’ menu and a high chair policy" />
        </div>
      </Panel>

      <Panel style={{ border: `2px solid ${C.indigo}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <H2 style={{ margin: 0, fontSize: 18 }}>Business definition{curType ? `: ${curType.name}` : ''}</H2>
          <span style={{ fontSize: 13, color: C.muted }}>HQ scores every business it finds against this</span>
        </div>
        <DefRow first isMobile={isMobile} label="In one line"><input value={d.line || ''} onChange={e => setDef({ line: e.target.value })} aria-label="In one line" style={inputStyle} /></DefRow>
        <DefRow isMobile={isMobile} label="Include these kinds">
          {(d.kinds || []).map((k, i) => (
            <label key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, borderRadius: 8, padding: '5px 10px', margin: '0 6px 6px 0', background: C.bg, border: `1px solid ${C.line}`, cursor: 'pointer', minHeight: 32 }}>
              <input type="checkbox" checked={k.on !== false} onChange={e => setDef({ kinds: d.kinds.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) })} style={{ width: 16, height: 16, accentColor: C.indigo, margin: 0 }} />{k.t}
            </label>
          ))}
          <TagEditor items={[]} label="kinds" onChange={(v) => setDef({ kinds: [...(d.kinds || []), ...v.map(t => ({ t, on: true }))] })} />
        </DefRow>
        <DefRow isMobile={isMobile} label="Size"><input value={d.size || ''} onChange={e => setDef({ size: e.target.value })} aria-label="Size" style={inputStyle} /></DefRow>
        <DefRow isMobile={isMobile} label="Who decides"><input value={d.who_decides || ''} onChange={e => setDef({ who_decides: e.target.value })} aria-label="Who decides" style={inputStyle} /></DefRow>
        <DefRow isMobile={isMobile} label="Must have"><TagEditor kind="must" label="must have" items={d.must} onChange={(v) => setDef({ must: v })} /></DefRow>
        <DefRow isMobile={isMobile} label="Signs of a good fit"><TagEditor kind="nice" label="signs of a good fit" items={d.nice} onChange={(v) => setDef({ nice: v })} /></DefRow>
        <DefRow isMobile={isMobile} label="Rule out"><TagEditor kind="not" label="rule out" items={d.rule_out} onChange={(v) => setDef({ rule_out: v })} /></DefRow>
        <DefRow isMobile={isMobile} label="Where HQ finds them"><textarea rows={2} value={d.sources || ''} onChange={e => setDef({ sources: e.target.value })} aria-label="Where HQ finds them" style={inputStyle} placeholder="Company sites, public registers, trade-show lists, Google Maps" /></DefRow>
        <DefRow isMobile={isMobile} label="What they usually want from us"><input value={d.wants || ''} onChange={e => setDef({ wants: e.target.value })} aria-label="What they usually want from us" style={inputStyle} /></DefRow>
        <DefRow isMobile={isMobile} label="Contact rules"><textarea rows={2} value={d.contact_rules || ''} onChange={e => setDef({ contact_rules: e.target.value })} aria-label="Contact rules" style={inputStyle} /></DefRow>
        {curType && (curType.learned_rules || []).length > 0 && (
          <DefRow isMobile={isMobile} label="Learned from rejections">
            {curType.learned_rules.map((r, i) => <p key={i} style={{ margin: i ? '6px 0 0' : 0 }}>{r.rule}{r.count ? <span style={{ color: C.muted }}> · from {r.count}</span> : null}</p>)}
          </DefRow>
        )}
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44, fontSize: 14, fontWeight: 700, marginTop: 6 }}>
          <input type="checkbox" checked={saveType} disabled={typeSaved} onChange={e => setSaveType(e.target.checked)} style={{ width: 18, height: 18, accentColor: C.indigo }} />
          {typeSaved ? 'Saved as a business type' : 'Save as a business type, to reuse in future campaigns'}
        </label>
      </Panel>
    </>
  )

  // ── step 2 ──
  const step2 = (
    <>
      <Panel>
        <H2 style={{ margin: '0 0 4px', fontSize: 18 }}>2 · What do you want to happen?</H2>
        <Note style={{ margin: '0 0 14px', fontSize: 14 }}>Pick the one result that matters. It sets the offer, the emails and how HQ reports progress.</Note>
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12 }}>
          {GOALS.map(g => <Choice key={g.id} on={form.goal.id === g.id} onClick={() => set({ goal: { ...form.goal, id: g.id } })} title={g.name} desc={g.desc} />)}
        </div>
        <DefRow isMobile={isMobile} label="Target">
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : '1fr 1fr', gap: 10 }}>
            <input value={form.goal.target || ''} onChange={e => set({ goal: { ...form.goal, target: e.target.value } })} aria-label="Target" placeholder="For example: 30 trial packs" style={inputStyle} />
            <input value={form.goal.by || ''} onChange={e => set({ goal: { ...form.goal, by: e.target.value } })} aria-label="By when" placeholder="By when" style={inputStyle} />
          </div>
        </DefRow>
        <DefRow isMobile={isMobile} label="Campaign name">
          <input value={shownName} onChange={e => { setNameTouched(true); set({ name: e.target.value }) }} aria-label="Campaign name" style={inputStyle} />
        </DefRow>
      </Panel>
      <Panel>
        <H2 style={{ margin: '0 0 4px', fontSize: 18 }}>What we offer them</H2>
        <Note style={{ margin: '0 0 8px', fontSize: 14 }}>The reason to say yes. Tick everything you are happy to offer; HQ leads with the first. Emails may mention only these.</Note>
        {OFFERS.map(o => (
          <CheckRow key={o.id} checked={form.offers.includes(o.id)} title={o.name} desc={o.desc}
            onChange={(on) => set({ offers: on ? [...form.offers, o.id] : form.offers.filter(x => x !== o.id) })} />
        ))}
        <Note style={{ marginTop: 6 }}>Free samples are a cost, so they go to the spend approver in Who approves what if over the threshold. Prices come from the pricing sheet.</Note>
      </Panel>
    </>
  )

  // ── step 3 ──
  const step3 = (
    <>
      <Panel>
        <H2 style={{ margin: '0 0 4px', fontSize: 18 }}>3 · Where, and how many?</H2>
        <Note style={{ margin: '0 0 8px', fontSize: 14 }}>Start small: HQ finds a sample first, you check it, then it finds the rest.</Note>
        <DefRow first isMobile={isMobile} label="Country">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {COUNTRY_CODES.map(code => (
              <Pill key={code} on={form.market.country === code} style={{ minHeight: 40 }}
                onClick={() => set({ market: { country: code, regions: COUNTRIES[code].regions.slice(0, 2), language: COUNTRIES[code].language }, channels: code !== 'GB' ? [...new Set([...form.channels, 'linkedin'])] : form.channels })}>
                {COUNTRIES[code].name}
              </Pill>
            ))}
          </div>
        </DefRow>
        {country && (
          <>
            <DefRow isMobile={isMobile} label="Start with">
              {country.regions.map(r => (
                <label key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, borderRadius: 8, padding: '5px 10px', margin: '0 6px 6px 0', background: C.bg, border: `1px solid ${C.line}`, cursor: 'pointer', minHeight: 32 }}>
                  <input type="checkbox" checked={form.market.regions.includes(r)} style={{ width: 16, height: 16, accentColor: C.indigo, margin: 0 }}
                    onChange={e => set({ market: { ...form.market, regions: e.target.checked ? [...form.market.regions, r] : form.market.regions.filter(x => x !== r) } })} />{r}
                </label>
              ))}
              <Note>None ticked means the whole country.</Note>
            </DefRow>
            <DefRow isMobile={isMobile} label="Language">{form.market.language || country.language}</DefRow>
          </>
        )}
        <DefRow isMobile={isMobile} label="How many in total">
          <input type="number" min="1" inputMode="numeric" value={form.volume ?? ''} onChange={e => set({ volume: e.target.value === '' ? null : Number(e.target.value) })} aria-label="How many in total" style={inputStyle} />
        </DefRow>
        <DefRow isMobile={isMobile} label="Sample to check first">
          <input type="number" min="1" inputMode="numeric" value={form.sample_size ?? ''} onChange={e => set({ sample_size: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Sample size" style={inputStyle} />
        </DefRow>
        <DefRow isMobile={isMobile} label="Pace once live">
          <input value={form.pace || ''} onChange={e => set({ pace: e.target.value })} aria-label="Pace" placeholder="For example: 20 a day in week 1, then 50 a day" style={inputStyle} />
        </DefRow>
      </Panel>
      <Panel>
        <H2 style={{ margin: '0 0 4px', fontSize: 18 }}>Who is left out automatically</H2>
        <Note style={{ margin: '0 0 8px', fontSize: 14 }}>Checked against every campaign, so nobody hears from us twice.</Note>
        {['Existing customers and stockists', 'In another live B2B campaign', 'Asked us not to contact them', ...(country ? [country.excluded] : [])].map((x, i) => (
          <div key={x} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '10px 0', borderTop: i ? '1px solid #F1EEF6' : 0, fontSize: 14 }}>
            <span>{x}</span><Chip bg={C.okBg} fg={C.ok}>Checked by HQ</Chip>
          </div>
        ))}
      </Panel>
    </>
  )

  // ── step 4 ──
  const step4 = (
    <>
      <Panel>
        <H2 style={{ margin: '0 0 4px', fontSize: 18 }}>4 · How we reach them</H2>
        <Note style={{ margin: '0 0 8px', fontSize: 14 }}>Email does the first contact; people take over when someone is interested. HQ proposes the emails, the sender and the send times on the emails-and-flow card.</Note>
        {CHANNELS.map(ch => (
          <CheckRow key={ch.id} checked={form.channels.includes(ch.id)} title={ch.name} desc={ch.desc}
            onChange={(on) => set({ channels: on ? [...form.channels, ch.id] : form.channels.filter(x => x !== ch.id) })} />
        ))}
        {country && country.no_cold_email && form.channels.includes('email') && (
          <p role="note" style={{ margin: '8px 0 0', background: C.warnBg, color: '#6B3A00', borderRadius: 10, padding: '10px 14px', fontSize: 14, lineHeight: 1.5 }}>
            In Germany the first contact is LinkedIn, phone or post, never cold email. HQ uses email only once they agree.
          </p>
        )}
      </Panel>
      <Panel>
        <H2 style={{ margin: '0 0 4px', fontSize: 18 }}>When a person steps in</H2>
        <DefRow first isMobile={isMobile} label="Replies">
          <select value={form.people.replies || ''} onChange={e => set({ people: { ...form.people, replies: e.target.value || null } })} aria-label="Who answers replies" style={{ ...selectStyle, minHeight: 44, fontSize: 14 }}>
            <option value="">Choose…</option>{people2.map(p => <option key={p}>{p}</option>)}
          </select>
          <Note style={{ marginTop: 4 }}>HQ drafts every reply; this person checks and sends. Within 1 working day.</Note>
        </DefRow>
        <DefRow isMobile={isMobile} label="Calls and deals">
          <select value={form.people.calls || ''} onChange={e => set({ people: { ...form.people, calls: e.target.value || null } })} aria-label="Who takes calls" style={{ ...selectStyle, minHeight: 44, fontSize: 14 }}>
            <option value="">Choose…</option>{people2.map(p => <option key={p}>{p}</option>)}
          </select>
          <Note style={{ marginTop: 4 }}>Bulk orders, pricing and anything contractual.</Note>
        </DefRow>
        <DefRow isMobile={isMobile} label="Approver">
          <select value={form.approver || ''} onChange={e => set({ approver: e.target.value || null })} aria-label="Approver" style={{ ...selectStyle, minHeight: 44, fontSize: 14 }}>
            <option value="">From Who approves what (B2B, PR and creators)</option>{people2.map(p => <option key={p}>{p}</option>)}
          </select>
        </DefRow>
        <DefRow isMobile={isMobile} label="Samples">Sent by HQ once the reply is approved; follow-up reminder 14 days after delivery.</DefRow>
      </Panel>
      <Panel>
        <H2 style={{ margin: '0 0 4px', fontSize: 18 }}>Contact rules{country ? ` for ${country.name}` : ''}</H2>
        {country ? country.rules.map((r, i) => <p key={i} style={{ margin: 0, padding: '8px 0', borderTop: i ? '1px solid #F1EEF6' : 0, fontSize: 14, lineHeight: 1.45 }}>{r}</p>)
          : <Note>Pick the country in step 3.</Note>}
        {ALWAYS_RULES.map((r, i) => <p key={`a${i}`} style={{ margin: 0, padding: '8px 0', borderTop: '1px solid #F1EEF6', fontSize: 14, lineHeight: 1.45, color: C.body }}>{r}</p>)}
      </Panel>
    </>
  )

  // ── step 5 ──
  const regions = form.market.regions.length ? `start with ${form.market.regions.join(' and ')}` : 'the whole country'
  const summary = [
    ['Business type', `${curType ? curType.name : 'Your own words'}: ${d.line || d.own_words || '–'}`, 0],
    ['Goal', form.goal.id ? `${goalName(form.goal.id)}${form.goal.target ? `: ${form.goal.target}` : ''}${form.goal.by ? `, ${form.goal.by}` : ''}` : '–', 1],
    ['Offer', form.offers.map(offerName).join(', ') || '–', 1],
    ['Market', country ? `${country.name} · ${regions} · ${form.market.language || country.language}` : '–', 2],
    ['How many', `${form.volume || '–'}; sample of ${form.sample_size || '–'} first`, 2],
    ['Channels', form.channels.map(channelName).join(', ') || '–', 3],
    ['People', `${form.people.replies || '–'} answers replies; ${form.people.calls || '–'} takes calls and deals`, 3],
  ]
  const approverName = form.approver || 'The approver'
  const problems = submitProblems({ ...form, name: shownName })
  const step5 = (
    <>
      <Panel>
        <H2 style={{ margin: '0 0 4px', fontSize: 18 }}>5 · Check and send for approval</H2>
        <Note style={{ margin: '0 0 6px', fontSize: 14 }}>This becomes the definition card for {form.approver || 'the outreach approver'}. Nothing is searched for and nobody is contacted until it is approved.</Note>
        {summary.map(([k, v, s], i) => (
          <DefRow key={k} first={i === 0} isMobile={isMobile} label={k}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{v}</span>
              <Btn onClick={() => goStep(s)} style={{ minHeight: 32, padding: '0 10px', fontSize: 13, flex: 'none' }} aria-label={`Change ${k.toLowerCase()}`}>Change</Btn>
            </span>
          </DefRow>
        ))}
      </Panel>
      <Panel>
        <H2 style={{ margin: '0 0 8px', fontSize: 18 }}>What happens after you send it</H2>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8 }}>
          <li>{approverName} approves the definition (a card in Approvals)</li>
          <li>HQ finds a sample of {form.sample_size || '–'} within a day</li>
          <li>You tick or reject the sample; HQ learns from it</li>
          <li>HQ finds the rest and drafts the emails</li>
          <li>You approve the emails and the flow, then press go</li>
        </ol>
      </Panel>
    </>
  )

  const body = [step1, step2, step3, step4, step5][step]
  const nextLabel = step < 4 ? `Next: ${WIZARD_STEPS[step + 1].toLowerCase()}` : null

  const actions = (
    <Panel style={{ display: 'grid', gap: 8 }}>
      {step === 4 && <Btn primary onClick={submit} disabled={submitting}>{submitting ? 'Sending…' : 'Send for approval'}</Btn>}
      {step === 4 && problems.length > 0 && <Note style={{ color: C.warn }}>Still to do: {problems.join('; ')}.</Note>}
      {nextLabel && <Btn primary onClick={() => goStep(step + 1)}>{nextLabel}</Btn>}
      {step > 0 && <Btn onClick={() => goStep(step - 1)}>Back</Btn>}
      <Btn onClick={() => save().catch(() => {})}>Save draft</Btn>
      <Note aria-live="polite" style={{ textAlign: 'center' }}>{saveLine}</Note>
      {submitErr && <p role="alert" style={{ margin: 0, color: C.bad, fontSize: 13, fontWeight: 700 }}>{submitErr}</p>}
    </Panel>
  )

  const estimatePanel = (
    <Panel>
      <Lbl>HQ’s estimate</Lbl>
      {estimate && Object.keys(estimate).length ? (
        [['Found in the sources', estimate.found], ['Match every must-have', estimate.match], ['Contact we can use', estimate.contact], ['After rule-outs', estimate.after_rules]].map(([k, v], i) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 0', borderTop: i ? '1px solid #F1EEF6' : 0, fontSize: 14 }}><span>{k}</span><b>{v ?? '–'}</b></div>
        ))
      ) : <Note style={{ marginTop: 6 }}>HQ estimates how many there are once the definition is approved, before it searches for the sample.</Note>}
    </Panel>
  )

  const side = step === 0 ? (
    <>
      <Panel>
        <H2 style={{ margin: '0 0 4px' }}>Your saved business types</H2>
        <Note style={{ margin: '0 0 6px' }}>Definitions you have used before, with what you have learned.</Note>
        {!saved.length && <Note>None yet. Tick “Save as a business type” to keep this one.</Note>}
        {saved.map((t, i) => (
          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '10px 0', borderTop: i ? '1px solid #F1EEF6' : 0, fontSize: 14 }}>
            <span style={{ minWidth: 0 }}><b>{t.name}</b><br /><span style={{ fontSize: 12, color: C.muted }}>{t.campaigns} campaign{t.campaigns === 1 ? '' : 's'}{t.learned_count ? ` · ${t.learned_count} rule${t.learned_count === 1 ? '' : 's'} learned from rejections` : ''}{t.live ? ' · live' : ''}</span></span>
            <Btn onClick={() => pickType(t)} style={{ minHeight: 36, padding: '0 12px', fontSize: 13, flex: 'none' }} aria-label={`Use ${t.name}`}>{form.business_type_id === t.id ? 'In use' : 'Use'}</Btn>
          </div>
        ))}
      </Panel>
      {estimatePanel}
      <Panel>
        <H2 style={{ margin: '0 0 4px' }}>Next</H2>
        <Note style={{ margin: '0 0 12px' }}>2 · Goal and offer · 3 · Market and how many · 4 · Channels and contact rules · 5 · Check and send for approval</Note>
        <div style={{ display: 'grid', gap: 8 }}>
          <Btn primary onClick={() => goStep(1)}>Next: goal and offer</Btn>
          <Btn onClick={() => save().catch(() => {})}>Save draft</Btn>
          <Note aria-live="polite" style={{ textAlign: 'center' }}>{saveLine}</Note>
        </div>
      </Panel>
    </>
  ) : (
    <>
      <Panel>
        <Lbl>Campaign so far</Lbl>
        <p style={{ margin: '6px 0 2px', fontSize: 17, fontWeight: 800, overflowWrap: 'anywhere' }}>{shownName || 'Untitled'}</p>
        <Note>{[curType ? curType.name : 'Your own words', countryName(form.market.country), goalName(form.goal.id)].filter(Boolean).join(' · ')}</Note>
      </Panel>
      {estimatePanel}
      {actions}
    </>
  )

  return (
    <div style={{ fontFamily: font, color: C.ink, maxWidth: 1240 }}>
      <BackLink onClick={onBack}>‹ B2B campaigns</BackLink>
      <h1 style={{ margin: '4px 0 4px', fontSize: isMobile ? 24 : 30, fontWeight: 800, letterSpacing: '-0.01em' }}>{campaignId ? 'Finish the campaign' : 'Create a campaign'}</h1>
      <p style={{ margin: 0, color: C.muted, fontSize: isMobile ? 14 : 15, maxWidth: 820, lineHeight: 1.5 }}>
        Start with the kind of business you want to talk to. Pick an example and change it, reuse one you have saved, or describe it in your own words and HQ drafts the rest.
      </p>

      <div role="tablist" aria-label="Steps" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 6, marginTop: 16 }}>
        {WIZARD_STEPS.map((label, i) => (
          <button key={label} type="button" role="tab" aria-selected={i === step} aria-label={`Step ${i + 1}: ${label}`} onClick={() => goStep(i)}
            style={{ border: 0, borderRadius: 10, padding: isMobile ? '8px 4px' : '10px 12px', textAlign: isMobile ? 'center' : 'left', font: `800 ${isMobile ? 13 : 14}px ${font}`, cursor: 'pointer', minHeight: isMobile ? 44 : 56,
              background: i === step ? C.indigo : i < step ? C.okBg : C.grey, color: i === step ? '#fff' : i < step ? C.ok : C.muted, minWidth: 0 }}>
            {isMobile ? i + 1 : `${i + 1} · ${label}`}
          </button>
        ))}
      </div>
      {isMobile && <p style={{ margin: '8px 0 0', fontSize: 14, fontWeight: 800 }}>Step {step + 1} of 5 · {WIZARD_STEPS[step]}</p>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 12 : 20, marginTop: isMobile ? 12 : 20, alignItems: 'flex-start' }}>
        <div style={{ flex: isMobile ? '1 1 100%' : '1 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 16 }}>{body}</div>
        <div style={{ flex: isMobile ? '1 1 100%' : '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 16 }}>{side}</div>
      </div>
    </div>
  )
}
