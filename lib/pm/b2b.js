// B2B campaigns (docs/b2b-campaigns/CONTRACT.md): the database side of /api/b2b/*, /api/agent/b2b/*, the MCP
// tools and the decide hook. The rules live in lib/b2b.js (pure, unit-tested); approvals reuse Approvals v2
// (lib/pm/ops.submitForApproval -> approval area "outreach", the clock, the card and /api/approvals/decide).
//
// Every function takes a service-role client built for the caller (lib/server/admin.js), like lib/pm/hq.js.
// Contact details never pass through here: a prospect's contact is { role, type, has_contact } (lib/b2b.cleanContact,
// and a CHECK in migrations 26 / 27). Addresses live in b2b_contacts, handled by lib/pm/b2bMail.js for people only.

import {
  B2B_AREA, B2B_PROJECT_ID, COUNTRIES, STAGES, ACTIVE_STAGES, AGENT_POSTS, AGENT_STAGE_MOVES, AUTO_REPLY_KINDS, REPLY_KINDS, PROSPECT_STATUSES,
  SAMPLE_REASON_IDS, b2bError, cleanCampaignPatch, cleanContact, cleanDefinition, countryRules, definitionArtefact, definitionFromType,
  draftEditable, hasContactDetails, needsContact, nextChip, personAction, postBlocked, replyDueAt, sampleOutcome, stageAfterDecision,
  submitProblems, trackFor,
} from '../b2b'
import { validateArtefact } from '../artefactTypes'
import { dueAt, pendingVoters, notify } from './approvals'
import { submitForApproval, createTask } from './ops'
import { applyGolive, goliveExtras } from './b2bMail'

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const same = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
const APPROVED_FAMILY = ['approved', 'approved_with_edits', 'partially_approved']
const MAX_BATCH = 500
const FK = { b2b_definition: 'definition_task_id', b2b_sample: 'sample_task_id', b2b_sequence: 'words_task_id', b2b_golive: 'golive_task_id' }
const KIND_OF = { b2b_definition: 'definition', b2b_sample: 'sample', b2b_sequence: 'words', b2b_golive: 'golive' }
const TASK_FIELDS = 'id, title, artefact_type, created_at, expires_at, decision, decision_by, decision_at, decision_notes, line_decisions, approvers, assigned_to, escalated_to, approval_area, archived_at'
const CAMPAIGN_LIST_FIELDS = 'id, name, business_type_id, goal, offers, market, volume, sample_size, channels, people, approver, stage, stage_since, paused_from, definition_task_id, sample_task_id, words_task_id, golive_task_id, metrics, owner, created_by, created_at, updated_at'
const METRIC_KEYS = ['found', 'approved', 'contacts_missing', 'emailed', 'opened', 'replied', 'meetings', 'orders']

function must(result, what) {
  if (result.error) {
    const code = result.error.code
    throw b2bError(code === '23514' || code === '22P02' || code === '23503' ? 400 : code === '23505' ? 409 : 500, `${what}: ${result.error.message}`)
  }
  return result.data
}

/** A person acting through the UI, as a principal for lib/pm/ops (no agent id). */
export function personPrincipal(name) {
  return { kind: 'person', agent_id: null, actor: name, scopes: [], on_behalf_of: name }
}

async function activePeople(db) {
  return must(await db.from('people').select('name').eq('active', true).eq('kind', 'human').order('name'), 'people').map(p => p.name)
}

