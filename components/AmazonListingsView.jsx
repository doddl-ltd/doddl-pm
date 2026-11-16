import { useState } from 'react'
import { C } from './approvals/renderers/reviewKit'
import ListingsView from './ListingsView'
import RolloutView from './RolloutView'

// Studio › Amazon listings: Rollout (the master to every store, done when live; Jon 2026-11-16) and the live check
// (every listing against its master, field by field). The choice is remembered for the tab.
const TABS = [['rollout', 'Rollout'], ['live', 'Live check']]

export default function AmazonListingsView(props) {
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('hq-listings-tab') || 'rollout' } catch { return 'rollout' } })
  const go = (k) => { setTab(k); try { sessionStorage.setItem('hq-listings-tab', k) } catch { /* private window */ } }
  return (
    <div style={{ color: C.ink, fontFamily: "'Nunito', sans-serif" }}>
      <div role="tablist" aria-label="Amazon listings" style={{ display: 'flex', gap: 8, padding: props.isMobile ? '4px 4px 10px' : '4px 16px 12px' }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => go(k)} style={{ minHeight: 38, padding: '0 16px', borderRadius: 999, border: `1px solid ${tab === k ? C.indigo : C.border}`, background: tab === k ? C.indigo : '#fff', color: tab === k ? '#fff' : C.indigo, font: "800 13.5px 'Nunito', sans-serif", cursor: 'pointer' }}>{label}</button>
        ))}
      </div>
      {tab === 'rollout' ? <div style={{ padding: props.isMobile ? '0 4px 16px' : '0 16px 40px' }}><RolloutView isMobile={props.isMobile} /></div> : <ListingsView {...props} />}
    </div>
  )
}
