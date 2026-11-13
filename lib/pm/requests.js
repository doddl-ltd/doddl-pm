// The requests hub (migration 35): create, decide, talk, and the Standing work actions; and HQ's side.
// Every change appends to the request's history; nothing is deleted.
import { TYPES, KINDS, cleanRequest, planFor, allowedOps } from './requestTypes'

const fail = (status, message) => Object.assign(new Error(message), { status, expose: true })
function must(r, what) { if (r.error) throw fail(500, `${what}: ${r.error.message}`); return r.data }
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const now = () => new Date().toISOString()
const who = (user) => (user && user.name) || 'unknown'
const text = (v, max = 4000) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max)
const REVIEW_MONTHS = { Month: 1, Quarter: 3, 'Half year': 6 }
function nextReview(every, from = new Date()) {
  const d = new Date(from)
  d.setMonth(d.getMonth() + (REVIEW_MONTHS[every] || 3))
  return d.toISOString().slice(0, 10)
}

async function load(db, id) {
  if (!isUuid(id)) throw fail(400, 'id must be a request UUID')
  const r = must(await db.from('requests').select('*').eq('id', id).maybeSingle(), 'request')
  if (!r) throw fail(404, 'No such request')
  return r
}
async function save(db, r, patch, line, by) {
  const row = { ...patch, updated_at: now(), log: [...(r.log || []), { at: now(), by, text: line }] }
  return must(await db.from('requests').update(row).eq('id', r.id).select('*').single(), 'request')
}

/** GET /api/requests: every request, newest first. */
export async function listRequests(db) {
  return { requests: must(await db.from('requests').select('*').order('updated_at', { ascending: false }).limit(1000), 'requests') }
}

/** The plan and the running details a request gets when it is drafted. */
function drafted(r) {
  const f = r.fields || {}
  return {
    agent: TYPES[r.kind].agent, plan: planFor(r).map(([k, v]) => ({ k, v })), stage: 'plan_approval',
    ...(r.mode === 'on' ? { owner: f.owner || null, cadence: f.cad || null, review_every: f.review || null, lives_in: f.lives || f.mkt || null } : {}),
  }
}
const DRAFT_NOTE = 'Plan drafted from your answers. Check it, ask anything here, then approve it, change it or park it.'

/** POST /api/requests { kind, mode, fields }: a new request with its plan ready to approve. */
export async function createRequest(db, user, raw) {
  const c = cleanRequest(raw)
  const by = who(user)
  const at = now()
  const row = {
    ...c, asked_by: by, ...drafted(c),
    thread: [{ at, who: 'HQ', text: DRAFT_NOTE }],
    log: [{ at, by, text: `Asked by ${by}` }, { at, by: 'HQ', text: `Plan drafted: ${TYPES[c.kind].agent}` }],
  }
  return must(await db.from('requests').insert(row).select('*').single(), 'request')
}

/** POST /api/requests { id, op, note?, text? }: a person's decision or message on one request. */
export async function actOnRequest(db, user, b) {
  const r = await load(db, b.id)
  const op = b.op
  if (!allowedOps(r).includes(op)) throw fail(400, `"${op}" is not possible while the request is ${r.stage.replace('_', ' ')}`)
  const by = who(user)
  const note = text(b.note)
  const needNote = () => { if (!note) throw fail(400, 'Add a note for HQ first') }
  const say = (t) => [...(r.thread || []), { at: now(), who: by, text: t }]
  switch (op) {
    case 'reply': {
      const t = text(b.text)
      if (!t) throw fail(400, 'Write a message first')
      return must(await db.from('requests').update({ thread: say(t), updated_at: now() }).eq('id', r.id).select('*').single(), 'request')
    }
    case 'approve':
      if (r.stage === 'plan_approval') return save(db, r, { stage: 'in_progress' }, `Plan approved by ${by}`, by)
      if (r.mode === 'on') return save(db, r, { stage: 'running', paused: false, health: 'Healthy', health_note: 'Just started', next_review: nextReview(r.review_every) }, `Finished work approved by ${by}: running, in Standing work`, by)
      return save(db, r, { stage: 'live' }, `Finished work approved by ${by}: live`, by)
    case 'change':
      needNote()
      if (r.stage === 'plan_approval') return save(db, r, { stage: 'asked', thread: say(note) }, `Changes asked by ${by}: HQ re-scopes it`, by)
      return save(db, r, { stage: 'in_progress', thread: say(note) }, `Sent back by ${by}`, by)
    case 'park':
      needNote()
      return save(db, r, { stage: 'parked', parked_from: r.stage, parked_note: note, thread: say(note) }, `Parked by ${by}`, by)
    case 'reopen':
      return save(db, r, { stage: r.parked_from || 'plan_approval', parked_from: null, parked_note: null }, `Reopened by ${by}`, by)
    case 'accept':
      return save(db, r, drafted(r), `Accepted by ${by}`, by)
    case 'decline':
      return save(db, r, { stage: 'declined', ...(note ? { thread: say(note) } : {}) }, `Declined by ${by}`, by)
    case 'pause':
      return save(db, r, { paused: !r.paused }, `${r.paused ? 'Resumed' : 'Paused'} by ${by}`, by)
    case 'retire':
      needNote()
      return save(db, r, { stage: 'closed', paused: false, thread: say(note) }, `Retired by ${by}`, by)
    case 'close':
      return save(db, r, { stage: 'closed', ...(note ? { results: note } : {}) }, `Closed by ${by}`, by)
    case 'change_request': {
      needNote()
      const at = now()
      const child = {
        kind: r.kind, mode: 'on', title: `Change: ${r.title}`.slice(0, 120), fields: r.fields || {}, stage: 'asked', asked_by: by, parent_id: r.id,
        owner: r.owner, cadence: r.cadence, review_every: r.review_every, lives_in: r.lives_in,
        thread: [{ at, who: by, text: note }], log: [{ at, by, text: `Change asked by ${by} for "${r.title}"` }],
      }
      const c = must(await db.from('requests').insert(child).select('*').single(), 'request')
      await save(db, r, {}, `Change request raised by ${by}`, by)
      return c
    }
    default: throw fail(400, 'Unknown op')
  }
}