async function pageAll(build, cap = 20000) {
  const rows = []
  for (let from = 0; from < cap; from += 1000) {
    const data = must(await build().range(from, from + 999), 'rows')
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function getCampaign(db, id, fields = '*') {
  if (!isUuid(id)) throw b2bError(400, 'campaign id must be a UUID')
  const c = must(await db.from('b2b_campaigns').select(fields).eq('id', id).is('archived_at', null).maybeSingle(), 'campaign')
  if (!c) throw b2bError(404, `No campaign ${id}`)
  return c
}

async function tasksById(db, ids) {
  const list = [...new Set(ids.filter(Boolean))]
  const out = {}
  for (let i = 0; i < list.length; i += 200) {
    for (const t of must(await db.from('tasks').select(TASK_FIELDS).in('id', list.slice(i, i + 200)), 'approvals')) out[t.id] = t
  }
  const votes = {}
  for (let i = 0; i < list.length; i += 200) {
    for (const v of must(await db.from('approval_votes').select('task_id, voter, vote, at').in('task_id', list.slice(i, i + 200)), 'votes')) (votes[v.task_id] || (votes[v.task_id] = [])).push(v)
  }
  for (const t of Object.values(out)) {
    t.due_at = t.decision ? null : dueAt(t).toISOString()
    t.waiting_on = t.decision ? [] : pendingVoters(t, votes[t.id] || [])
  }
  return out
}

function approvalSummary(t) {
  if (!t) return null
  return {
    id: t.id, title: t.title, artefact_type: t.artefact_type, kind: KIND_OF[t.artefact_type] || null, created_at: t.created_at,
    decision: t.decision, decision_by: t.decision_by, decision_at: t.decision_at, decision_notes: t.decision_notes,
    due_at: t.due_at, waiting_on: t.waiting_on, approvers: t.approvers,
  }
}

function linkedFor(c, tasks) {
  return { definition: tasks[c.definition_task_id] || null, sample: tasks[c.sample_task_id] || null, words: tasks[c.words_task_id] || null, golive: tasks[c.golive_task_id] || null }
}

const fmtShort = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' }) : '')

/** The 7-step track with notes ("Approved 6 Nov", "25 found") and the due time of a waiting step. */
function trackWithNotes(c, linked, counts = {}) {
  const steps = trackFor(c, linked)
  const m = c.metrics || {}
  const yes = (t) => t && APPROVED_FAMILY.includes(t.decision)
  const notes = [
    yes(linked.definition) ? `Approved ${fmtShort(linked.definition.decision_at)}` : '',
    counts.sampled ? `${counts.sampled} found` : '',
    yes(linked.sample) ? `${counts.approved || m.approved || 0} ticked` : '',
    m.found ? `${m.found} found` : '',
    yes(linked.words) ? `Approved ${fmtShort(linked.words.decision_at)}` : '',
    '',
    c.stage === 'live' ? `Day ${Math.max(1, Math.ceil((Date.now() - new Date(c.stage_since).getTime()) / 86400_000))}` : '',
  ]
  const waitingTask = { 2: linked.sample, 0: linked.definition, 4: linked.words, 5: linked.words, 6: linked.golive }
  return steps.map((s, i) => {
    const t = s.state === 'wait' ? waitingTask[i] : null
    return { ...s, note: notes[i] || '', due_at: t && !t.decision ? t.due_at : null }
  })
}

function numsFor(c, counts = {}) {
  const m = c.metrics || {}
  const goal = c.goal && c.goal.id
  const last = ['calls', 'deal'].includes(goal) ? { v: m.meetings, l: goal === 'calls' ? 'calls' : 'meetings' } : { v: m.orders, l: 'orders' }
  const show = (v) => (v == null ? 0 : v)
  if (['live', 'done'].includes(c.stage) || (c.stage === 'paused' && c.paused_from === 'live')) {
    return [{ v: show(m.approved ?? counts.approved), l: 'approved' }, { v: show(m.emailed), l: 'emailed' }, { v: show(m.opened), l: 'opened' }, { v: show(m.replied), l: 'replied' }, { v: show(last.v), l: last.l }]
  }
  return [
    { v: counts.sampled ? counts.sampled : '–', l: 'in the sample' },
    { v: m.found || c.volume || '–', l: m.found ? 'found in total' : 'to contact' },
    { v: show(m.emailed), l: 'emailed' }, { v: show(m.replied), l: 'replied' }, { v: show(last.v), l: last.l },
  ]
}

async function prospectCounts(db, campaignIds) {
  const out = {}
  if (!campaignIds.length) return out
  const rows = await pageAll(() => db.from('b2b_prospects').select('campaign_id, status').in('campaign_id', campaignIds).order('id'))
  for (const r of rows) {
    const c = out[r.campaign_id] || (out[r.campaign_id] = { total: 0, sampled: 0, approved: 0 })
    c.total++
    c[r.status] = (c[r.status] || 0) + 1
    if (['sample', 'approved', 'rejected'].includes(r.status)) c.sampled++
    if (r.status === 'approved') c.approved++
  }
  return out
}

// ─── business types ─────────────────────────────────────────────────────────

export async function listBusinessTypes(db) {
  const types = must(await db.from('b2b_business_types').select('*').order('is_template', { ascending: false }).order('position').order('name'), 'business types')
  const camps = must(await db.from('b2b_campaigns').select('business_type_id, stage').is('archived_at', null), 'campaigns')
  return {
    people: await activePeople(db),
    types: types.map(t => {
      const mine = camps.filter(c => c.business_type_id === t.id)
      return { ...t, campaigns: mine.length, live: mine.filter(c => c.stage === 'live').length, learned_count: (t.learned_rules || []).length }
    }),
  }
}

function slugify(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'type'
}

/** POST /api/b2b/business-types: "Save as a business type" (from the wizard's definition). */
export async function saveBusinessType(db, actor, input = {}) {
  const d = cleanDefinition(input.definition || input)
  const name = String(input.name || d.name || '').trim().slice(0, 120)
  if (!name) throw b2bError(400, 'name is required')
  let slug = slugify(name)
  const taken = new Set(must(await db.from('b2b_business_types').select('slug').like('slug', `${slug}%`), 'slugs').map(r => r.slug))
  for (let i = 2; taken.has(slug); i++) slug = `${slugify(name)}-${i}`
  const defaults = isObj(input.defaults) ? input.defaults : {}
  const row = {
    slug, name, description: input.description ? String(input.description).slice(0, 300) : d.line, line: d.line, kinds: d.kinds, size: d.size,
    who_decides: d.who_decides, must: d.must, nice: d.nice, rule_out: [...d.rule_out, ...d.extra_rules], sources: d.sources, wants: d.wants,
    contact_rules: d.contact_rules, defaults, is_template: false, created_by: actor,
  }
  return must(await db.from('b2b_business_types').insert([row]).select('*').single(), 'save business type')
}

/** PATCH /api/agent/b2b/business-types/:id { learned_rules: [{ rule, from_reason, count, campaign_id }] }: appended, never replaced. */
export async function appendLearnedRules(db, id, input = {}) {
  if (!isUuid(id)) throw b2bError(400, 'business type id must be a UUID')
  const list = Array.isArray(input.learned_rules) ? input.learned_rules : null
  if (!list || !list.length) throw b2bError(400, 'Send { learned_rules: [{ rule, from_reason, count, campaign_id }] }')
  if (list.length > 50) throw b2bError(400, 'At most 50 rules per call')
  const at = new Date().toISOString()
  const add = list.map((r, i) => {
    if (!isObj(r) || !String(r.rule || '').trim()) throw b2bError(400, `learned_rules[${i}].rule is required`)
    if (r.campaign_id != null && !isUuid(r.campaign_id)) throw b2bError(400, `learned_rules[${i}].campaign_id must be a UUID`)
    if (r.count != null && !(Number.isInteger(r.count) && r.count >= 0)) throw b2bError(400, `learned_rules[${i}].count must be a whole number`)
    const from = r.from_reason == null ? null : String(r.from_reason).slice(0, 60)
    return { rule: String(r.rule).trim().slice(0, 300), from_reason: from, count: r.count ?? null, campaign_id: r.campaign_id || null, at }
  })
  const t = must(await db.from('b2b_business_types').select('id, learned_rules').eq('id', id).maybeSingle(), 'business type')
  if (!t) throw b2bError(404, `No business type ${id}`)
  const learned = [...(t.learned_rules || []), ...add]
  return must(await db.from('b2b_business_types').update({ learned_rules: learned }).eq('id', id).select('id, slug, name, learned_rules').single(), 'learned rules')
}

// ─── campaigns (people) ─────────────────────────────────────────────────────

/** GET /api/b2b/campaigns: tiles, rows with track / next / figures, templates. */
export async function listCampaigns(db, actor) {
  const camps = must(await db.from('b2b_campaigns').select(CAMPAIGN_LIST_FIELDS).is('archived_at', null).order('created_at', { ascending: false }).limit(500), 'campaigns')
  const ids = camps.map(c => c.id)
  const [tasks, counts, types, replies] = await Promise.all([
    tasksById(db, camps.flatMap(c => [c.definition_task_id, c.sample_task_id, c.words_task_id, c.golive_task_id])),
    prospectCounts(db, ids),
    db.from('b2b_business_types').select('id, slug, name, description, is_template, position, defaults, learned_rules').order('position'),
    ids.length ? db.from('b2b_replies').select('id, campaign_id, assigned_to, due_at, kind').eq('status', 'needs_person').in('campaign_id', ids) : { data: [] },
  ])
  const typeRows = must(types, 'business types')
  const replyRows = must(replies, 'replies')
  const typeById = Object.fromEntries(typeRows.map(t => [t.id, t]))

  const mineWaiting = { definition: 0, sample: 0, words: 0, golive: 0 }
  const rows = camps.map(c => {
    const linked = linkedFor(c, tasks)
    const repliesWaiting = replyRows.filter(r => r.campaign_id === c.id).length
    const waitingTask = Object.values(linked).find(t => t && !t.decision) || null
    if (waitingTask && waitingTask.waiting_on.some(n => same(n, actor))) mineWaiting[KIND_OF[waitingTask.artefact_type]]++
    const t = typeById[c.business_type_id]
    return {
      ...c,
      business_type: t ? { id: t.id, slug: t.slug, name: t.name } : null,
      track: trackWithNotes(c, linked, counts[c.id]),
      next: nextChip(c, { repliesWaiting, words: linked.words, approver: waitingTask && waitingTask.waiting_on[0] }),
      nums: numsFor(c, counts[c.id]),
      waiting: approvalSummary(waitingTask),
      replies_waiting: repliesWaiting,
    }
  })
  const myReplies = replyRows.filter(r => same(r.assigned_to, actor)).length
  const parts = [
    mineWaiting.definition && `${mineWaiting.definition} definition${mineWaiting.definition === 1 ? '' : 's'}`,
    mineWaiting.sample && `${mineWaiting.sample} sample list${mineWaiting.sample === 1 ? '' : 's'}`,
    mineWaiting.words && `${mineWaiting.words} email sequence${mineWaiting.words === 1 ? '' : 's'}`,
    mineWaiting.golive && `${mineWaiting.golive} go-live${mineWaiting.golive === 1 ? '' : 's'}`,
    myReplies && `${myReplies} repl${myReplies === 1 ? 'y' : 'ies'}`,
  ].filter(Boolean)
  const live = camps.filter(c => c.stage === 'live').length
  const setup = camps.filter(c => ['draft', 'define_review', 'sampling', 'sample_review', 'finding', 'words_review', 'golive_review'].includes(c.stage)).length
  return {
    tiles: {
      waiting_for_you: Object.values(mineWaiting).reduce((a, b) => a + b, 0) + myReplies,
      waiting_note: parts.join(', ') || 'Nothing waiting',
      replies_for_person: replyRows.length,
      meetings: camps.filter(c => ['live', 'paused', 'done'].includes(c.stage)).reduce((t, c) => t + (Number((c.metrics || {}).meetings) || 0), 0),
      live,
      setup,
    },
    campaigns: rows,
    templates: typeRows.filter(t => t.is_template).map(t => ({ id: t.id, slug: t.slug, name: t.name, description: t.description, defaults: t.defaults })),
  }
}

/** GET /api/b2b/campaigns/:id: everything the detail screen needs. Prospects are paged (page_size 50). */
export async function campaignDetail(db, id, { page = 1, page_size = 50, status = null } = {}) {
  const c = await getCampaign(db, id)
  const [typeRow, approvals, counts, replies] = await Promise.all([
    c.business_type_id ? db.from('b2b_business_types').select('*').eq('id', c.business_type_id).maybeSingle() : { data: null },
    db.from('tasks').select(TASK_FIELDS).eq('artefact->>campaign_id', c.id).eq('task_type', 'approval').is('archived_at', null).order('created_at'),
    prospectCounts(db, [c.id]),
    db.from('b2b_replies').select('id, prospect_id, kind, summary, draft, assigned_to, due_at, status, created_at, closed_at, closed_by').eq('campaign_id', c.id).order('created_at', { ascending: false }).limit(200),
  ])
  const approvalRows = must(approvals, 'approvals')
  const tasks = await tasksById(db, [...approvalRows.map(t => t.id), c.definition_task_id, c.sample_task_id, c.words_task_id, c.golive_task_id])
  const linked = linkedFor(c, tasks)

  const size = Math.min(200, Math.max(10, Number(page_size) || 50))
  const pg = Math.max(1, Number(page) || 1)
  let q = db.from('b2b_prospects').select('id, hq_ref, name, place, details, sources, match, fit, contact, status, reject_reason, reject_note, excluded_reason', { count: 'exact' })
    .eq('campaign_id', c.id).order('fit', { ascending: false, nullsFirst: false }).order('name').range((pg - 1) * size, pg * size - 1)
  if (status) {
    const list = String(status).split(',').filter(s => PROSPECT_STATUSES.includes(s))
    if (list.length) q = q.in('status', list)
  }
  const pr = await q
  const prospects = must(pr, 'prospects').map(p => ({ ...p, contact: cleanContactOut(p.contact) }))

  const reachable = await pageAll(() => db.from('b2b_prospects').select('id, name, place, status, contact').eq('campaign_id', c.id)
    .in('status', ['approved', 'found', 'queued', 'contacted', 'replied']).order('name'), 5000)
  const toAdd = reachable.filter(needsContact)
  const replyRows = must(replies, 'replies')
  const pmap = Object.fromEntries(reachable.map(p => [p.id, p]))
  return {
    campaign: c,
    business_type: typeRow.data || null,
    track: trackWithNotes(c, linked, counts[c.id]),
    next: nextChip(c, { repliesWaiting: replyRows.filter(r => r.status === 'needs_person').length, words: linked.words }),
    nums: numsFor(c, counts[c.id]),
    approvals: approvalRows.map(t => approvalSummary(tasks[t.id] || t)),
    linked: Object.fromEntries(Object.entries(linked).map(([k, t]) => [k, approvalSummary(t)])),
    prospects: { rows: prospects, total: pr.count ?? prospects.length, page: pg, page_size: size, counts: counts[c.id] || { total: 0 } },
    contacts_to_add: { count: toAdd.length, owner: c.owner || c.created_by, rows: toAdd.slice(0, 50).map(p => ({ id: p.id, name: p.name, place: p.place, contact: cleanContactOut(p.contact) })) },
    replies: replyRows.map(r => ({ ...r, prospect: r.prospect_id && pmap[r.prospect_id] ? { name: pmap[r.prospect_id].name, place: pmap[r.prospect_id].place } : null })),
    country_rules: countryRules(c.market && c.market.country),
  }
}

function cleanContactOut(c) {
  const x = isObj(c) ? c : {}
  return { role: x.role || null, type: x.type || 'none', has_contact: !!x.has_contact }
}

/** POST /api/b2b/campaigns: a new draft. business_type_id fills the definition (unless one is sent) and the defaults. */
export async function createCampaign(db, actor, input = {}) {
  const people = await activePeople(db)
  const patch = cleanCampaignPatch(input, people)
  let type = null
  if (patch.business_type_id) {
    type = must(await db.from('b2b_business_types').select('*').eq('id', patch.business_type_id).maybeSingle(), 'business type')
    if (!type) throw b2bError(400, `No business type ${patch.business_type_id}`)
  }
  const d = (type && type.defaults) || {}
  const row = {
    definition: definitionFromType(type),
    goal: { id: d.goal || null, target: null, by: null },
    offers: Array.isArray(d.offers) ? d.offers : [],
    market: d.country ? { country: d.country, regions: [], places: [], language: null } : {},
    sample_size: d.sample_size || null,
    channels: ['email', 'phone', 'post'],
    owner: actor,
    ...patch,
    stage: 'draft',
    created_by: actor,
  }
  if (row.market && row.market.country && !row.market.language) {
    row.market = { ...row.market, language: COUNTRIES[row.market.country].language }
  }
  return must(await db.from('b2b_campaigns').insert([row]).select('*').single(), 'create campaign')
}

/**
 * PATCH /api/b2b/campaigns/:id: edit a draft (while editable), or { action: pause | resume | cancel }.
 */
export async function patchCampaign(db, actor, id, input = {}) {
  const c = await getCampaign(db, id)
  // Sending settings (any stage but done / cancelled): opens tracking and "approve each day's batch".
  const SETTINGS = ['track_opens', 'approve_daily']
  if (Object.keys(input).length && Object.keys(input).every(k => SETTINGS.includes(k))) {
    if (['done', 'cancelled'].includes(c.stage)) throw b2bError(409, `The campaign is ${c.stage}`)
    const patch = {}
    for (const k of SETTINGS) {
      if (!(k in input)) continue
      if (typeof input[k] !== 'boolean') throw b2bError(400, `${k} must be true or false`)
      patch[k] = input[k]
    }
    return must(await db.from('b2b_campaigns').update(patch).eq('id', c.id).select('*').single(), 'campaign')
  }
  if (input.action) {
    const others = Object.keys(input).filter(k => k !== 'action')
    if (others.length) throw b2bError(400, 'Send an action on its own')
    const move = personAction(input.action, c)
    return must(await db.from('b2b_campaigns').update(move).eq('id', c.id).eq('stage', c.stage).select('*').single(), 'campaign')
  }
  const defTask = c.definition_task_id ? (await tasksById(db, [c.definition_task_id]))[c.definition_task_id] : null
  if (!draftEditable(c, defTask)) throw b2bError(409, `The campaign is at "${c.stage}"; only a draft (or a definition sent back) can be edited`)
  const patch = cleanCampaignPatch(input, await activePeople(db))
  if (!Object.keys(patch).length) return c
  return must(await db.from('b2b_campaigns').update(patch).eq('id', c.id).select('*').single(), 'campaign')
}

/** POST /api/b2b/campaigns/:id/submit: the b2b_definition approval (area outreach) and stage define_review. */
export async function submitCampaign(db, actor, id, { teams = null } = {}) {
  const c = await getCampaign(db, id)
  const defTask = c.definition_task_id ? (await tasksById(db, [c.definition_task_id]))[c.definition_task_id] : null
  if (!draftEditable(c, defTask)) {
    if (defTask && !defTask.decision) throw b2bError(409, 'The definition is already waiting for approval')
    throw b2bError(409, `The campaign is at "${c.stage}"; only a draft can be sent for approval`)
  }
  const problems = submitProblems(c)
  if (problems.length) throw b2bError(400, `Not ready yet: ${problems.join('; ')}`)
  const artefact = definitionArtefact(c)
  const task = await submitForApproval(db, personPrincipal(actor), {
    title: `Definition: ${c.name}`,
    project_id: B2B_PROJECT_ID,
    artefact_type: 'b2b_definition',
    artefact,
    approval_area: B2B_AREA,
    assigned_to: c.approver || undefined,
    description: `B2B campaign definition, sent for approval by ${actor}.`,
  }, { teams })
  const up = must(await db.from('b2b_campaigns').update({ stage: 'define_review', definition_task_id: task.id }).eq('id', c.id).select('*').single(), 'campaign')
  return { campaign: up, task }
}

// ─── replies (people) ───────────────────────────────────────────────────────

export async function listReplies(db, actor, { mine = false, status = 'needs_person' } = {}) {
  let q = db.from('b2b_replies').select('id, campaign_id, prospect_id, kind, summary, draft, assigned_to, due_at, status, created_at').order('due_at', { ascending: true, nullsFirst: false }).limit(500)
  if (status && status !== 'all') q = q.eq('status', status)
  if (mine) q = q.ilike('assigned_to', String(actor || '').trim())
  const rows = must(await q, 'replies')
  const campIds = [...new Set(rows.map(r => r.campaign_id))]
  const prosIds = [...new Set(rows.map(r => r.prospect_id).filter(Boolean))]
  const camps = campIds.length ? must(await db.from('b2b_campaigns').select('id, name').in('id', campIds), 'campaigns') : []
  const pros = prosIds.length ? must(await db.from('b2b_prospects').select('id, name, place, contact').in('id', prosIds), 'prospects') : []
  const cm = Object.fromEntries(camps.map(c => [c.id, c.name]))
  const pm = Object.fromEntries(pros.map(p => [p.id, p]))
  return {
    replies: rows.map(r => ({
      ...r, campaign_name: cm[r.campaign_id] || null,
      prospect: pm[r.prospect_id] ? { name: pm[r.prospect_id].name, place: pm[r.prospect_id].place, contact: cleanContactOut(pm[r.prospect_id].contact) } : null,
      overdue: r.status === 'needs_person' && r.due_at ? new Date(r.due_at).getTime() < Date.now() : false,
    })),
  }
}

/** PATCH /api/b2b/replies/:id { status?: sent|closed|needs_person, draft? }. The person answers from the trade mailbox (Outlook) first. */
export async function patchReply(db, actor, id, input = {}) {
  if (!isUuid(id)) throw b2bError(400, 'reply id must be a UUID')
  const r = must(await db.from('b2b_replies').select('id, status').eq('id', id).maybeSingle(), 'reply')
  if (!r) throw b2bError(404, `No reply ${id}`)
  const patch = {}
  if ('draft' in input) {
    if (input.draft != null && typeof input.draft !== 'string') throw b2bError(400, 'draft must be text')
    patch.draft = input.draft == null ? null : input.draft.slice(0, 10000)
  }
  if ('status' in input) {
    if (!['sent', 'closed', 'needs_person'].includes(input.status)) throw b2bError(400, 'status must be sent, closed or needs_person')
    if (r.status === 'auto') throw b2bError(409, 'HQ handles this reply; nothing for a person to do')
    patch.status = input.status
    if (input.status === 'needs_person') Object.assign(patch, { closed_at: null, closed_by: null })
    else Object.assign(patch, { closed_at: new Date().toISOString(), closed_by: actor })
  }
  if (!Object.keys(patch).length) throw b2bError(400, 'Send status and/or draft')
  return must(await db.from('b2b_replies').update(patch).eq('id', id).select('*').single(), 'reply')
}

// ─── the decide hook ────────────────────────────────────────────────────────

/**
 * Called by lib/pm/approvals.decide once a B2B approval is decided: moves the campaign (lib/b2b.stageAfterDecision)
 * and, for a sample, sets prospect statuses from the lines (reject reason and note kept for HQ to learn from).
 * Only the campaign's current approval of that kind moves it.
 */
export async function afterB2BDecision(db, task, actor) {
  const campaignId = task.artefact && task.artefact.campaign_id
  if (!isUuid(campaignId)) return null
  const c = must(await db.from('b2b_campaigns').select('id, stage, metrics, definition_task_id, sample_task_id, words_task_id, golive_task_id').eq('id', campaignId).maybeSingle(), 'campaign')
  if (!c || c[FK[task.artefact_type]] !== task.id) return null

  if (task.artefact_type === 'b2b_sample') {
    const ids = (task.artefact.prospects || []).map(p => p && p.id).filter(Boolean)
    const out = sampleOutcome(ids, task.line_decisions, task.decision)
    for (let i = 0; i < out.approved.length; i += 200) {
      must(await db.from('b2b_prospects').update({ status: 'approved', reject_reason: null, reject_note: null }).eq('campaign_id', c.id).in('hq_ref', out.approved.slice(i, i + 200)), 'prospects')
    }
    for (const r of out.rejected) {
      must(await db.from('b2b_prospects').update({ status: 'rejected', reject_reason: r.reason, reject_note: r.note }).eq('campaign_id', c.id).eq('hq_ref', r.id), 'prospects')
    }
    if (out.approved.length || out.rejected.length) {
      must(await db.from('b2b_campaigns').update({ metrics: { ...(c.metrics || {}), approved: out.approved.length } }).eq('id', c.id), 'metrics')
    }
  }
  const next = stageAfterDecision(task.artefact_type, task.decision, c.stage)
  if (!next) return { campaign_id: c.id, stage: c.stage, moved: false }
  // Go-live approves the words, the mailboxes and the pace: the chosen mailboxes and the e-mail gaps go on the campaign.
  if (task.artefact_type === 'b2b_golive' && next === 'live') await applyGolive(db, c.id, task)
  must(await db.from('b2b_campaigns').update({ stage: next }).eq('id', c.id).eq('stage', c.stage), 'stage')
  return { campaign_id: c.id, stage: next, moved: true, by: actor }
}

// ─── agent API ──────────────────────────────────────────────────────────────

/**
 * GET /api/agent/b2b/work: campaigns whose stage needs HQ, with the approved definition and learned rules.
 * needs: sample | resubmit_sample | find_and_words | resubmit_words | golive | resubmit_golive | run
 */
export async function agentWork(db) {
  const camps = must(await db.from('b2b_campaigns').select('*').is('archived_at', null)
    .in('stage', ['sampling', 'sample_review', 'finding', 'words_review', 'golive_review', 'live']).order('stage_since'), 'campaigns')
  const tasks = await tasksById(db, camps.flatMap(c => [c.definition_task_id, c.sample_task_id, c.words_task_id, c.golive_task_id]))
  const typeIds = [...new Set(camps.map(c => c.business_type_id).filter(Boolean))]
  const types = typeIds.length ? must(await db.from('b2b_business_types').select('id, slug, name, learned_rules').in('id', typeIds), 'types') : []
  const tmap = Object.fromEntries(types.map(t => [t.id, t]))
  const closedNo = (t) => t && t.decision && !APPROVED_FAMILY.includes(t.decision)
  const out = []
  for (const c of camps) {
    const l = linkedFor(c, tasks)
    let needs = null, notes = null
    if (c.stage === 'sampling') needs = 'sample'
    else if (c.stage === 'sample_review' && closedNo(l.sample)) { needs = 'resubmit_sample'; notes = l.sample.decision_notes }
    else if (c.stage === 'finding') needs = 'find_and_words'
    else if (c.stage === 'words_review' && closedNo(l.words)) { needs = 'resubmit_words'; notes = l.words.decision_notes }
    else if (c.stage === 'words_review' && l.words && APPROVED_FAMILY.includes(l.words.decision)) needs = 'golive'
    else if (c.stage === 'golive_review' && closedNo(l.golive)) { needs = 'resubmit_golive'; notes = l.golive.decision_notes }
    else if (c.stage === 'live') needs = 'run'
    if (!needs) continue
    const item = {
      id: c.id, name: c.name, stage: c.stage, stage_since: c.stage_since, needs, decision_notes: notes || null,
      definition: c.definition, goal: c.goal, offers: c.offers, market: c.market, volume: c.volume, sample_size: c.sample_size, pace: c.pace,
      channels: c.channels, people: c.people, metrics: c.metrics, country_rules: countryRules(c.market && c.market.country),
      business_type: tmap[c.business_type_id] || null,
      words_edits: l.words && APPROVED_FAMILY.includes(l.words.decision) ? l.words.line_decisions : null,
    }
    if (['finding', 'words_review', 'golive_review', 'live'].includes(c.stage) || needs === 'resubmit_sample') {
      const sample = await pageAll(() => db.from('b2b_prospects').select('hq_ref, status, reject_reason, reject_note').eq('campaign_id', c.id).in('status', ['approved', 'rejected']).order('hq_ref'), 5000)
      item.sample_approved = sample.filter(p => p.status === 'approved').map(p => p.hq_ref)
      item.sample_rejected = sample.filter(p => p.status === 'rejected').map(p => ({ hq_ref: p.hq_ref, reason: p.reject_reason, note: p.reject_note }))
    }
    out.push(item)
  }
  return { campaigns: out }
}

function cleanProspect(p, i) {
  const path = `prospects[${i}]`
  if (!isObj(p)) throw b2bError(400, `${path} must be an object`)
  const hq_ref = String(p.hq_ref || '').trim()
  if (!hq_ref) throw b2bError(400, `${path}.hq_ref is required (HQ's id for the business)`)
  const name = String(p.name || '').trim()
  if (!name) throw b2bError(400, `${path}.name (the business) is required`)
  const row = { hq_ref: hq_ref.slice(0, 200), name: name.slice(0, 200) }
  if ('place' in p) row.place = p.place == null ? null : String(p.place).slice(0, 200)
  if ('details' in p) { if (p.details != null && !isObj(p.details)) throw b2bError(400, `${path}.details must be an object`); row.details = p.details || {} }
  if ('sources' in p) {
    if (!Array.isArray(p.sources) || p.sources.some(s => !isObj(s) || !s.label)) throw b2bError(400, `${path}.sources must be [{ label, url }]`)
    row.sources = p.sources.slice(0, 20).map(s => ({ label: String(s.label).slice(0, 120), url: s.url ? String(s.url).slice(0, 500) : null }))
  }
  if ('match' in p) {
    if (!Array.isArray(p.match) || p.match.some(m => !isObj(m) || !m.t)) throw b2bError(400, `${path}.match must be [{ t, ok }]`)
    row.match = p.match.slice(0, 20).map(m => ({ t: String(m.t).slice(0, 120), ok: m.ok !== false }))
  }
  if ('fit' in p) {
    if (p.fit != null && !(Number.isInteger(p.fit) && p.fit >= 0 && p.fit <= 100)) throw b2bError(400, `${path}.fit must be a whole number 0-100`)
    row.fit = p.fit
  }
  if ('contact' in p) row.contact = cleanContact(p.contact, `${path}.contact`)
  if ('status' in p) {
    if (!PROSPECT_STATUSES.includes(p.status)) throw b2bError(400, `${path}.status must be one of ${PROSPECT_STATUSES.join(', ')}`)
    row.status = p.status
  }
  if ('excluded_reason' in p) row.excluded_reason = p.excluded_reason == null ? null : String(p.excluded_reason).slice(0, 300)
  if (hasContactDetails(JSON.stringify(row.details || {}))) throw b2bError(400, `${path}.details must not carry e-mail addresses or phone numbers`)
  return row
}

/** Insert new prospects, update existing ones (only the columns sent), keyed on (campaign, hq_ref). */
async function saveProspects(db, campaignId, rows) {
  const refs = rows.map(r => r.hq_ref)
  if (new Set(refs).size !== refs.length) throw b2bError(400, 'Each hq_ref may appear only once per call')
  const existing = new Set()
  const hasContact = {}
  for (let i = 0; i < refs.length; i += 200) {
    for (const r of must(await db.from('b2b_prospects').select('hq_ref, contact').eq('campaign_id', campaignId).in('hq_ref', refs.slice(i, i + 200)), 'prospect lookup')) {
      existing.add(r.hq_ref)
      hasContact[r.hq_ref] = !!(r.contact && r.contact.has_contact)
    }
  }
  // has_contact is PM's (from b2b_contacts): new businesses start without one; HQ's updates never change it.
  const fresh = rows.filter(r => !existing.has(r.hq_ref)).map(r => ({ status: 'found', ...r, ...(r.contact ? { contact: { ...r.contact, has_contact: false } } : {}), campaign_id: campaignId }))
  for (let i = 0; i < fresh.length; i += 200) must(await db.from('b2b_prospects').insert(fresh.slice(i, i + 200)), 'insert prospects')
  for (const r of rows.filter(x => existing.has(x.hq_ref))) {
    const { hq_ref, ...patch } = r
    if (patch.contact) patch.contact = { ...patch.contact, has_contact: hasContact[hq_ref] }
    if (Object.keys(patch).length) must(await db.from('b2b_prospects').update(patch).eq('campaign_id', campaignId).eq('hq_ref', hq_ref), 'update prospect')
  }
  return { upserted: rows.length, created: fresh.length, updated: rows.length - fresh.length }
}

/** POST /api/agent/b2b/campaigns/:id/prospects { prospects: [...] }: bulk upsert on hq_ref (the rest, after the sample). */
export async function upsertProspects(db, id, body = {}) {
  const c = await getCampaign(db, id, 'id, stage')
  if (['draft', 'define_review', 'cancelled'].includes(c.stage)) throw b2bError(409, `The campaign is at "${c.stage}"; no prospects until the definition is approved`)
  const list = Array.isArray(body) ? body : body.prospects
  if (!Array.isArray(list) || !list.length) throw b2bError(400, 'Send { prospects: [...] } with at least one prospect')
  if (list.length > MAX_BATCH) throw b2bError(400, `At most ${MAX_BATCH} prospects per call`)
  return saveProspects(db, c.id, list.map(cleanProspect))
}

async function postApproval(db, principal, id, kind, artefactBody, { teams, title }) {
  const p = AGENT_POSTS[kind]
  const c = await getCampaign(db, id)
  const tasks = await tasksById(db, [c[p.fk], c.words_task_id])
  const blocked = postBlocked(kind, c, tasks[c[p.fk]] || null, tasks[c.words_task_id] || null)
  if (blocked) throw b2bError(409, blocked)
  const artefact = { ...artefactBody, campaign_id: c.id }
  const v = validateArtefact(p.type, artefact)
  if (!v.valid) throw b2bError(400, v.error)
  return { c, artefact, submit: async () => {
    const task = await submitForApproval(db, principal, {
      title: title(c), project_id: B2B_PROJECT_ID, artefact_type: p.type, artefact, approval_area: B2B_AREA,
      assigned_to: c.approver || undefined, description: `B2B campaign "${c.name}": ${kind} from ${principal.agent_id || principal.actor}.`,
    }, { teams })
    const up = must(await db.from('b2b_campaigns').update({ stage: p.to, [p.fk]: task.id }).eq('id', c.id).eq('stage', c.stage).select('id, stage').maybeSingle(), 'campaign')
    if (!up) throw b2bError(409, 'The campaign moved while this was being posted; read /api/agent/b2b/work and try again')
    return { campaign_id: c.id, stage: up.stage, task }
  } }
}

/** POST /api/agent/b2b/campaigns/:id/sample { prospects[], excluded_count, excluded_note }: stores them and creates the b2b_sample approval. */
export async function postSample(db, principal, id, body = {}, { teams = null } = {}) {
  const list = body.prospects
  if (!Array.isArray(list) || !list.length) throw b2bError(400, 'Send { prospects: [...] } with at least one prospect')
  if (list.length > 200) throw b2bError(400, 'A sample has at most 200 prospects')
  const rows = list.map(cleanProspect).map(r => ({ ...r, status: 'sample' }))
  const artefactBody = {
    prospects: rows.map(r => ({ id: r.hq_ref, name: r.name, place: r.place || undefined, details: r.details, sources: r.sources, match: r.match, contact: r.contact, fit: r.fit ?? undefined })),
  }
  for (const k of ['excluded_count', 'excluded_note', 'checks', 'why', 'evidence']) if (body[k] != null) artefactBody[k] = body[k]
  for (const p of artefactBody.prospects) for (const k of Object.keys(p)) if (p[k] == null) delete p[k]
  const n = rows.length
  const job = await postApproval(db, principal, id, 'sample', artefactBody, { teams, title: (c) => `Sample: ${n} found for ${c.name}` })
  const saved = await saveProspects(db, job.c.id, rows)
  const res = await job.submit()
  return { ...res, prospects: saved }
}

/** POST /api/agent/b2b/campaigns/:id/sequence { emails[], flow[], branches[], sending, checks[] }: the b2b_sequence approval. */
export async function postSequence(db, principal, id, body = {}, { teams = null } = {}) {
  const { campaign_id, ...rest } = isObj(body) ? body : {}
  const job = await postApproval(db, principal, id, 'sequence', rest, { teams, title: (c) => `Emails and flow: ${c.name}` })
  return job.submit()
}

/** POST /api/agent/b2b/campaigns/:id/golive { total, contacts_missing, first_batch[], send_times, checks[] }: the b2b_golive approval. */
export async function postGolive(db, principal, id, body = {}, { teams = null } = {}) {
  const { campaign_id, mailboxes, send_gaps, ...posted } = isObj(body) ? body : {}
  // PM adds what only it knows: the trade mailboxes to choose from, the day of each e-mail and the real count of
  // businesses still without a usable contact (HQ never sees addresses).
  const camp = await getCampaign(db, id)
  const reachable = await pageAll(() => db.from('b2b_prospects').select('id, status, contact').eq('campaign_id', camp.id).in('status', ['approved', 'found', 'queued']).order('id'), 20000)
  const rest = { ...posted, ...(await goliveExtras(db, camp)), contacts_missing: reachable.filter(needsContact).length }
  const job = await postApproval(db, principal, id, 'golive', rest, { teams, title: (c) => `Go live: ${c.name}` })
  const res = await job.submit()
  const c = job.c
  const missing = Number(rest.contacts_missing) || 0
  must(await db.from('b2b_campaigns').update({ metrics: { ...(c.metrics || {}), contacts_missing: missing, ...(rest.total != null ? { found: rest.total } : {}) } }).eq('id', c.id), 'metrics')
  // Contacts to add: a task for the campaign owner, not an error (contract, hard rules).
  if (missing > 0) {
    const owner = c.owner || c.created_by
    try {
      await createTask(db, principal, {
        title: `Add ${missing} contact${missing === 1 ? '' : 's'}: ${c.name}`, project_id: B2B_PROJECT_ID, assigned_to: owner || undefined,
        external_ref: `b2b:${c.id}:contacts`, priority: 'medium',
        description: 'These businesses are on the go-live list but PM has no address it can use yet (none found on their website, or one waiting to be accepted). Add or accept a contact on the campaign in doddl HQ → B2B campaigns → Contacts to add; it is mailed from then on.',
      })
      if (owner) await notify(db, owner, { type: 'b2b_contacts', task: res.task, body: `${missing} contact${missing === 1 ? '' : 's'} to add for ${c.name}` })
    } catch (e) {
      console.error('b2b: contacts task failed:', e.message)
    }
  }
  return res
}

/** PATCH /api/agent/b2b/campaigns/:id { metrics?, estimate?, stage? }: metrics merge; stage only per AGENT_STAGE_MOVES. */
export async function agentPatchCampaign(db, id, body = {}) {
  const c = await getCampaign(db, id, 'id, stage, metrics, estimate')
  const patch = {}
  if (body.metrics != null) {
    if (!isObj(body.metrics)) throw b2bError(400, 'metrics must be an object')
    const bad = Object.entries(body.metrics).filter(([k, v]) => !METRIC_KEYS.includes(k) || !(Number.isInteger(v) && v >= 0))
    if (bad.length) throw b2bError(400, `metrics take whole numbers for ${METRIC_KEYS.join(', ')} (not ${bad.map(([k]) => k).join(', ')})`)
    patch.metrics = { ...(c.metrics || {}), ...body.metrics }
  }
  if (body.estimate != null) {
    if (!isObj(body.estimate)) throw b2bError(400, 'estimate must be { found, match, contact, after_rules }')
    const e = {}
    for (const k of ['found', 'match', 'contact', 'after_rules']) if (body.estimate[k] != null) e[k] = String(body.estimate[k]).slice(0, 60)
    patch.estimate = e
  }
  if (body.stage != null) {
    if (!STAGES.includes(body.stage)) throw b2bError(400, `stage must be one of ${STAGES.join(', ')}`)
    if (body.stage !== c.stage) {
      const ok = (AGENT_STAGE_MOVES[c.stage] || []).includes(body.stage)
      if (!ok) throw b2bError(409, `An agent cannot move a campaign from "${c.stage}" to "${body.stage}" here (sample, sequence and go-live posts move it; people pause and cancel)`)
      patch.stage = body.stage
    }
  }
  const extra = Object.keys(body).filter(k => !['metrics', 'estimate', 'stage'].includes(k))
  if (extra.length) throw b2bError(400, `Unknown field ${extra.join(', ')}: send metrics, estimate or stage`)
  if (!Object.keys(patch).length) throw b2bError(400, 'Nothing to change')
  return must(await db.from('b2b_campaigns').update(patch).eq('id', c.id).select('id, stage, stage_since, metrics, estimate').single(), 'campaign')
}

/**
 * POST /api/agent/b2b/replies { replies: [{ campaign_id, prospect_hq_ref | prospect_id, kind, summary, draft?, assigned_to?, due_at?, ref? }] }.
 * (PM's inbox poller creates replies itself now; this route stays for HQ. ref de-duplicates and is kept in the legacy
 * b2b_replies.hubspot_ref column, which migration 27 left in place because columns are never dropped.)
 * A reply needing a person goes to people.replies (people.calls for "owner"), due in 1 working day (owner: same day).
 * Opt-outs, bounces, out-of-office and not-interested are status auto: HQ handles them, no person.
 */
export async function addReplies(db, body = {}) {
  const list = Array.isArray(body) ? body : body.replies
  if (!Array.isArray(list) || !list.length) throw b2bError(400, 'Send { replies: [...] } with at least one reply')
  if (list.length > 200) throw b2bError(400, 'At most 200 replies per call')
  const people = await activePeople(db)
  const campCache = {}
  const out = []
  for (const [i, r] of list.entries()) {
    const path = `replies[${i}]`
    if (!isObj(r)) throw b2bError(400, `${path} must be an object`)
    if (!REPLY_KINDS.includes(r.kind)) throw b2bError(400, `${path}.kind must be one of ${REPLY_KINDS.join(', ')}`)
    if (!isUuid(r.campaign_id)) throw b2bError(400, `${path}.campaign_id must be a campaign UUID`)
    const c = campCache[r.campaign_id] || (campCache[r.campaign_id] = await getCampaign(db, r.campaign_id, 'id, name, people, owner, created_by'))
    if (r.summary != null && hasContactDetails(r.summary)) throw b2bError(400, `${path}.summary must not carry e-mail addresses or phone numbers`)
    if (r.draft != null && hasContactDetails(r.draft, { allowDoddl: true })) throw b2bError(400, `${path}.draft must not carry the contact's e-mail address or phone number`)
    let prospect = null
    if (r.prospect_id || r.prospect_hq_ref) {
      const q = db.from('b2b_prospects').select('id, status').eq('campaign_id', c.id)
      prospect = must(await (r.prospect_id ? q.eq('id', r.prospect_id) : q.eq('hq_ref', String(r.prospect_hq_ref))).maybeSingle(), 'prospect')
      if (!prospect) throw b2bError(400, `${path}: no prospect ${r.prospect_id || r.prospect_hq_ref} in this campaign`)
    }
    const ref = r.ref || r.hubspot_ref || null
    if (ref) {
      const dup = must(await db.from('b2b_replies').select('id, status').eq('campaign_id', c.id).eq('hubspot_ref', String(ref)).maybeSingle(), 'reply lookup')
      if (dup) { out.push({ id: dup.id, created: false, status: dup.status }); continue }
    }
    const auto = AUTO_REPLY_KINDS.includes(r.kind)
    let assigned = null
    if (!auto) {
      const want = r.assigned_to || (r.kind === 'owner' ? (c.people || {}).calls : (c.people || {}).replies) || c.owner || c.created_by
      assigned = people.find(n => same(n, want)) || null
      if (r.assigned_to && !assigned) throw b2bError(400, `${path}.assigned_to "${r.assigned_to}" is not a doddl person`)
    }
    let due = null
    if (!auto) {
      if (r.due_at != null) { const t = new Date(r.due_at); if (Number.isNaN(t.getTime())) throw b2bError(400, `${path}.due_at must be an ISO date-time`); due = t.toISOString() }
      else due = replyDueAt(r.kind).toISOString()
    }
    const row = {
      campaign_id: c.id, prospect_id: prospect ? prospect.id : null, kind: r.kind,
      summary: r.summary == null ? null : String(r.summary).slice(0, 2000), draft: r.draft == null ? null : String(r.draft).slice(0, 10000),
      assigned_to: assigned, due_at: due, status: auto ? 'auto' : 'needs_person', hubspot_ref: ref ? String(ref).slice(0, 200) : null,
    }
    const ins = must(await db.from('b2b_replies').insert([row]).select('id, status, assigned_to, due_at').single(), 'reply')
    if (prospect) {
      const st = r.kind === 'optout' ? 'opted_out' : r.kind === 'bounce' ? 'bounced' : 'replied'
      must(await db.from('b2b_prospects').update({ status: st }).eq('id', prospect.id), 'prospect status')
    }
    if (assigned) await notify(db, assigned, { type: 'b2b_reply', task: null, body: `A reply on ${c.name} needs you${r.summary ? `: ${String(r.summary).slice(0, 200)}` : ''}` })
    out.push({ ...ins, created: true })
  }
  return { added: out.filter(x => x.created).length, replies: out }
}

export { SAMPLE_REASON_IDS, ACTIVE_STAGES }
