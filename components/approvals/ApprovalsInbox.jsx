// Approvals inbox (boards Main, InboxPhone): tiles, the three tabs, "Waiting for me" grouped by area.
import { C } from '../../lib/approvalsUi'
import { dueChip, outcomeChip, fmtWhen, fmtToday, groupMine, rowFlags, ruleNote, typeLabel, whoText } from '../../lib/approvalsUi'
import { Chip, Due, Panel, Lbl, Btn, Segmented, Quiet, font } from './ui'

const COLS = 'minmax(0,1fr) 170px 150px 190px 20px'

function Tile({ label, value, color, note }) {
  return (
    <Panel style={{ padding: '14px 16px' }}>
      <Lbl>{label}</Lbl>
      {value != null && <p style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 800, color: color || C.ink }}>{value}</p>}
      <p style={{ margin: value != null ? '2px 0 0' : '6px 0 0', fontSize: 13, color: value != null ? C.muted : C.ink, lineHeight: 1.5 }}>{note}</p>
    </Panel>
  )
}

function Count({ n }) {
  return <span style={{ background: C.tint, color: C.indigo, borderRadius: 999, fontSize: 12, padding: '0 8px' }}>{n}</span>
}

function changeLine(row, me) {
  const bits = [typeLabel(row.artefact_type)]
  if (row.escalated_to_me && row.approvers?.[0]) bits.push(`${row.approvers[0]} has not answered in 48 hours. You are the backup.`)
  else if (Array.isArray(row.approvers) && row.approvers.length > 1) bits.push(`Approvers: ${whoText(row.approvers, me)}`)
  return bits.join(' · ')
}

function Row({ cells, onClick, label }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '14px 18px', borderWidth: '1px 0 0', borderStyle: 'solid', borderColor: C.line2, width: '100%', textAlign: 'left', background: 'none', cursor: 'pointer', font: `600 14px ${font}`, color: C.ink }}
      onMouseEnter={e => { e.currentTarget.style.background = '#FAF8FD' }} onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
      {cells}
      <span aria-hidden="true" style={{ color: C.faint, fontSize: 20 }}>›</span>
    </button>
  )
}

function Table({ head, children }) {
  return (
    <Panel style={{ padding: 0, overflowX: 'auto' }}>
      <div style={{ minWidth: 860 }}>
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '10px 18px' }}>
          {head.map((h, i) => <Lbl key={i} as="span">{h}</Lbl>)}
        </div>
        {children}
      </div>
    </Panel>
  )
}

function TitleCell({ title, chips, sub }) {
  return (
    <span style={{ minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 15 }}>{title}</span>
        {chips.map(c => <Chip key={c}>{c}</Chip>)}
      </span>
      {sub && <span style={{ display: 'block', marginTop: 4, fontSize: 13, color: C.muted }}>{sub}</span>}
    </span>
  )
}

function PhoneCard({ onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, color: C.ink, font: `600 14px ${font}`, cursor: 'pointer' }}>
      {children}
    </button>
  )
}

