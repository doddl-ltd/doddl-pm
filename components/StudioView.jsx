// Creative studio (boards Studio / StudioPhone): every ad, video, post, email and listing HQ is making,
// on one board from brief to live. GET /api/studio. Cards with an approval open it via onOpenApproval.
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { C, TONE, Panel, H2, Lbl, Note, Chip, Pill, Pills, Ph, Table, StateLine, selectStyle, dueText } from './approvals/renderers/reviewKit'

export const TYPE_META = {
  ad: { label: 'Paid ad', plural: 'Paid ads', bg: C.soft, fg: C.indigo },
  video: { label: 'Ad video', plural: 'Ad videos', bg: C.warnBg, fg: C.warn },
  social: { label: 'Social', plural: 'Organic social', bg: C.okBg, fg: C.ok },
  email: { label: 'Email', plural: 'Email', bg: C.blueBg, fg: C.blue },
  listing: { label: 'Amazon listing', plural: 'Amazon listings', bg: C.plumBg, fg: C.plum },
  amazon_ads: { label: 'Amazon ads', plural: 'Amazon ads', bg: '#EEECF2', fg: C.body },
  website: { label: 'Website', plural: 'Website', bg: '#E4F4F1', fg: '#1C6B60' },
  outreach: { label: 'Outreach', plural: 'Outreach', bg: '#FFF1E0', fg: '#7A4A10' },
  recipe: { label: 'App recipe', plural: 'App recipes', bg: '#F3EFE2', fg: '#5E5220' },
}
const ALWAYS = ['ad', 'video', 'social', 'email', 'listing', 'amazon_ads']

const STAGES = [
  ['brief', 'Briefed', 'Brief agreed, nothing made yet'],
  ['make', 'Being made', 'Agent or editor working'],
  ['check', 'Checks', 'Brand, claims, rights, specs'],
  ['ready', 'Ready for you', 'On a review screen'],
  ['scheduled', 'Approved, scheduled', 'Will go live by itself'],
  ['live', 'Live, reporting', 'Results land on the card'],
]

// How each type is made, checked, approved and goes live (the studio's last table). Process copy, not data.
const TYPE_INFO = {
  ad: ['Paid Media agent writes copy; image from 14 Media or a new design', 'Brand voice, claims register, image rights, crops for every placement, landing page and price', 'Ad review', 'Built paused, switched on after your yes', 'On the card at 3, 7 and 14 days'],
  video: ['Creative agent writes the script and cut list; an editor cuts it', 'Hook in 2 seconds, captions, safe zones, music licence, model release for every child', 'Video review', 'Into the Meta and TikTok libraries, then used by ads', 'Hook rate and hold rate per ad'],
  social: ['Social agent, weekly pack', 'Brand voice, claims, pillar balance, image rights', 'Social week pack', 'Scheduled in the social scheduler', 'Reach and saves in Monday’s note'],
  email: ['CRM agent builds a draft in Klaviyo', 'Brand, claims, every link and UTM, discount code live, inbox and dark-mode render', 'Email review', 'Scheduled in Klaviyo after your yes', 'Opens, clicks, revenue at 24 and 72 hours'],
  listing: ['Listing agent from the product fact sheet', 'Amazon style rules, character and byte limits, claims, brand', 'Live vs should be live', 'Sent through the Amazon listings API', 'Live check 24 hours later, then daily'],
  amazon_ads: ['Amazon Ads agent', 'Amazon ad policy, store page, image rights', 'Amazon ads pack', 'Submitted to Amazon', 'Weekly Amazon ads pack'],
  website: ['Website agent on the preview theme', 'Brand, links, mobile layout', 'Approval card with preview link', 'Published in Shopify after your yes', 'UX report'],
  outreach: ['Outreach agent', 'Tone of voice, who it goes to', 'Outreach pack', 'Sent by the agent after the tick', 'Replies in the weekly note'],
  recipe: ['Recipe agent', 'Feeding reviewer, age stage, allergens', 'Approval card', 'Published in the doddl app', 'Saves and cooks in the app'],
}

const BATCH = { single: 'one at a time', off: 'one at a time', weekly: 'weekly pack', daily: 'daily pack', monthly: 'monthly', pack: 'as a pack' }

function whoText(r) {
  if (!r || !r.label) return 'Not set'
  const main = r.approver || 'Not set'
  return [r.second_approver ? `${main}, then ${r.second_approver}` : main, r.backup ? `backup ${r.backup}` : ''].filter(Boolean).join(' · ')
}

