// Who approves what (boards Approvers, ApproversPhone): GET /api/approvals/rules, PUT /api/approvals/rules/:area
// (Jon only, with a reason, optionally moving waiting cards), the append-only change log.
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, supabase } from '../../lib/supabase'
import { C, batchText, fmtWhen, money, rulesNeedingPerson, same } from '../../lib/approvalsUi'
import { Chip, Panel, Btn, Field, Radio, Notice, Quiet, Lbl, inputStyle, callJson, font } from './ui'

const defaultFetcher = (path, init) => callJson(apiFetch, path, init)
async function defaultPeople() {
  const { data, error } = await supabase.from('people').select('name, approval_admin, active, kind').order('name')
  if (error) throw error
  return (data || []).filter(p => p.active !== false && (p.kind == null || p.kind === 'human'))
}

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']]

function thresholdChip(r) {
  if (!r.spend_applies) return { text: '—', tone: 'muted' }
  if (r.spend_threshold_weekly == null) return { text: 'Not set', tone: 'warn' }
  return { text: `${money(Number(r.spend_threshold_weekly), r.threshold_currency || 'GBP', { sign: false })} a week${r.threshold_also_needs ? ` · +${r.threshold_also_needs}` : ''}`, tone: undefined }
}
const batchTone = (r) => (['single', 'off'].includes(r.batch_mode) ? 'muted' : undefined)
const ini = (n) => (n ? n.slice(0, 2) : '?')

function Avatar({ name }) {
  return <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: '50%', background: name ? C.indigo : '#A12B2B', color: '#fff', fontSize: 12, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{ini(name)}</span>
}

