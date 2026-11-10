// Campaigns list (board B2BCampaigns): tiles, campaign rows with the 7-step track and figures, templates that
// open Create with that business type chosen. GET /api/b2b/campaigns.
import { useEffect, useState } from 'react'
import { C, Panel, H2, Note, Chip, Btn, StateLine } from '../approvals/renderers/reviewKit'
import { NextChip, Track, Nums, Tile, font } from './kit'
import { countryName, areaText, channelName, goalName } from '../../lib/b2b'

function chipsFor(c) {
  const out = []
  if (c.business_type) out.push(c.business_type.name.split(' and ')[0])
  if (c.market && c.market.country) out.push(((c.market.regions || []).length || (c.market.places || []).length) ? areaText(c.market) : countryName(c.market.country))
  if (c.channels && c.channels.length) out.push(c.channels.length > 1 ? `${channelName(c.channels[0]).split(' ')[0]} and ${c.channels.length - 1} more` : channelName(c.channels[0]).split(' ')[0])
  return out
}

function goalLine(c) {
  const g = c.goal || {}
  if (!g.id) return 'Goal not set yet'
  return `Goal: ${[g.target || goalName(g.id), g.by].filter(Boolean).join(', ')}`
}

export default function CampaignsList({ isMobile, fetcher, onNew, onOpen, onReport }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    fetcher('/api/b2b/campaigns').then(d => { if (live) setData(d) }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [fetcher])

  const t = (data && data.tiles) || {}
  const camps = (data && data.campaigns) || []
  const templates = ((data && data.templates) || []).filter(x => x.slug !== 'something_else')

  return (
    <div style={{ fontFamily: font, color: C.ink, maxWidth: 1240 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0, flex: '1 1 420px' }}>
          <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted, margin: '0 0 6px' }}>B2B, partnerships and outreach</p>
          <h1 style={{ margin: 0, fontSize: isMobile ? 24 : 30, fontWeight: 800, letterSpacing: '-0.01em' }}>B2B campaigns</h1>
          <p style={{ margin: '6px 0 0', color: C.muted, fontSize: isMobile ? 14 : 15, maxWidth: 780, lineHeight: 1.5 }}>
            Each campaign is one kind of business, in one place, for one goal. You define who; HQ finds a sample for you to check; you approve the words and the flow; people step in when someone replies.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: isMobile ? '100%' : 'auto' }}>
          {onReport && <Btn onClick={onReport} style={isMobile ? { flex: '1 1 0' } : undefined}>Outreach report</Btn>}
          <Btn primary onClick={() => onNew(null)} style={isMobile ? { flex: '1 1 0' } : undefined}>New campaign</Btn>
        </div>
      </div>

      <StateLine loading={!data && !error} error={error} />

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 12, marginTop: 22 }}>
            <Tile label="Waiting for you" value={t.waiting_for_you || 0} color={C.indigo} note={t.waiting_note} />
            <Tile label="Replies for a person" value={t.replies_for_person || 0} color={C.warn} note="Answer within 1 working day" />
            <Tile label="Meetings booked" value={t.meetings || 0} note="Across live campaigns" />
            <Tile label="Live campaigns" value={t.live || 0} note={`${t.setup || 0} in set-up`} />
          </div>

          <Panel pad="0" style={{ marginTop: 22 }}>
            <div style={{ padding: '16px 20px 4px' }}><H2 style={{ margin: 0, fontSize: 18 }}>Campaigns</H2></div>
            {!camps.length && <Note style={{ padding: '8px 20px 20px' }}>No campaigns yet. Start one with New campaign, or from a template below.</Note>}
            {camps.map(c => (
              <button key={c.id} type="button" onClick={() => onOpen(c)} aria-label={`Open ${c.name || 'campaign'}`}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: 0, borderTop: `1px solid ${C.line2}`, padding: isMobile ? '14px 14px' : '18px 20px', cursor: 'pointer', font: 'inherit', color: C.ink }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: '1 1 300px' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{chipsFor(c).map((x, i) => <Chip key={i}>{x}</Chip>)}</div>
                    <p style={{ margin: '6px 0 0', fontSize: 17, fontWeight: 800, overflowWrap: 'anywhere' }}>{c.name || 'Untitled draft'}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 13, color: C.muted }}>{goalLine(c)}</p>
                  </div>
                  <NextChip next={c.next} />
                </div>
                <Track steps={c.track} isMobile={isMobile} />
                <Nums nums={c.nums} isMobile={isMobile} />
              </button>
            ))}
          </Panel>

          <section style={{ marginTop: 26 }}>
            <H2 style={{ margin: '0 0 4px', fontSize: 18 }}>Start from a template</H2>
            <Note style={{ margin: '0 0 12px', fontSize: 14 }}>Each template fills in the business definition and the sources HQ searches. Change anything.</Note>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
              {templates.map(x => (
                <button key={x.id} type="button" onClick={() => onNew(x.id)}
                  style={{ textAlign: 'left', background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, cursor: 'pointer', font: 'inherit', color: C.ink, minHeight: 44 }}>
                  <b style={{ fontSize: 15 }}>{x.name}</b>
                  <p style={{ margin: '6px 0 0', fontSize: 13, color: C.muted, lineHeight: 1.4 }}>{x.description}</p>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