export default function ApprovalsInbox({ data, loading, error, isMobile, userName, tab, setTab, onOpen, onNavigate, now = new Date() }) {
  const tiles = data?.tiles || { waiting: 0, overdue: 0, due_today: 0, escalated: 0 }
  const mine = data?.mine || []
  const others = data?.others || []
  const decided = data?.decided || []
  const rules = data?.rules || []
  const groups = groupMine(mine, rules)
  const order = groups.flatMap(g => g.items.map(r => r.id))
  const open = (id) => onOpen(id, order.indexOf(id), order.length)
  const areaOf = (r) => r.area_label || (rules.find(x => x.area === r.approval_area)?.label) || typeLabel(r.artefact_type)

  const body = loading && !data ? <Quiet>Loading approvals…</Quiet>
    : error && !data ? <Quiet>Could not load approvals: {error}</Quiet>
    : null

  if (isMobile) {
    return (
      <div style={{ color: C.ink, fontFamily: font, margin: '-12px -12px 0', background: C.bg, minHeight: '70vh' }}>
        <div style={{ padding: '18px 16px 8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>Approvals</h1>
            <button type="button" onClick={() => onNavigate('approvers')} style={{ background: 'none', border: 0, color: C.indigo, font: `700 13px ${font}`, minHeight: 44, cursor: 'pointer' }}>Who approves what</button>
          </div>
          <p style={{ margin: '4px 0 0', color: C.muted, fontSize: 14 }}>{tiles.waiting} waiting for you · oldest first</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {tiles.overdue > 0 && <Due small chip={{ text: `${tiles.overdue} overdue`, tone: 'bad' }} />}
            {tiles.due_today > 0 && <Due small chip={{ text: `${tiles.due_today} due today`, tone: 'warn' }} />}
            {tiles.escalated > 0 && <Chip>{tiles.escalated} escalated to you</Chip>}
          </div>
          <div style={{ marginTop: 14 }}>
            <Segmented stretch value={tab} onChange={setTab} items={[{ key: 'mine', label: 'For me' }, { key: 'others', label: 'On others' }, { key: 'decided', label: 'Decided' }]} />
          </div>
        </div>
        {body ? <div style={{ padding: '0 16px' }}>{body}</div> : (
          <div style={{ padding: '8px 16px 24px', display: 'flex', flexDirection: 'column', gap: tab === 'mine' ? 18 : 10 }}>
            {tab === 'mine' && (groups.length ? groups.map(g => (
              <section key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Lbl as="h2" style={{ color: g.escalated ? '#A12B2B' : C.muted }}>{g.area}</Lbl>
                  <Chip>{g.items.length}</Chip>
                </div>
                {g.items.map(r => (
                  <PhoneCard key={r.id} onClick={() => open(r.id)}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.3 }}>{r.title}</span>
                      <span aria-hidden="true" style={{ color: C.faint, fontSize: 20, lineHeight: 1 }}>›</span>
                    </span>
                    <span style={{ display: 'block', marginTop: 4, fontSize: 13, color: C.muted }}>{changeLine(r, userName)}</span>
                    <span style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Due small chip={dueChip(r, now)} />
                      {rowFlags(r, userName).map(f => <Chip key={f}>{f}</Chip>)}
                      <span style={{ fontSize: 12, color: C.muted }}>{r.agent_id || ''}</span>
                    </span>
                  </PhoneCard>
                ))}
              </section>
            )) : <EmptyMine />)}
            {tab === 'others' && (others.length ? others.map(r => (
              <PhoneCard key={r.id} onClick={() => onOpen(r.id)}>
                <span style={{ fontWeight: 800, fontSize: 15 }}>{r.title}</span>
                <span style={{ display: 'block', marginTop: 4, fontSize: 13, color: C.muted }}>{areaOf(r)} · waiting on {whoText(r.waiting_on, userName)}</span>
                <span style={{ display: 'flex', marginTop: 10 }}><Due small chip={dueChip(r, now)} /></span>
              </PhoneCard>
            )) : <Quiet>Nothing is waiting on anyone else.</Quiet>)}
            {tab === 'decided' && (decided.length ? decided.map(r => (
              <PhoneCard key={r.id} onClick={() => onOpen(r.id)}>
                <span style={{ fontWeight: 800, fontSize: 15 }}>{r.title}</span>
                <span style={{ display: 'block', marginTop: 4, fontSize: 13, color: C.muted }}>{r.decision_by || '—'} · {fmtWhen(r.decision_at, { time: false })}</span>
                <span style={{ display: 'flex', marginTop: 10 }}><Due small chip={outcomeChip(r.decision)} /></span>
              </PhoneCard>
            )) : <Quiet>Nothing decided in the last 30 days.</Quiet>)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ color: C.ink, fontFamily: font, maxWidth: 1180 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16, justifyContent: 'space-between' }}>
        <div>
          <Lbl style={{ marginBottom: 6 }}>{fmtToday(now)}{userName ? ` · signed in as ${userName}` : ''}</Lbl>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: '-0.01em' }}>Approvals</h1>
          <p style={{ margin: '6px 0 0', color: C.muted, fontSize: 15 }}>Everything waiting for you, grouped by area, oldest first. Please answer within 24 hours.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Btn onClick={() => onNavigate('approvers')}>Who approves what</Btn>
          <Btn kind="primary" onClick={() => onNavigate('idea')}>Give HQ an idea</Btn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginTop: 22 }}>
        <Tile label="Overdue" value={tiles.overdue} color="#A12B2B" note="Past 24 hours. Reminder sent; backup at 48h." />
        <Tile label="Due today" value={tiles.due_today} color="#8A4B00" note="Answer before the end of today" />
        <Tile label="Escalated to you" value={tiles.escalated} note="You are the backup approver" />
        <Tile label="The clock" note={<><b>24h</b> answer and reminder · <b>48h</b> goes to the backup · <b>72h</b> expires</>} />
      </div>

      <div role="tablist" style={{ display: 'flex', gap: 22, borderBottom: `1px solid ${C.line}`, marginTop: 26, flexWrap: 'wrap' }}>
        {[['mine', 'Waiting for me', mine.length], ['others', 'Waiting on others', others.length], ['decided', 'Decided', null]].map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            style={{ background: 'none', border: 0, borderBottom: `3px solid ${tab === k ? C.indigo : 'transparent'}`, font: `800 14px ${font}`, color: tab === k ? C.indigo : C.muted, padding: '0 4px', minHeight: 44, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {label}{n != null && <Count n={n} />}
          </button>
        ))}
      </div>

      {body || (
        <>
          {tab === 'mine' && (
            groups.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22, marginTop: 22 }}>
                {groups.map(g => (
                  <section key={g.key}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: g.escalated ? '#A12B2B' : C.indigo, flex: 'none' }} />
                      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{g.area}</h2>
                      <Chip>{g.items.length}</Chip>
                      <span style={{ fontSize: 13, color: C.muted }}>
                        {g.escalated ? 'The approver has not answered in 48 hours. You are the backup.' : g.rule ? ruleNote(g.rule) : 'Approvals raised before areas existed'}
                      </span>
                    </div>
                    <Table head={['What it is', 'From', 'Raised', 'Answer by', '']}>
                      {g.items.map(r => (
                        <Row key={r.id} onClick={() => open(r.id)} label={`Open ${r.title}`} cells={<>
                          <TitleCell title={r.title} chips={rowFlags(r, userName)} sub={changeLine(r, userName)} />
                          <span style={{ fontSize: 14, fontWeight: 700 }}>{r.agent_id || '—'}</span>
                          <span style={{ fontSize: 14, color: C.soft }}>{fmtWhen(r.created_at)}</span>
                          <span><Due chip={dueChip(r, now)} /></span>
                        </>} />
                      ))}
                    </Table>
                  </section>
                ))}
              </div>
            ) : <div style={{ marginTop: 22 }}><EmptyMine /></div>
          )}
          {tab === 'others' && (
            <div style={{ marginTop: 22 }}>
              {others.length ? (
                <Table head={['What it is', 'Waiting on', 'Raised', 'Answer by', '']}>
                  {others.map(r => (
                    <Row key={r.id} onClick={() => onOpen(r.id)} label={`Open ${r.title}`} cells={<>
                      <TitleCell title={r.title} chips={[areaOf(r)]} sub={r.voted ? 'You have answered' : typeLabel(r.artefact_type)} />
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{whoText(r.waiting_on, userName)}</span>
                      <span style={{ fontSize: 14, color: C.soft }}>{fmtWhen(r.created_at)}</span>
                      <span><Due chip={dueChip(r, now)} /></span>
                    </>} />
                  ))}
                </Table>
              ) : <Quiet>Nothing is waiting on anyone else.</Quiet>}
            </div>
          )}
          {tab === 'decided' && (
            <div style={{ marginTop: 22 }}>
              {decided.length ? (
                <Table head={['What it was', 'Decided by', 'When', 'Outcome', '']}>
                  {decided.map(r => (
                    <Row key={r.id} onClick={() => onOpen(r.id)} label={`Open ${r.title}`} cells={<>
                      <TitleCell title={r.title} chips={[areaOf(r)]} sub={r.decision === 'expired' ? 'No answer in 72 hours · HQ re-checks before asking again' : r.decision_notes ? `“${r.decision_notes}”` : null} />
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{r.decision_by || '—'}</span>
                      <span style={{ fontSize: 14, color: C.soft }}>{fmtWhen(r.decision_at, { time: false })}</span>
                      <span><Due chip={outcomeChip(r.decision)} /></span>
                    </>} />
                  ))}
                </Table>
              ) : <Quiet>Nothing decided in the last 30 days.</Quiet>}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function EmptyMine() {
  return (
    <Panel style={{ textAlign: 'center', padding: 36 }}>
      <p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Nothing is waiting for you</p>
      <p style={{ fontSize: 14, color: C.muted, margin: '6px 0 0' }}>New cards from doddl HQ land here, grouped by area.</p>
    </Panel>
  )
}