function statusOf(i) {
  if (i.status_text) return [i.status_text, TONE[i.status_tone] || C.muted]
  if (i.approval && i.approval.due_at) {
    const t = dueText(i.approval.due_at)
    return [t, /overdue/.test(t) ? C.bad : C.ok]
  }
  if (i.stuck) return ['Stuck', C.bad]
  return ['', C.muted]
}

function Card({ i, isMobile, onOpen }) {
  const m = TYPE_META[i.type] || { label: i.type, bg: C.grey, fg: C.body }
  const [status, col] = statusOf(i)
  const who = i.stage === 'ready' && i.approver ? `Approver ${i.approver}` : (i.owner || i.channel || '')
  const markets = (i.markets || []).join(' · ')
  const clickable = !!(i.approval_task_id && onOpen)
  const body = (
    <>
      <Ph url={i.thumb_url} alt="" style={isMobile ? { width: 64, height: 72, flex: 'none', borderRadius: 8, fontSize: 10 } : { height: i.type === 'video' ? 96 : 74, borderRadius: 8, fontSize: 11 }}>{i.format || m.label}</Ph>
      <span style={{ display: 'block', minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: isMobile ? 0 : 8 }}>
          <Chip bg={m.bg} fg={m.fg}>{m.label}</Chip>
          {markets ? <Chip bg={C.grey} fg={C.body}>{markets}</Chip> : null}
        </span>
        <span style={{ display: 'block', margin: '6px 0 2px', fontSize: isMobile ? 15 : 14, fontWeight: 800, lineHeight: 1.3 }}>{i.title}</span>
        {who ? <span style={{ display: 'block', fontSize: isMobile ? 13 : 12, color: C.muted }}>{who}</span> : null}
        {status ? <span style={{ display: 'block', marginTop: 4, fontSize: isMobile ? 13 : 12, fontWeight: 800, color: col }}>{status}</span> : null}
      </span>
    </>
  )
  const style = { display: isMobile ? 'flex' : 'block', gap: 10, width: '100%', background: '#fff', border: `1px solid ${i.stuck ? '#E3B9B9' : C.line}`, borderRadius: 12, padding: 10, textAlign: 'left', font: 'inherit', color: C.ink, boxSizing: 'border-box' }
  return clickable
    ? <button type="button" onClick={() => onOpen(i.approval_task_id)} aria-label={`Open the approval: ${i.title}`} style={{ ...style, cursor: 'pointer' }}>{body}</button>
    : <div style={style}>{body}</div>
}

