import { useState } from 'react'
import { C } from './approvals/renderers/reviewKit'
import ListingsView from './ListingsView'
import RolloutView from './RolloutView'
import FamiliesView from './families/FamiliesView'

// Studio › Amazon listings. By family (Jon 2026-11-19: "build everything & replace what we had"): every family, its
// master, colours, images, A+, countries, rank + reviews, evidence, and the clean-up list. The earlier screens (Rollout
// and the live check per ASIN) stay reachable under Classic until Jon says to remove them.
const TABS = [['families', 'Families'], ['rollout', 'Classic: rollout'], ['live', 'Classic: live check']]

export default function AmazonListingsView(props) {
  const [tab, setTab] = useState(() => { try { const t = sessionStorage.getItem('hq-listings-tab2'); return TABS.some(x => x[0] === t) ? t : 'families' } catch { return 'families' } })
  const [target, setTarget] = useState(null)
  const go = (k) => { setTab(k); try { sessionStorage.setItem('hq-listings-tab2', k) } catch { /* private window */ } }
  return (
    <div style={{ color: C.ink, fontFamily: "'Nunito', sans-serif" }}>
      <div role="tablist" aria-label="Amazon listings" style={{ display: 'flex', gap: 8, padding: props.isMobile ? '4px 4px 10px' : '4px 16px 12px', flexWrap: 'wrap' }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => go(k)} style={{ minHeight: 38, padding: '0 16px', borderRadius: 999, border: `1px solid ${tab === k ? C.indigo : C.border}`, background: tab === k ? C.indigo : '#fff', color: tab === k ? '#fff' : C.indigo, font: `800 ${k === 'families' ? 13.5 : 12.5}px 'Nunito', sans-serif`, cursor: 'pointer', opacity: k === 'families' || tab === k ? 1 : 0.8 }}>{label}</button>
        ))}
      </div>
      {tab === 'families' ? <FamiliesView isMobile={props.isMobile} onOpenApproval={props.onOpenApproval} />
        : tab === 'rollout' ? <div style={{ padding: props.isMobile ? '0 4px 16px' : '0 16px 40px' }}><RolloutView isMobile={props.isMobile} onOpenMaster={(asin) => { setTarget({ asin, n: Date.now() }); go('live') }} /></div>
        : <ListingsView {...props} openMaster={target} />}
    </div>
  )
}