function Editor({ rule, people, onSave, onClose, compact }) {
  const [f, setF] = useState(() => ({
    approver: rule.approver || '', backup: rule.backup || '', second_approver: rule.second_approver || '',
    spend_threshold_weekly: rule.spend_threshold_weekly == null ? '' : String(rule.spend_threshold_weekly),
    threshold_currency: rule.threshold_currency || 'GBP', threshold_also_needs: rule.threshold_also_needs || '',
    batch_mode: rule.batch_mode || 'off', batch_day: rule.batch_day || '', reply_by: rule.reply_by ? String(rule.reply_by).slice(0, 5) : '', max_pack: rule.max_pack == null ? '' : String(rule.max_pack),
  }))
  const [reason, setReason] = useState('')
  const [move, setMove] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e && e.target ? e.target.value : e }))
  const names = people.map(p => p.name)
  const opts = (cur, none) => [...(cur && !names.some(n => same(n, cur)) ? [cur] : []), ...names]

  const changes = () => {
    const out = {}
    const norm = (v) => (v === '' ? null : v)
    const cmp = (k, v, orig) => { if (norm(v) !== (orig == null ? null : orig)) out[k] = norm(v) }
    cmp('approver', f.approver, rule.approver)
    cmp('backup', f.backup, rule.backup)
    cmp('second_approver', f.second_approver, rule.second_approver)
    if (rule.spend_applies) {
      const amt = f.spend_threshold_weekly === '' ? null : Number(f.spend_threshold_weekly)
      if (amt !== (rule.spend_threshold_weekly == null ? null : Number(rule.spend_threshold_weekly))) out.spend_threshold_weekly = amt
      cmp('threshold_currency', f.threshold_currency, rule.threshold_currency || 'GBP')
      cmp('threshold_also_needs', f.threshold_also_needs, rule.threshold_also_needs)
    }
    if (rule.batchable) {
      cmp('batch_mode', f.batch_mode, rule.batch_mode)
      if (f.batch_mode === 'weekly') cmp('batch_day', f.batch_day, rule.batch_day)
      if (f.batch_mode === 'daily') cmp('reply_by', f.reply_by, rule.reply_by ? String(rule.reply_by).slice(0, 5) : null)
      if (f.batch_mode === 'pack') { const m = f.max_pack === '' ? null : Number(f.max_pack); if (m !== (rule.max_pack == null ? null : rule.max_pack)) out.max_pack = m }
    }
    return out
  }
  const save = async () => {
    const ch = changes()
    if (!Object.keys(ch).length) { setErr('Nothing has changed.'); return }
    if (!reason.trim()) { setErr('Say why. The reason goes in the change log.'); return }
    setBusy(true); setErr(null)
    try { await onSave(rule.area, { changes: ch, reason: reason.trim(), move_waiting: move && ('approver' in ch || 'second_approver' in ch) }) }
    catch (e) { setErr(e.message); setBusy(false) }
  }
  const sel = (id, value, onChange, list, none) => (
    <select id={id} value={value} onChange={onChange} style={inputStyle}>
      {none && <option value="">{none}</option>}
      {list.map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  )
  const id = (k) => `${rule.area}-${k}`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Approver" htmlFor={id('ap')}>{sel(id('ap'), f.approver, set('approver'), opts(rule.approver), 'Choose a person')}</Field>
      <Field label={compact ? 'Backup' : 'Backup (gets the card at 48 hours)'} htmlFor={id('bk')}>{sel(id('bk'), f.backup, set('backup'), opts(rule.backup), 'None')}</Field>
      <Field label="Second approver" htmlFor={id('sa')} hint="Both must approve before anything runs.">{sel(id('sa'), f.second_approver, set('second_approver'), opts(rule.second_approver), 'None')}</Field>
      {rule.spend_applies && (
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <legend style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Spend threshold</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8 }}>
            <input aria-label="Amount a week" inputMode="decimal" placeholder="Amount a week" value={f.spend_threshold_weekly} onChange={set('spend_threshold_weekly')} style={inputStyle} />
            <select aria-label="Currency" value={f.threshold_currency} onChange={set('threshold_currency')} style={inputStyle}>{['GBP', 'USD', 'EUR'].map(c => <option key={c}>{c}</option>)}</select>
          </div>
          <select aria-label="Also needs" value={f.threshold_also_needs} onChange={set('threshold_also_needs')} style={inputStyle}>
            <option value="">Above it, also needs: nobody</option>
            {opts(rule.threshold_also_needs).map(n => <option key={n} value={n}>Also needs {n}</option>)}
          </select>
          <span style={{ fontSize: 12, color: C.muted }}>Changes that add more than this a week need a second yes.</span>
        </fieldset>
      )}
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Batch</legend>
        {rule.batchable ? (
          <>
            <Radio name={id('b')} value="off" checked={f.batch_mode === 'off' || f.batch_mode === 'single'} onChange={set('batch_mode')}>Off: one card per item</Radio>
            <Radio name={id('b')} value="weekly" checked={f.batch_mode === 'weekly'} onChange={set('batch_mode')}>Weekly pack, one card with a tick per line</Radio>
            {f.batch_mode === 'weekly' && (
              <select aria-label="Batch day" value={f.batch_day} onChange={set('batch_day')} style={{ ...inputStyle, margin: '0 0 6px 28px', width: 'calc(100% - 28px)' }}>
                <option value="">Any day</option>{DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
            <Radio name={id('b')} value="daily" checked={f.batch_mode === 'daily'} onChange={set('batch_mode')}>Daily pack, same-day reply-by time</Radio>
            {f.batch_mode === 'daily' && <input type="time" aria-label="Reply by" value={f.reply_by} onChange={set('reply_by')} style={{ ...inputStyle, margin: '0 0 6px 28px', width: 'calc(100% - 28px)' }} />}
            <Radio name={id('b')} value="monthly" checked={f.batch_mode === 'monthly'} onChange={set('batch_mode')}>Monthly plan</Radio>
            <Radio name={id('b')} value="pack" checked={f.batch_mode === 'pack'} onChange={set('batch_mode')}>Pack per batch, with a maximum size</Radio>
            {f.batch_mode === 'pack' && <input inputMode="numeric" aria-label="Most lines in a pack" placeholder="Most lines in a pack" value={f.max_pack} onChange={set('max_pack')} style={{ ...inputStyle, margin: '0 0 6px 28px', width: 'calc(100% - 28px)' }} />}
            <span style={{ fontSize: 12, color: C.muted }}>Each line keeps its own reason and its own limit check.</span>
          </>
        ) : <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Always single{rule.note ? `: ${rule.note}` : '.'}</p>}
      </fieldset>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Cards already waiting</legend>
        <Radio name={id('w')} value="leave" checked={!move} onChange={() => setMove(false)}>Leave with the current approver</Radio>
        <Radio name={id('w')} value="move" checked={move} onChange={() => setMove(true)}>Move them to the new approver</Radio>
      </fieldset>
      <Field label={compact ? 'Reason (logged)' : 'Reason for the change (goes in the log)'} htmlFor={id('why')}>
        <input id={id('why')} value={reason} onChange={e => setReason(e.target.value)} placeholder="For example: Laura owns social from November" style={inputStyle} />
      </Field>
      {err && <p role="alert" style={{ color: '#A12B2B', fontSize: 13, fontWeight: 700, margin: 0 }}>{err}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : '1fr', gap: 8 }}>
        <Btn kind="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : compact ? 'Save' : 'Save change'}</Btn>
        {compact && <Btn onClick={onClose}>Cancel</Btn>}
      </div>
    </div>
  )
}

