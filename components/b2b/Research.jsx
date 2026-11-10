// What HQ found for each business, on the campaign page (Jon, 2026-11-10: "I want this on the PM tool"):
// the website, what the business's own page says, the criteria HQ checked, the pages it read, and a summary of
// the last sample search. HQ holds no names, e-mails or phone numbers of people, so none are shown.
import { C, Panel, H2, Note, fmtWhen } from '../approvals/renderers/reviewKit'

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u || '' } }
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : null)

// Names that are page text rather than the business name (the sample before HQ read pages with the model).
export function nameLooksWrong(name) {
  return /copyright|rights reserved|html|\.jpe?g|\.png|ofsted|hygiene|\[name\]|limited,$|^\W*\w{1,4}\W*$|\b(19|20)\d{2}\b/i.test(String(name || ''))
}

export function WebsiteLink({ p }) {
  const url = safeUrl(p.details && p.details.website)
  if (!url) return null
  return <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: C.indigo, fontSize: 12.5, overflowWrap: 'anywhere' }}>{hostOf(url)}</a>
}

export function ResearchPanel({ p, isMobile }) {
  const d = p.details || {}
  const facts = [
    d.setting_type && ['Setting', String(d.setting_type).replace(/_/g, ' ')],
    d.kind && ['Kind', d.kind],
    d.size_signal && ['Size', d.size_signal],
    d.rating && ['Ofsted', d.rating],
    d.ages_served && ['Ages', d.ages_served],
    ['Entity', d.entity_type && d.entity_type !== 'unknown' ? d.entity_type : 'not shown on the page'],
    d.franchise && ['Franchise', d.franchise],
    d.legal_name && ['Legal name', d.legal_name],
  ].filter(Boolean)
  const says = d.page_says || d.evidence_quote || null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 10 : 24, padding: isMobile ? '10px 0 4px' : '6px 4px 8px', fontSize: 13.5, lineHeight: 1.5 }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        {nameLooksWrong(p.name) && <p style={{ margin: '0 0 8px', background: C.warnBg, color: C.warn, borderRadius: 8, padding: '6px 10px', fontSize: 13 }}>This name is text from the page, not the business name. The website shows which nursery it is.</p>}
        <p style={{ margin: '0 0 6px', color: C.muted }}>Website: <WebsiteLink p={p} /></p>
        {says
          ? <p style={{ margin: '0 0 8px' }}><span style={{ color: C.muted }}>The page says: </span>{says}</p>
          : <p style={{ margin: '0 0 8px', color: C.muted }}>No page summary was saved for this business.</p>}
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', margin: 0 }}>
          {facts.map(([k, v]) => [<dt key={`${k}-k`} style={{ color: C.muted }}>{k}</dt>, <dd key={`${k}-v`} style={{ margin: 0, overflowWrap: 'anywhere' }}>{v}</dd>])}
        </dl>
      </div>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <p style={{ margin: '0 0 4px', color: C.muted }}>Criteria HQ checked</p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {(p.match || []).map((m, i) => (
            <li key={i} style={{ display: 'flex', gap: 8 }}>
              <span aria-hidden="true" style={{ color: m.ok === false ? C.bad : C.ok, fontWeight: 800 }}>{m.ok === false ? '✗' : '✓'}</span>
              <span>{m.t}<span style={{ position: 'absolute', left: -9999 }}>{m.ok === false ? ' (not seen)' : ' (seen)'}</span></span>
            </li>
          ))}
          {!(p.match || []).length && <li style={{ color: C.muted }}>None recorded.</li>}
        </ul>
        {(p.sources || []).length > 0 && (
          <p style={{ margin: '8px 0 0', color: C.muted }}>Pages read: {(p.sources || []).map((s, i) => {
            const u = safeUrl(s.url)
            return <span key={i}>{i ? ' · ' : ''}{u ? <a href={u} target="_blank" rel="noopener noreferrer" style={{ color: C.indigo, overflowWrap: 'anywhere' }}>{s.label || hostOf(u)}</a> : (s.label || 'source')}</span>
          })}</p>
        )}
      </div>
    </div>
  )
}

export function ResearchSummary({ research, isMobile }) {
  if (!research) return null
  const looked = research.in_sample != null && research.excluded_count != null ? research.in_sample + research.excluded_count : null
  const why = research.excluded_note ? research.excluded_note.replace(/^Area:[^.]*\.\s*/, '').replace(/^\d+ left out:\s*/, '') : null
  const tiles = [
    looked != null && ['Checked closely', looked],
    research.in_sample != null && ['In the sample', research.in_sample],
    research.excluded_count != null && ['Left out', research.excluded_count],
  ].filter(Boolean)
  return (
    <Panel pad={isMobile ? '14px' : '18px 20px'}>
      <H2>What HQ searched</H2>
      <Note style={{ marginTop: 0 }}>{research.searched_at ? `Last sample search ${fmtWhen(research.searched_at)}. ` : ''}HQ searched the web for businesses in the campaign's area, read each one's own website and checked it against the definition. Open "Research" on any business below to see what it found.</Note>
      {tiles.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))`, gap: 8, marginTop: 10 }}>
          {tiles.map(([l, v]) => (
            <div key={l} style={{ background: C.bg, borderRadius: 10, padding: '8px 12px' }}>
              <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{l}</div>
            </div>
          ))}
        </div>
      )}
      {why && <p style={{ margin: '10px 0 0', fontSize: 13.5 }}><b>Why some were left out:</b> {why}</p>}
    </Panel>
  )
}
