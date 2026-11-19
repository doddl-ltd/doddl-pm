import { useState } from 'react'
import { C } from './approvals/renderers/reviewKit'
import ListingsView from './ListingsView'
import RolloutView from './RolloutView'
import FamiliesView from './families/FamiliesView'
import { RankAll, EvidenceAll } from './families/AmazonAllViews'

// The Amazon section of doddlHQ (Jon 2026-11-19, mock-up canvas FG5HEBiCApe1HCyNyhifRH). The section's tabs in the
// rail pick the page: Listings (families), Clean-up, Rank & reviews, Evidence, and Classic (the earlier per-ASIN
// screens: rollout and the live check, kept until Jon says to remove them). Nothing here sends to Amazon by itself.
const CLASSIC = [['rollout', 'Rollout'], ['live', 'Live check']]

export default function AmazonListingsView({ tab = 'families', setTab, ...props }) {
  const [classic, setClassic] = useState(() => { try { const t = sessionStorage.getItem('hq-listings-classic'); return CLASSIC.some(x => x[0] === t) ? t : 'rollout' } catch { return 'rollout' } })
  const [target, setTarget] = useState(null)
  const goClassic = (k) => { setClassic(k); try { sessionStorage.setItem('hq-listings-classic', k) } catch { /* private window */ } }
  const pad = props.isMobile ? '0 4px 16px' : '0 16px 40px'
  if (tab === 'cleanup') return <FamiliesView key="cleanup" mode="cleanup" isMobile={props.isMobile} onOpenApproval={props.onOpenApproval} />
  if (tab === 'rank') return <RankAll isMobile={props.isMobile} />
  if (tab === 'evidence') return <EvidenceAll isMobile={props.isMobile} />
  if (tab === 'classic') {
    return (
      <div style={{ color: C.ink, fontFamily: "'Nunito', sans-serif" }}>
        <div role="tablist" aria-label="Classic listing screens" style={{ display: 'flex', gap: 8, padding: props.isMobile ? '4px 4px 10px' : '4px 16px 12px', flexWrap: 'wrap', alignItems: 'center' }}>
          {CLASSIC.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={classic === k} onClick={() => goClassic(k)} style={{ minHeight: 38, padding: '0 16px', borderRadius: 999, border: `1px solid ${classic === k ? C.indigo : C.border}`, background: classic === k ? C.indigo : '#fff', color: classic === k ? '#fff' : C.indigo, font: "800 13px 'Nunito', sans-serif", cursor: 'pointer' }}>{label}</button>
          ))}
          <span style={{ fontSize: 12.5, color: C.muted }}>The earlier per-ASIN screens, kept until the family screens cover everything.</span>
        </div>
        {classic === 'rollout'
          ? <div style={{ padding: pad }}><RolloutView isMobile={props.isMobile} onOpenMaster={(asin) => { setTarget({ asin, n: Date.now() }); goClassic('live') }} /></div>
          : <ListingsView {...props} openMaster={target} />}
      </div>
    )
  }
  return <FamiliesView key="list" mode="list" isMobile={props.isMobile} onOpenApproval={props.onOpenApproval} onCleanup={setTab ? () => setTab('cleanup') : null} />
}