export default function ApproversView({ userName, isMobile, onBack, fetcher = defaultFetcher, loadPeople = defaultPeople, initialData = null, initialPeople = null }) {
  const [data, setData] = useState(initialData)
  const [people, setPeople] = useState(initialPeople || [])
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState(null)
  const [sel, setSel] = useState(null)
  const [saved, setSaved] = useState(null)

  const load = useCallback(async () => {
    try { setError(null); setData(await fetcher('/api/approvals/rules')) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [fetcher])
  useEffect(() => { if (!initialData) load() }, [initialData, load])
  useEffect(() => { if (!initialPeople) loadPeople().then(setPeople).catch(() => setPeople([])) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const me = people.find(p => same(p.name, userName))
  const isAdmin = !!(me && me.approval_admin) || same(userName, 'Jon')
  const rules = data?.rules || []
  const log = data?.log || []
  const lastRead = rules.filter(r => r.last_read_at).sort((a, b) => new Date(b.last_read_at) - new Date(a.last_read_at))[0]
  const needs = rulesNeedingPerson(rules)
  const cur = rules.find(r => r.area === sel)

  const onSave = async (area, body) => {
    const res = await fetcher(`/api/approvals/rules/${encodeURIComponent(area)}`, { method: 'PUT', body: JSON.stringify(body) })
    setSel(null)
    setSaved(`${res?.rule?.label || 'Area'} saved.${res?.moved ? ` ${res.moved} waiting card${res.moved === 1 ? '' : 's'} moved.` : ''}`)
    await load()
  }

  if (loading && !data) return <Quiet>Loading who approves what…</Quiet>
  if (error && !data) return <Quiet>Could not load the rules: {error}</Quiet>

  const intro = (
    <>
      <p style={{ margin: 0, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 14px', fontSize: 14, flex: '1 1 380px' }}>
        <b>doddl HQ reads this table each time it raises a card.</b>{' '}
        {lastRead ? `Last read ${fmtWhen(lastRead.last_read_at)}, by ${lastRead.last_read_by}.` : 'No agent has read it yet.'}
      </p>
      {needs.length > 0 && (
        <p style={{ margin: 0, background: '#FBE9D2', color: '#6B3A00', borderRadius: 12, padding: '10px 14px', fontSize: 14, flex: '1 1 300px' }}>
          <b>{needs.length} area{needs.length === 1 ? ' needs' : 's need'} a person:</b> {needs.map(r => r.label).join(', ')} {needs.length === 1 ? 'has' : 'have'} no approver yet.
        </p>
      )}
      <p style={{ margin: 0, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 14px', fontSize: 14, flex: '1 1 300px' }}>
        <b>Prices are not approvals.</b> Pricing agents recommend only; their notes go to My work and nothing runs.
      </p>
    </>
  )
  const savedNote = saved && <Notice tone="ok" style={{ fontWeight: 800 }}>{saved}</Notice>

  if (isMobile) {
    return (
      <div style={{ fontFamily: font, color: C.ink, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {onBack && <button type="button" onClick={onBack} style={{ alignSelf: 'flex-start', background: 'none', border: 0, color: C.indigo, font: `800 15px ${font}`, minHeight: 44, padding: 0, cursor: 'pointer' }}>‹ Approvals</button>}
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Who approves what</h1>
        <p style={{ margin: 0, fontSize: 14, color: C.muted }}>HQ reads this each time it raises a card.{lastRead ? ` Last read ${fmtWhen(lastRead.last_read_at)}.` : ''}{isAdmin ? '' : ' Only Jon can change it.'}</p>
        {needs.length > 0 && <Notice tone="warn" style={{ fontSize: 13 }}><b>{needs.map(r => r.label).join(', ')}</b> {needs.length === 1 ? 'has' : 'have'} no approver yet.</Notice>}
        <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Prices are not approvals: pricing agents recommend only.</p>
        {savedNote}
        {rules.map(r => {
          const th = thresholdChip(r)
          return (
            <Panel key={r.area} style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{r.label}</h2>
                {isAdmin && <Btn small style={{ minHeight: 44 }} onClick={() => { setSaved(null); setSel(sel === r.area ? null : r.area) }} aria-label={`Change ${r.label}`}>{sel === r.area ? 'Close' : 'Change'}</Btn>}
              </div>
              <dl style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr)', gap: '4px 8px', fontSize: 14, margin: 0 }}>
                <dt style={{ color: C.muted, fontWeight: 700 }}>Approver</dt><dd style={{ margin: 0, fontWeight: 800, color: r.approver ? C.ink : '#A12B2B' }}>{r.approver || 'Not set'}</dd>
                <dt style={{ color: C.muted, fontWeight: 700 }}>Backup at 48h</dt><dd style={{ margin: 0, fontWeight: 800 }}>{r.backup || 'None'}</dd>
                <dt style={{ color: C.muted, fontWeight: 700 }}>Second</dt><dd style={{ margin: 0, fontWeight: 800 }}>{r.second_approver || 'None'}</dd>
              </dl>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Chip tone={batchTone(r)}>Batch: {batchText(r).toLowerCase()}</Chip>
                <Chip tone={th.tone || 'muted'}>{r.spend_applies ? (r.spend_threshold_weekly == null ? 'Spend threshold not set' : th.text) : 'No spend'}</Chip>
              </div>
              {sel === r.area && isAdmin && (
                <div style={{ borderTop: `1px solid ${C.line2}`, paddingTop: 10 }}>
                  <Editor key={r.area} rule={r} people={people} onSave={onSave} onClose={() => setSel(null)} compact />
                </div>
              )}
            </Panel>
          )
        })}
        <h2 style={{ margin: '10px 0 0', fontSize: 18, fontWeight: 800 }}>Change log</h2>
        <Panel style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {log.length ? log.map((l, i) => (
            <p key={l.id || i} style={{ margin: 0, fontSize: 14, borderTop: i ? `1px solid ${C.line2}` : 0, paddingTop: i ? 8 : 0 }}>
              <b>{fmtWhen(l.at)} · {l.changed_by}</b><br />{l.change}
              {l.reason && <><br /><span style={{ color: C.muted }}>“{l.reason}”</span></>}
            </p>
          )) : <span style={{ fontSize: 14, color: C.muted }}>No changes yet.</span>}
        </Panel>
      </div>
    )
  }

  const COLS = 'minmax(0,1.3fr) 130px 120px 150px 170px 160px 96px'
  return (
    <div style={{ fontFamily: font, color: C.ink, maxWidth: 1360 }}>
      <Lbl style={{ marginBottom: 6 }}>Settings · {isAdmin ? 'only you can change this page' : 'only Jon can change this page'}</Lbl>
      <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800 }}>Who approves what</h1>
      <p style={{ margin: '6px 0 0', color: C.muted, fontSize: 15, maxWidth: 760 }}>Each area has one approver, a backup who gets the card at 48 hours, and, where it matters, a second approver or a spend threshold. Every change is logged.</p>
      <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>{intro}</div>
      {savedNote && <div style={{ marginTop: 12 }}>{savedNote}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginTop: 20, alignItems: 'flex-start' }}>
        <Panel style={{ flex: '999 1 760px', padding: 0, overflowX: 'auto' }}>
          <div style={{ minWidth: 1020 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '12px 18px' }}>
              {['Area', 'Approver', 'Backup at 48h', 'Second approver', 'Spend threshold', 'Batch', ''].map(h => <Lbl key={h} as="span">{h}</Lbl>)}
            </div>
            {rules.map(r => {
              const th = thresholdChip(r)
              return (
                <div key={r.area} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, alignItems: 'center', padding: '12px 18px', borderTop: `1px solid ${C.line2}`, fontSize: 14, background: sel === r.area ? '#F6F2FD' : 'transparent' }}>
                  <span><b>{r.label}</b><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{r.what}</span></span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800, color: r.approver ? C.ink : '#A12B2B' }}><Avatar name={r.approver} />{r.approver || 'Not set'}</span>
                  <span style={{ fontWeight: 700 }}>{r.backup || '—'}</span>
                  <span><Chip tone={r.second_approver ? undefined : 'muted'}>{r.second_approver || 'None'}</Chip></span>
                  <span><Chip tone={th.tone}>{th.text}</Chip></span>
                  <span><Chip tone={batchTone(r)}>{batchText(r)}</Chip></span>
                  <span>{isAdmin && <Btn onClick={() => { setSaved(null); setSel(r.area) }} aria-label={`Change ${r.label}`}>Change</Btn>}</span>
                </div>
              )
            })}
          </div>
        </Panel>
        {cur && isAdmin && (
          <Panel style={{ flex: '1 1 340px', padding: 18, border: `2px solid ${C.indigo}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{cur.label}</h2>
              <Btn onClick={() => setSel(null)} aria-label="Close">Close</Btn>
            </div>
            <Editor key={cur.area} rule={cur} people={people} onSave={onSave} onClose={() => setSel(null)} />
          </Panel>
        )}
      </div>
      <Panel style={{ marginTop: 20, padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '16px 18px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Change log</h2>
          <span style={{ fontSize: 13, color: C.muted }}>Kept for good. Nothing here can be edited.</span>
        </div>
        <div style={{ minWidth: 820 }}>
          {log.length ? log.map((l, i) => (
            <div key={l.id || i} style={{ display: 'grid', gridTemplateColumns: '150px 80px minmax(0,1fr) minmax(0,0.8fr)', gap: 12, padding: '10px 18px', borderTop: `1px solid ${C.line2}`, fontSize: 14 }}>
              <span style={{ fontWeight: 800, color: C.muted }}>{fmtWhen(l.at)}</span><span style={{ fontWeight: 800 }}>{l.changed_by}</span><span>{l.change}</span><span style={{ color: C.muted }}>{l.reason ? `“${l.reason}”` : ''}</span>
            </div>
          )) : <p style={{ padding: '10px 18px', fontSize: 14, color: C.muted, margin: 0 }}>No changes yet.</p>}
        </div>
      </Panel>
    </div>
  )
}