// ─── HQ side (agent routes, requests:read / requests:write) ─────────────────
export const HQ_STAGES = ['asked', 'in_progress', 'running']

/** GET /api/agent/requests?stage=asked|in_progress|running: what HQ has to scope, make or keep running. */
export async function listForHq(db, stage) {
  if (!HQ_STAGES.includes(stage)) throw fail(400, `stage must be one of ${HQ_STAGES.join(', ')}`)
  return { requests: must(await db.from('requests').select('*').eq('stage', stage).order('updated_at').limit(200), 'requests') }
}

/** POST /api/agent/requests { suggest: { kind, mode, title, why, from } }: an agent's suggestion, waiting for a person. */
export async function suggestFromHq(db, body) {
  const s = body && body.suggest
  if (!s || !KINDS.includes(s.kind) || !text(s.title) || !text(s.from)) throw fail(400, 'Send { suggest: { kind, mode, title, why, from } }')
  const at = now()
  return must(await db.from('requests').insert({
    kind: s.kind, mode: s.mode === 'on' && !TYPES[s.kind].oneOnly ? 'on' : 'one', title: text(s.title, 120), fields: { q: text(s.title, 2000) },
    stage: 'suggested', asked_by: 'HQ', suggested_from: text(s.from, 200),
    thread: s.why ? [{ at, who: 'HQ', text: text(s.why) }] : [], log: [{ at, by: 'HQ', text: `Suggested by ${text(s.from, 200)}` }],
  }).select('*').single(), 'request')
}

const HQ_OPS = {
  scope: ['asked'], ask: null, made: ['in_progress'], results: ['live'], health: ['running'],
}
/** PATCH /api/agent/requests { updates: [{ id, op, plan?, agent?, text?, output?, results?, health?, health_note?, cost_month? }] } */
export async function updateFromHq(db, body) {
  const ups = Array.isArray(body && body.updates) ? body.updates : null
  if (!ups || !ups.length || ups.length > 100) throw fail(400, 'Send { updates: [...] } (1 to 100)')
  const out = []
  for (const [i, u] of ups.entries()) {
    if (!u || !(u.op in HQ_OPS)) throw fail(400, `updates[${i}].op must be one of ${Object.keys(HQ_OPS).join(', ')}`)
    const r = await load(db, u.id)
    const from = HQ_OPS[u.op]
    if (from && !from.includes(r.stage)) { out.push({ id: r.id, skipped: `not ${from.join(' or ')}` }); continue }
    const msg = text(u.text)
    const thread = msg ? [...(r.thread || []), { at: now(), who: 'HQ', text: msg }] : r.thread
    let patch, line
    if (u.op === 'scope') {
      const plan = Array.isArray(u.plan) ? u.plan.filter(p => p && p.k && p.v).slice(0, 20).map(p => ({ k: text(p.k, 80), v: text(p.v, 600) })) : null
      if (!plan || !plan.length) throw fail(400, `updates[${i}].plan must be [{ k, v }]`)
      patch = { stage: 'plan_approval', plan, agent: text(u.agent || r.agent || '', 200) || null, thread }
      line = 'HQ scoped it'
    } else if (u.op === 'ask') {
      if (!msg) throw fail(400, `updates[${i}].text is required to ask`)
      patch = { thread }; line = 'HQ asked a question'
    } else if (u.op === 'made') {
      const o = u.output && typeof u.output === 'object' ? u.output : null
      if (!o || !text(o.summary)) throw fail(400, `updates[${i}].output must be { summary, link? }`)
      patch = { stage: 'output_approval', output: { summary: text(o.summary, 2000), link: /^https:\/\//.test(String(o.link || '')) ? String(o.link).slice(0, 500) : null, checks: text(o.checks || '', 600) || null }, thread }
      line = 'Made: ready for review'
    } else if (u.op === 'results') {
      if (!text(u.results)) throw fail(400, `updates[${i}].results is required`)
      patch = { stage: 'closed', results: text(u.results), thread }; line = 'Results posted; closed'
    } else {
      patch = { health: text(u.health || '', 40) || r.health, health_note: text(u.health_note || '', 300) || r.health_note, cost_month: text(u.cost_month || '', 40) || r.cost_month, thread }
      line = `Health: ${patch.health}`
    }
    const s = await save(db, r, patch, line, 'HQ')
    out.push({ id: s.id, stage: s.stage })
  }
  return { results: out }
}
