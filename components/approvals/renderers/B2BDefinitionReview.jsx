// b2b_definition (board B2BDefine): the campaign, who we want to talk to, where HQ looks, the contact rules,
// HQ's estimate and what happens next (fixed step labels). A single decision: the card frame owns the buttons.
import { C, Panel, H2, Lbl, Note, Checks, WhyBlock } from './reviewKit'
import { DefRow, Tags } from '../../b2b/kit'
import { DEFINE_GATES, ALWAYS_RULES, GOALS, COUNTRIES, goalName, offerName, channelName, areaText } from '../../../lib/b2b'

function Gate({ n, who, title, sub, first }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderTop: first ? 0 : '1px solid #F1EEF6', fontSize: 14, lineHeight: 1.4 }}>
      <span style={{ flex: 'none', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, background: who === 'you' ? C.indigo : C.soft, color: who === 'you' ? '#fff' : C.indigo }}>{n}</span>
      <span><b>{title}</b>{sub ? <><br /><span style={{ color: C.muted }}>{sub}</span></> : null}</span>
    </div>
  )
}

export default function B2BDefinitionReview({ task, artefact, isMobile }) {
  const a = artefact || {}
  const d = a.definition || {}
  const goal = a.goal || {}
  const market = a.market || {}
  const country = COUNTRIES[market.country]
  const est = a.estimate || null
  const approver = (task && Array.isArray(task.approvers) && task.approvers[0]) || (task && task.assigned_to) || 'the outreach approver'
  const measure = (GOALS.find(g => g.id === goal.id) || {}).measure
  const gateSubs = [
    `Approver: ${approver} (B2B, PR and creators)`,
    'With why each one matches and where it was found',
    'Your rejections tighten the rules before the full search',
    a.volume ? `Up to ${a.volume}` : '',
    'Including when a person steps in',
    'Sends start slowly and build up over 2 weeks',
  ]
  const lw = 110
  const field = (label, value) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <Lbl style={{ fontSize: 11 }}>{label}</Lbl>
      <span style={{ fontSize: 14, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{value || '–'}</span>
    </div>
  )
  const grid = { display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', gap: 14, marginTop: 12 }

  const left = (
    <>
      <Panel>
        <H2 style={{ margin: '0 0 4px' }}>The campaign</H2>
        <Note>What we want, and how we will know it worked.</Note>
        <div style={{ marginTop: 12 }}>{field('Goal', [goal.target || goalName(goal.id), goal.by].filter(Boolean).join(', '))}</div>
        <div style={grid}>
          {field('Market', [areaText(market), market.language].filter(Boolean).join(' · '))}
          {field('Channels', (a.channels || []).map(channelName).join(', '))}
          {field('What we offer them', (a.offers || []).map(offerName).join(', '))}
          {field('Measure', measure)}
          {field('How many to contact', a.volume)}
          {field('Sample to check first', a.sample_size)}
          {a.pace ? field('Pace once live', a.pace) : null}
          {a.people ? field('People', `${a.people.replies || '–'} answers replies; ${a.people.calls || '–'} takes calls and deals`) : null}
        </div>
      </Panel>

      <Panel>
        <H2 style={{ margin: '0 0 4px' }}>Who we want to talk to</H2>
        <Note>HQ scores every business it finds against this. Green must all be true, purple raise the score, red rule a business out.</Note>
        <div style={{ marginTop: 6 }}>
          <DefRow first isMobile={isMobile} labelWidth={lw} label="Business type">{d.line || d.own_words || '–'}</DefRow>
          {(d.kinds || []).length > 0 && <DefRow isMobile={isMobile} labelWidth={lw} label="Kinds"><Tags items={d.kinds.filter(k => k.on !== false).map(k => k.t)} /></DefRow>}
          <DefRow isMobile={isMobile} labelWidth={lw} label="Size">{d.size || '–'}</DefRow>
          <DefRow isMobile={isMobile} labelWidth={lw} label="Where">{areaText(market)}{country && !((market.regions || []).length || (market.places || []).length) ? ` (${country.whole})` : ''}</DefRow>
          <DefRow isMobile={isMobile} labelWidth={lw} label="Must have"><Tags kind="must" items={d.must} /></DefRow>
          <DefRow isMobile={isMobile} labelWidth={lw} label="Nice to have"><Tags kind="nice" items={d.nice} /></DefRow>
          <DefRow isMobile={isMobile} labelWidth={lw} label="Rule out"><Tags kind="not" items={[...(d.rule_out || []), ...(d.extra_rules || [])]} /></DefRow>
          <DefRow isMobile={isMobile} labelWidth={lw} label="Person to reach">{d.who_decides || '–'}</DefRow>
          {d.own_words && d.line ? <DefRow isMobile={isMobile} labelWidth={lw} label="In their words">{d.own_words}</DefRow> : null}
          {d.wants ? <DefRow isMobile={isMobile} labelWidth={lw} label="They want">{d.wants}</DefRow> : null}
        </div>
      </Panel>

      <Panel>
        <H2 style={{ margin: '0 0 4px' }}>Where HQ looks</H2>
        <Note>Public business sources only: company sites, public registers, trade-show lists and Google Maps. LinkedIn is never scraped. Every prospect shows where it came from.</Note>
        <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.5 }}>{d.sources || 'HQ suggests sources from the description.'}</p>
      </Panel>

      <Panel>
        <H2 style={{ margin: '0 0 4px' }}>Rules for contacting them</H2>
        {[...(a.country_rules || []), ...(d.contact_rules ? [d.contact_rules] : []), ...ALWAYS_RULES].map((r, i) => (
          <p key={i} style={{ margin: 0, padding: '8px 0', borderTop: i ? '1px solid #F1EEF6' : 0, fontSize: 14, lineHeight: 1.45 }}>{r}</p>
        ))}
      </Panel>
    </>
  )

  const right = (
    <>
      <Panel style={{ border: `2px solid ${C.indigo}` }}>
        <Lbl>HQ’s estimate</Lbl>
        {est && Object.keys(est).length ? (
          <>
            <p style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 800 }}>About {est.after_rules || est.match || est.found}</p>
            <Note>{[est.found ? `${est.found} in the sources` : null, est.match ? `${est.match} match the must-haves` : null, est.contact ? `${est.contact} with a contact we can use` : null].filter(Boolean).join('; ')}</Note>
          </>
        ) : <Note style={{ marginTop: 6 }}>Not estimated yet. HQ estimates how many there are once this is approved, before it looks for the sample.</Note>}
      </Panel>
      <Panel>
        <H2 style={{ margin: '0 0 4px' }}>What happens next, and who decides</H2>
        {DEFINE_GATES.map((g, i) => <Gate key={i} first={i === 0} n={i + 1} who={g.who} title={i === 1 && a.sample_size ? `${g.label} of ${a.sample_size}` : g.label} sub={gateSubs[i]} />)}
      </Panel>
      {(a.checks || []).length > 0 && <Panel><H2>Checks</H2><Checks checks={a.checks} /></Panel>}
      {(a.why || (a.evidence || []).length) ? <Panel><H2>Why</H2><WhyBlock why={a.why} evidence={a.evidence} expected={a.expected_effect} undo={a.undo} /></Panel> : null}
    </>
  )

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 12 : 20, alignItems: 'flex-start' }}>
      <div style={{ flex: isMobile ? '1 1 100%' : '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 16 }}>{left}</div>
      <div style={{ flex: isMobile ? '1 1 100%' : '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: isMobile ? 12 : 16 }}>{right}</div>
    </div>
  )
}

B2BDefinitionReview.approveLabel = () => 'Approve and find a sample'