export default function StudioView({ user, isMobile, onOpenApproval }) {
  const [data, setData] = useState(null)
  const [drift, setDrift] = useState(null)
  const [error, setError] = useState('')
  const [type, setType] = useState('all')
  const [market, setMarket] = useState('all')
  const [approver, setApprover] = useState('all')
  const [stage, setStage] = useState('ready')

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const r = await apiFetch('/api/studio')
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || `Could not load the studio (${r.status})`)
        if (live) setData(j)
      } catch (e) { if (live) setError(e.message) }
      try {
        const r = await apiFetch('/api/listings')
        if (r.ok) { const j = await r.json(); if (live) setDrift(j.counts ? j.counts.drift : null) }
      } catch (_) { /* tile shows a dash */ }
    })()
    return () => { live = false }
  }, [])

  const items = (data && data.items) || []
  const markets = useMemo(() => [...new Set(items.flatMap(i => i.markets || []))].sort(), [items])
  const approvers = useMemo(() => [...new Set(items.map(i => i.approver).filter(Boolean))].sort(), [items])
  const filtered = items.filter(i => (type === 'all' || i.type === type) && (market === 'all' || (i.markets || []).includes(market)) && (approver === 'all' || i.approver === approver))
  const counts = (data && data.counts) || {}
  const types = Object.keys(TYPE_META).filter(t => ALWAYS.includes(t) || counts[t])

  const ready = items.filter(i => i.stage === 'ready')
  const readyBreak = Object.entries(ready.reduce((m, i) => ({ ...m, [i.type]: (m[i.type] || 0) + 1 }), {}))
    .map(([t, n]) => `${n} ${(TYPE_META[t] ? TYPE_META[t].label : t).toLowerCase().replace('amazon', 'Amazon')}${n === 1 ? '' : 's'}`).join(', ')
  const weekAhead = Date.now() + 7 * 86400_000
  const goingLive = items.filter(i => i.stage === 'scheduled' && (!i.scheduled_at || new Date(i.scheduled_at).getTime() <= weekAhead)).length
  const tiles = [
    ['Ready for you', ready.length, C.indigo, readyBreak || 'Nothing waiting'],
    ['Stuck', (data && data.stuck || []).length, C.bad, 'Longer than its stage allows'],
    ['Going live this week', goingLive, C.ink, 'Approved and scheduled'],
    ['Live, reporting', items.filter(i => i.stage === 'live').length, C.ink, 'Results land on the card'],
    ['Listings drifting', drift == null ? '–' : drift, C.warn, 'Live is not what should be live'],
  ]

  const filters = (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} role="group" aria-label="Filter by type">
        <Pill on={type === 'all'} onClick={() => setType('all')} style={{ minHeight: 40 }}>Everything <span style={{ opacity: 0.75 }}>{items.length}</span></Pill>
        {types.map(t => <Pill key={t} on={type === t} onClick={() => setType(t)} style={{ minHeight: 40 }}>{TYPE_META[t].plural} <span style={{ opacity: 0.75 }}>{counts[t] || 0}</span></Pill>)}
      </div>
    </>
  )
  const selects = (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 14 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>Market
        <select value={market} onChange={e => setMarket(e.target.value)} style={{ ...selectStyle, width: 'auto', fontSize: 14, borderRadius: 10, padding: '0 10px' }}>
          <option value="all">All markets</option>{markets.map(m => <option key={m}>{m}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>Approver
        <select value={approver} onChange={e => setApprover(e.target.value)} style={{ ...selectStyle, width: 'auto', fontSize: 14, borderRadius: 10, padding: '0 10px' }}>
          <option value="all">Anyone</option>{approvers.map(m => <option key={m}>{m}</option>)}
        </select>
      </label>
    </div>
  )

  const stuck = (data && data.stuck) || []
  const stuckPanel = (
    <Panel pad={isMobile ? '14px' : undefined} style={{ marginTop: isMobile ? 0 : 26 }}>
      <H2 style={{ fontSize: isMobile ? 17 : 18 }}>Stuck{isMobile ? '' : ': longer than the stage allows'}</H2>
      {stuck.length ? stuck.map(i => {
        const over = Math.max(0, (i.hours_in_stage || 0) - (Number(i.stage_sla_hours) || 0))
        const chip = i.hours_in_stage >= 48 ? `Waiting ${Math.round(i.hours_in_stage / 24)} days` : `${over}h over`
        return (
          <div key={i.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 14, lineHeight: 1.45, marginTop: 10 }}>
            <Chip bg={C.badBg} fg={C.bad}>{chip}</Chip>
            {i.approval_task_id && onOpenApproval
              ? <button type="button" onClick={() => onOpenApproval(i.approval_task_id)} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 800, color: C.indigo, cursor: 'pointer', textDecoration: 'underline', minHeight: 32 }}>{i.title}</button>
              : <b>{i.title}</b>}
            <span style={{ color: C.muted }}>{[(STAGES.find(s => s[0] === i.stage) || [])[1], i.status_text].filter(Boolean).join(' · ')}</span>
          </div>
        )
      }) : <Note>Nothing is stuck.</Note>}
    </Panel>
  )

  const where = ((data && data.approved_where) || []).filter(r => ALWAYS.includes(r.type) || counts[r.type])
  const wherePanel = isMobile ? (
    <Panel pad="14px">
      <H2>Where each type is approved</H2>
      {where.map((r, i) => (
        <div key={r.type} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', minHeight: 48, borderTop: i ? '1px solid #F1EEF6' : 0, fontSize: 14, padding: '6px 0' }}>
          <span><b>{(TYPE_META[r.type] || {}).plural || r.type}</b><br /><span style={{ fontSize: 13, color: C.muted }}>{whoText(r)}{r.batch_mode ? ` · ${BATCH[r.batch_mode] || r.batch_mode}` : ''}</span></span>
          <span style={{ fontSize: 13, color: C.muted, textAlign: 'right' }}>{(TYPE_INFO[r.type] || [])[2]}</span>
        </div>
      ))}
    </Panel>
  ) : (
    <section style={{ marginTop: 26 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Where each type is made, checked and approved</h2>
      <Note style={{ margin: '4px 0 12px', fontSize: 14 }}>Nothing goes live without a yes on its review screen. Agents never publish straight to a channel.</Note>
      <Panel pad="0" style={{ overflow: 'hidden' }}>
        <Table minWidth={1080} head={['Type', 'Made by', 'Checked before you see it', 'You approve on', 'Approver · backup', 'Goes live by', 'Results come back']}
          rows={where.map(r => { const t = TYPE_INFO[r.type] || []; return [(TYPE_META[r.type] || {}).plural || r.type, t[0] || '', t[1] || '', <span style={{ fontWeight: 800, color: C.indigo }}>{t[2] || r.label || ''}</span>, `${whoText(r)}${r.batch_mode ? ` · ${BATCH[r.batch_mode] || r.batch_mode}` : ''}`, t[3] || '', t[4] || ''] })} />
      </Panel>
    </section>
  )

  const loadState = <StateLine loading={!data && !error} error={error} />

  if (isMobile) {
    const def = STAGES.find(s => s[0] === stage)
    const cards = filtered.filter(i => i.stage === stage)
    return (
      <div style={{ padding: '4px 4px 16px', display: 'flex', flexDirection: 'column', gap: 14, color: C.ink, fontFamily: "'Nunito', sans-serif" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Creative studio</h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: C.muted }}>Every ad, video, post, email and listing, from brief to results.</p>
        </div>
        {loadState}
        {data ? (<>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {[tiles[0], tiles[1], tiles[2], tiles[4]].map(([k, n, col]) => (
              <div key={k} style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px' }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: C.muted, textTransform: 'uppercase' }}>{k}</p>
                <p style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800, color: col }}>{n}</p>
              </div>
            ))}
          </div>
          <label style={{ fontSize: 13, fontWeight: 800 }}>Type
            <select value={type} onChange={e => setType(e.target.value)} style={{ ...selectStyle, marginTop: 6, minHeight: 44, fontSize: 16 }}>
              <option value="all">Everything</option>{types.map(t => <option key={t} value={t}>{TYPE_META[t].plural}</option>)}
            </select>
          </label>
          {markets.length > 1 || approvers.length > 1 ? selects : null}
          <Pills label="Stage">{STAGES.map(s => <Pill key={s[0]} on={stage === s[0]} onClick={() => setStage(s[0])}>{s[1]} {filtered.filter(i => i.stage === s[0]).length}</Pill>)}</Pills>
          <Note style={{ marginTop: -6 }}>{def ? def[2] : ''}</Note>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cards.length ? cards.map(i => <Card key={i.id} i={i} isMobile onOpen={onOpenApproval} />) : <Note style={{ fontSize: 14 }}>Nothing of this type at this stage.</Note>}
          </div>
          {stuckPanel}
          {wherePanel}
        </>) : null}
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 16px 40px', color: C.ink, fontFamily: "'Nunito', sans-serif" }}>
      <div>
        <Lbl style={{ margin: '0 0 6px' }}>Every ad, video, post, email and listing HQ is making</Lbl>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: '-0.01em' }}>Creative studio</h1>
        <p style={{ margin: '6px 0 0', color: C.muted, fontSize: 15, maxWidth: 760 }}>One board from brief to results. Cards waiting on a decision open their review screen, with a real preview of how it will look where it runs.</p>
      </div>
      {loadState}
      {data ? (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginTop: 22 }}>
          {tiles.map(([k, n, col, sub]) => (
            <Panel key={k} pad="14px 16px">
              <Lbl>{k}</Lbl>
              <p style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 800, color: col }}>{n}</p>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: C.muted }}>{sub}</p>
            </Panel>
          ))}
        </div>
        <div style={{ marginTop: 24 }}>{filters}</div>
        <div style={{ marginTop: 12 }}>{selects}</div>
        <div className="scroll-x" style={{ marginTop: 16, paddingBottom: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(214px, 1fr))', gap: 12, minWidth: 1340 }}>
            {STAGES.map(([k, name, sub]) => {
              const cards = filtered.filter(i => i.stage === k)
              return (
                <section key={k} aria-label={name} style={{ background: '#EFECF5', borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{name}</h2><Chip bg="#fff">{cards.length}</Chip></div>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted }}>{sub}</p>
                  </div>
                  {cards.map(i => <Card key={i.id} i={i} onOpen={onOpenApproval} />)}
                </section>
              )
            })}
          </div>
        </div>
        {stuckPanel}
        {wherePanel}
      </>) : null}
    </div>
  )
}
