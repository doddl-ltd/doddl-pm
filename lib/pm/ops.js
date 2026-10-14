// PM operations shared by the agent REST API (pages/api/agent/*), the MCP
// endpoint (pages/api/mcp.js) and the triage screen (pages/api/triage.js).
// One implementation, so every door enforces the same rules:
//   - tasks must belong to a live project; groups must belong to that project
//   - assignees must be real people (also enforced by DB trigger)
//   - marking a task done needs evidence (a link) — "never mark done without
//     verifying the work exists" is now checked, not just requested
//   - external_ref makes creates idempotent, so retries never duplicate
//   - approved/rejected artefacts are immutable (also enforced by DB trigger)
//   - nothing is ever hard-deleted
//
// Every function takes a service-role client built with the caller's actor
// (lib/server/admin.js) so task_history records who did what.

import { validateArtefact } from '../artefactTypes'

export const STATUSES   = ['not_started', 'in_progress', 'on_track', 'at_risk', 'blocked', 'done']
export const PRIORITIES = ['low', 'medium', 'high', 'critical']
export const LINK_KINDS = ['commit', 'pr', 'artifact', 'doc', 'deploy', 'email', 'meeting', 'file', 'link']
export const INBOX_SOURCES = ['email', 'teams', 'teamsmaestro', 'meeting', 'agent', 'manual']
export const TASK_SOURCES  = ['manual', 'email', 'teams', 'teamsmaestro', 'meeting', 'agent']

const TASK_LIST_FIELDS = 'id, title, status, progress, priority, assigned_to, project_id, group_id, due_date, start_date, updated_at, external_ref, task_type, decision'
const MAX_LIMIT = 200

export function pmError(status, message) {
  const e = new Error(message)
  e.status = status
  e.expose = true
  return e
}

function must(result, what) {
  if (result.error) throw pmError(500, `${what}: ${result.error.message}`)
  return result.data
}

function clampLimit(limit, dflt = 50) {
  const n = Number(limit)
  if (!Number.isFinite(n) || n <= 0) return dflt
  return Math.min(Math.floor(n), MAX_LIMIT)
}

function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

function isIsoDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
}

// Name an author for comments / triage: the person a session acts for, or the agent.
export function actorName(principal) {
  if (!principal) return 'system'
  if (principal.on_behalf_of) return principal.actor
  return principal.actor || principal.agent_id || 'agent'
}

export function guessLinkKind(url) {
  const u = String(url).toLowerCase()
  if (/\/pull\/\d+|\/merge_requests\/\d+/.test(u)) return 'pr'
  if (/\/commit\/[0-9a-f]{7,}|@[0-9a-f]{7,40}$/.test(u)) return 'commit'
  if (u.includes('claude.ai/') && u.includes('artifact')) return 'artifact'
  if (u.includes('vercel.app') || u.includes('myshopify.com')) return 'deploy'
  if (u.startsWith('pm-inbox:')) return 'meeting'
  if (/\.(md|docx|pdf|xlsx|pptx)$/.test(u) || u.includes('docs.google.com') || u.includes('sharepoint.com')) return 'doc'
  return 'link'
}

// ─── lookups ────────────────────────────────────────────────────────────────

export async function resolveProject(db, { project_id, project } = {}) {
  if (project_id) {
    if (!isUuid(project_id)) throw pmError(400, 'project_id must be a UUID')
    const row = must(await db.from('projects').select('id, name, archived_at').eq('id', project_id).maybeSingle(), 'project lookup')
    if (!row || row.archived_at) throw pmError(404, `No live project with id ${project_id}. Call list_projects.`)
    return row
  }
  if (project) {
    const name = String(project).trim()
    const exact = must(await db.from('projects').select('id, name').is('archived_at', null).ilike('name', name), 'project lookup')
    if (exact.length === 1) return exact[0]
    const fuzzy = must(await db.from('projects').select('id, name').is('archived_at', null).ilike('name', `%${name}%`), 'project lookup')
    if (fuzzy.length === 1) return fuzzy[0]
    if (fuzzy.length > 1) throw pmError(409, `"${name}" matches several projects: ${fuzzy.map(p => p.name).join('; ')}. Use project_id.`)
    throw pmError(404, `No project matches "${name}". Call list_projects.`)
  }
  return null
}

async function resolveGroup(db, projectId, { group_id, group } = {}) {
  if (!group_id && !group) return null
  let q = db.from('task_groups').select('id, name, project_id').eq('project_id', projectId).is('archived_at', null)
  q = group_id ? q.eq('id', group_id) : q.ilike('name', String(group).trim())
  const rows = must(await q, 'group lookup')
  if (rows.length === 1) return rows[0]
  const all = must(await db.from('task_groups').select('name').eq('project_id', projectId).is('archived_at', null), 'group list')
  throw pmError(404, `No such group in this project. Groups: ${all.map(g => g.name).join('; ') || '(none)'}`)
}

export async function listPeople(db) {
  return must(await db.from('people').select('name, email, kind').eq('active', true).order('name'), 'people')
}

async function personForEmail(db, email) {
  if (!email) return null
  const row = must(await db.from('people').select('name').ilike('email', String(email).trim()).maybeSingle(), 'person lookup')
  return row ? row.name : null
}

// ─── projects ───────────────────────────────────────────────────────────────

export async function listProjects(db, { status } = {}) {
  let q = db.from('projects').select('id, name, description, status, priority, owner, start_date, due_date, updated_at').is('archived_at', null).order('name')
  if (status) q = q.eq('status', status)
  const projects = must(await q, 'projects')

  // Open/total counts, paged past PostgREST's 1000-row cap.
  const counts = {}
  for (let from = 0; ; from += 1000) {
    const rows = must(await db.from('tasks').select('project_id, status').is('archived_at', null).eq('is_group', false).range(from, from + 999), 'task counts')
    for (const r of rows) {
      const c = counts[r.project_id] || (counts[r.project_id] = { total: 0, open: 0 })
      c.total++
      if (r.status !== 'done') c.open++
    }
    if (rows.length < 1000) break
  }
  return projects.map(p => ({ ...p, tasks_total: counts[p.id]?.total || 0, tasks_open: counts[p.id]?.open || 0 }))
}

// ─── tasks ──────────────────────────────────────────────────────────────────

export async function findTasks(db, args = {}) {
  const limit = clampLimit(args.limit)
  const offset = Math.max(0, Number(args.offset) || 0)
  let q = db.from('tasks').select(`${TASK_LIST_FIELDS}, projects(name)`, { count: 'exact' })
    .is('archived_at', null).eq('is_group', false)

  const proj = await resolveProject(db, args)
  if (proj) q = q.eq('project_id', proj.id)
  if (args.assigned_to) q = q.ilike('assigned_to', String(args.assigned_to).trim())
  const statuses = args.status ? [].concat(args.status) : null
  if (statuses) {
    const bad = statuses.filter(s => !STATUSES.includes(s))
    if (bad.length) throw pmError(400, `Unknown status ${bad.join(', ')}. Valid: ${STATUSES.join(', ')}`)
    q = q.in('status', statuses)
  } else if (!args.include_done) {
    q = q.neq('status', 'done')
  }
  if (args.q) q = q.ilike('title', `%${String(args.q).trim()}%`)
  if (args.external_ref) q = q.eq('external_ref', args.external_ref)
  if (args.updated_since) q = q.gte('updated_at', args.updated_since)

  const { data, error, count } = await q.order('updated_at', { ascending: false }).range(offset, offset + limit - 1)
  if (error) throw pmError(500, `task search: ${error.message}`)
  const tasks = data.map(({ projects, ...t }) => ({ ...t, project: projects ? projects.name : null }))
  return { total: count ?? tasks.length, offset, limit, tasks }
}

export async function getTask(db, id) {
  if (!isUuid(id)) throw pmError(400, 'task id must be a UUID')
  const task = must(await db.from('tasks').select('*, projects(name), task_groups(name)').eq('id', id).maybeSingle(), 'task')
  if (!task) throw pmError(404, `No task ${id}`)
  const [links, comments, history] = await Promise.all([
    db.from('task_links').select('url, kind, label, added_by, created_at').eq('task_id', id).order('created_at'),
    db.from('comments').select('author, body, created_at').eq('task_id', id).order('created_at', { ascending: false }).limit(20),
    db.from('task_history').select('op, actor, changed, created_at').eq('task_id', id).order('created_at', { ascending: false }).limit(20),
  ])
  const { projects, task_groups, ...rest } = task
  return {
    ...rest,
    project: projects ? projects.name : null,
    group: task_groups ? task_groups.name : null,
    links: must(links, 'links'),
    recent_comments: must(comments, 'comments'),
    recent_history: must(history, 'history').map(h => ({
      ...h,
      // Insert/delete rows carry the whole task; keep the summary readable.
      changed: h.op === 'update' ? h.changed : { title: h.changed && h.changed.title },
    })),
  }
}

function validateTaskFields(input, { creating }) {
  const out = {}
  if (input.title !== undefined) {
    const t = String(input.title || '').trim()
    if (!t) throw pmError(400, 'title must not be empty')
    if (t.length > 300) throw pmError(400, 'title is too long (max 300 characters)')
    out.title = t
  } else if (creating) {
    throw pmError(400, 'title is required')
  }
  if (input.description !== undefined) out.description = input.description == null ? null : String(input.description)
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) throw pmError(400, `status must be one of ${STATUSES.join(', ')}`)
    out.status = input.status
  }
  if (input.priority !== undefined) {
    if (!PRIORITIES.includes(input.priority)) throw pmError(400, `priority must be one of ${PRIORITIES.join(', ')}`)
    out.priority = input.priority
  }
  if (input.progress !== undefined) {
    const p = Number(input.progress)
    if (!Number.isInteger(p) || p < 0 || p > 100) throw pmError(400, 'progress must be a whole number 0-100')
    out.progress = p
  }
  for (const f of ['due_date', 'start_date']) {
    if (input[f] !== undefined) {
      if (input[f] !== null && !isIsoDate(input[f])) throw pmError(400, `${f} must be YYYY-MM-DD or null`)
      out[f] = input[f]
    }
  }
  if (input.assigned_to !== undefined) out.assigned_to = input.assigned_to ? String(input.assigned_to).trim() : null
  return out
}

async function addEvidence(db, principal, taskId, evidence) {
  const list = [].concat(evidence || []).filter(Boolean)
  for (const ev of list) {
    const url = typeof ev === 'string' ? ev : ev.url
    if (!url || !String(url).trim()) continue
    const kind = (typeof ev === 'object' && LINK_KINDS.includes(ev.kind)) ? ev.kind : guessLinkKind(url)
    const label = typeof ev === 'object' ? ev.label || null : null
    const r = await db.from('task_links').upsert(
      { task_id: taskId, url: String(url).trim(), kind, label, added_by: actorName(principal) },
      { onConflict: 'task_id,url', ignoreDuplicates: true },
    )
    if (r.error) throw pmError(500, `link: ${r.error.message}`)
  }
  return list.length
}

async function linkCount(db, taskId) {
  const { count, error } = await db.from('task_links').select('id', { count: 'exact', head: true }).eq('task_id', taskId)
  if (error) throw pmError(500, `link count: ${error.message}`)
  return count || 0
}

function needsEvidence(fields) {
  return fields.status === 'done' || fields.progress === 100
}

export async function createTask(db, principal, input = {}) {
  const fields = validateTaskFields(input, { creating: true })
  const externalRef = input.external_ref ? String(input.external_ref).trim() : null

  if (externalRef) {
    const existing = must(await db.from('tasks').select(TASK_LIST_FIELDS).eq('external_ref', externalRef).maybeSingle(), 'external_ref lookup')
    if (existing) return { task: existing, created: false }
  }

  const project = await resolveProject(db, input)
  if (!project) throw pmError(400, 'project_id or project (name) is required — every task belongs to a project. Call list_projects.')
  const group = await resolveGroup(db, project.id, input)

  if (needsEvidence(fields) && ![].concat(input.evidence || []).filter(Boolean).length) {
    throw pmError(422, 'Creating a task as done needs evidence: pass evidence (URL, commit ref or file path) showing the work exists.')
  }

  const last = must(await db.from('tasks').select('position').eq('project_id', project.id).order('position', { ascending: false }).limit(1), 'position')
  const row = {
    status: 'not_started',
    priority: 'medium',
    ...fields,
    project_id: project.id,
    group_id: group ? group.id : null,
    parent_id: input.parent_id && isUuid(input.parent_id) ? input.parent_id : null,
    position: ((last[0] && last[0].position) || 0) + 1,
    source: TASK_SOURCES.includes(input.source) ? input.source : (principal && principal.agent_id ? 'agent' : 'manual'),
    agent_id: principal ? principal.agent_id || null : null,
    task_type: 'standard',
    external_ref: externalRef,
  }

  const ins = await db.from('tasks').insert([row]).select(TASK_LIST_FIELDS).single()
  if (ins.error) {
    // Lost a race on the same external_ref: return the winner.
    if (ins.error.code === '23505' && externalRef) {
      const existing = must(await db.from('tasks').select(TASK_LIST_FIELDS).eq('external_ref', externalRef).maybeSingle(), 'external_ref lookup')
      if (existing) return { task: existing, created: false }
    }
    if (ins.error.code === '23503') throw pmError(400, ins.error.message)
    throw pmError(500, `create task: ${ins.error.message}`)
  }
  await addEvidence(db, principal, ins.data.id, input.evidence)
  if (input.note) await addNote(db, principal, ins.data.id, input.note)
  return { task: { ...ins.data, project: project.name, group: group ? group.name : null }, created: true }
}

export async function updateTask(db, principal, id, input = {}) {
  if (!isUuid(id)) throw pmError(400, 'task id must be a UUID')
  const existing = must(await db.from('tasks').select('id, project_id, status, progress, archived_at, decision').eq('id', id).maybeSingle(), 'task lookup')
  if (!existing) throw pmError(404, `No task ${id}`)
  if (existing.archived_at) throw pmError(409, 'Task is archived')

  const fields = validateTaskFields(input, { creating: false })
  if (input.group_id !== undefined || input.group !== undefined) {
    const group = (input.group_id === null || input.group === null) ? null : await resolveGroup(db, existing.project_id, input)
    fields.group_id = group ? group.id : null
  }

  const supplied = await addEvidence(db, principal, id, input.evidence)
  if (needsEvidence(fields) && existing.status !== 'done' && !supplied && (await linkCount(db, id)) === 0) {
    throw pmError(422, 'Marking a task done needs evidence: pass evidence (URL, commit ref or file path) showing the work exists, or call add_link first.')
  }

  let task = null
  if (Object.keys(fields).length) {
    const up = await db.from('tasks').update(fields).eq('id', id).select(TASK_LIST_FIELDS).single()
    if (up.error) {
      if (up.error.code === '23503' || up.error.code === 'P0001') throw pmError(400, up.error.message)
      throw pmError(500, `update task: ${up.error.message}`)
    }
    task = up.data
  } else {
    task = must(await db.from('tasks').select(TASK_LIST_FIELDS).eq('id', id).single(), 'task')
  }
  if (input.note) await addNote(db, principal, id, input.note)
  return task
}

export async function addNote(db, principal, taskId, body) {
  if (!isUuid(taskId)) throw pmError(400, 'task id must be a UUID')
  const text = String(body || '').trim()
  if (!text) throw pmError(400, 'note must not be empty')
  if (text.length > 10000) throw pmError(400, 'note is too long (max 10,000 characters)')
  const r = await db.from('comments').insert([{ task_id: taskId, author: actorName(principal), body: text, mentions: [] }]).select('id, author, body, created_at').single()
  if (r.error) {
    if (r.error.code === '23503') throw pmError(404, `No task ${taskId}`)
    throw pmError(500, `note: ${r.error.message}`)
  }
  return r.data
}

export async function addLink(db, principal, taskId, { url, kind, label } = {}) {
  if (!isUuid(taskId)) throw pmError(400, 'task id must be a UUID')
  if (!url || !String(url).trim()) throw pmError(400, 'url is required')
  if (kind && !LINK_KINDS.includes(kind)) throw pmError(400, `kind must be one of ${LINK_KINDS.join(', ')}`)
  const exists = must(await db.from('tasks').select('id').eq('id', taskId).maybeSingle(), 'task lookup')
  if (!exists) throw pmError(404, `No task ${taskId}`)
  await addEvidence(db, principal, taskId, [{ url, kind, label }])
  return must(await db.from('task_links').select('url, kind, label, added_by, created_at').eq('task_id', taskId).order('created_at'), 'links')
}

// ─── approvals ──────────────────────────────────────────────────────────────

export async function submitForApproval(db, principal, input = {}) {
  const v = validateArtefact(input.artefact_type, input.artefact)
  if (!v.valid) throw pmError(400, v.error)
  if (input.staging_url != null && typeof input.staging_url !== 'string') throw pmError(400, 'staging_url must be a string')

  let taskId = input.task_id
  if (taskId) {
    const t = must(await db.from('tasks').select('id, decision, archived_at').eq('id', taskId).maybeSingle(), 'task lookup')
    if (!t) throw pmError(404, `No task ${taskId}`)
    if (t.archived_at) throw pmError(409, 'Task is archived')
    if (t.decision) throw pmError(409, `Task already has a decision (${t.decision}) and is immutable. Submit the revision as a new approval task.`)
  } else {
    const { task } = await createTask(db, principal, { ...input, status: 'not_started', evidence: undefined })
    taskId = task.id
  }
  const up = await db.from('tasks').update({
    task_type: 'approval',
    artefact_type: input.artefact_type,
    artefact: input.artefact,
    staging_url: input.staging_url || null,
    agent_id: principal ? principal.agent_id : null,
  }).eq('id', taskId).select('id, title, task_type, artefact_type, decision').single()
  if (up.error) throw pmError(up.error.code === 'P0001' ? 409 : 500, up.error.message)
  return up.data
}

export async function getDecision(db, taskId) {
  if (!isUuid(taskId)) throw pmError(400, 'task id must be a UUID')
  const t = must(await db.from('tasks').select('id, title, task_type, decision, decision_by, decision_at, decision_notes').eq('id', taskId).maybeSingle(), 'task')
  if (!t) throw pmError(404, `No task ${taskId}`)
  return { ...t, pending: t.task_type === 'approval' && !t.decision }
}

// ─── inbox (capture -> triage) ──────────────────────────────────────────────

function normaliseActions(actions) {
  if (actions == null) return []
  if (!Array.isArray(actions)) throw pmError(400, 'proposed_actions must be an array')
  return actions.slice(0, 50).map((a, i) => {
    if (!a || typeof a !== 'object') throw pmError(400, `proposed_actions[${i}] must be an object`)
    const kind = a.kind || 'create_task'
    if (!['create_task', 'update_task'].includes(kind)) throw pmError(400, `proposed_actions[${i}].kind must be create_task or update_task`)
    if (kind === 'create_task' && !String(a.title || '').trim()) throw pmError(400, `proposed_actions[${i}].title is required`)
    if (kind === 'update_task' && !isUuid(a.task_id)) throw pmError(400, `proposed_actions[${i}].task_id must be a task UUID`)
    if (a.due_date != null && !isIsoDate(a.due_date)) throw pmError(400, `proposed_actions[${i}].due_date must be YYYY-MM-DD or null`)
    return { ...a, kind }
  })
}

export async function captureInbox(db, principal, input = {}) {
  const source = input.source || 'agent'
  if (!INBOX_SOURCES.includes(source)) throw pmError(400, `source must be one of ${INBOX_SOURCES.join(', ')}`)
  const title = String(input.title || '').trim()
  if (!title) throw pmError(400, 'title is required')
  const sourceRef = input.source_ref ? String(input.source_ref).slice(0, 500) : null

  if (sourceRef) {
    const dup = must(await db.from('inbox_items').select('id, status').eq('source', source).eq('source_ref', sourceRef).maybeSingle(), 'inbox lookup')
    if (dup) return { id: dup.id, created: false, status: dup.status }
  }

  const actions = normaliseActions(input.proposed_actions)
  for (const a of actions) {
    if (!a.assigned_to && a.owner_email) a.assigned_to = await personForEmail(db, a.owner_email)
  }
  const row = {
    source,
    source_ref: sourceRef,
    title: title.slice(0, 300),
    summary: input.summary ? String(input.summary).slice(0, 5000) : null,
    body: input.body ? String(input.body).slice(0, 50000) : null,
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
    participants: Array.isArray(input.participants) ? input.participants.map(String).slice(0, 100) : [],
    occurred_at: input.occurred_at || null,
    proposed_actions: actions,
    assigned_to: input.assigned_to || null,
    created_by: actorName(principal),
  }
  const ins = await db.from('inbox_items').insert([row]).select('id').single()
  if (ins.error) {
    if (ins.error.code === '23505' && sourceRef) {
      const dup = must(await db.from('inbox_items').select('id, status').eq('source', source).eq('source_ref', sourceRef).maybeSingle(), 'inbox lookup')
      if (dup) return { id: dup.id, created: false, status: dup.status }
    }
    throw pmError(ins.error.code === '23503' ? 400 : 500, `capture: ${ins.error.message}`)
  }
  return { id: ins.data.id, created: true, status: 'new' }
}

export async function listInbox(db, { status = 'new', limit, offset } = {}) {
  const lim = clampLimit(limit)
  const off = Math.max(0, Number(offset) || 0)
  let q = db.from('inbox_items').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(off, off + lim - 1)
  const statuses = [].concat(status || []).flatMap(s => String(s).split(',')).filter(Boolean)
  if (statuses.length && !statuses.includes('all')) q = q.in('status', statuses)
  const { data, error, count } = await q
  if (error) throw pmError(500, `inbox: ${error.message}`)
  return { total: count ?? data.length, offset: off, limit: lim, items: data }
}

// decision: 'accept' | 'dismiss'
// accept_actions: indexes of proposed_actions to accept (default: all)
// edits: { [index]: { title, assigned_to, due_date, project_id, project, group, ... } }
export async function triageInbox(db, principal, id, input = {}) {
  if (!isUuid(id)) throw pmError(400, 'inbox item id must be a UUID')
  const item = must(await db.from('inbox_items').select('*').eq('id', id).maybeSingle(), 'inbox item')
  if (!item) throw pmError(404, `No inbox item ${id}`)
  if (!['new', 'partial'].includes(item.status)) throw pmError(409, `Item already ${item.status}`)
  const who = actorName(principal)

  if (input.decision === 'dismiss') {
    const up = must(await db.from('inbox_items').update({
      status: 'dismissed', triaged_by: who, triaged_at: new Date().toISOString(), triage_notes: input.notes || null,
    }).eq('id', id).select('id, status').single(), 'dismiss')
    return { ...up, task_ids: [] }
  }
  if (input.decision !== 'accept') throw pmError(400, 'decision must be "accept" or "dismiss"')

  // An item with no proposed actions is accepted as a single task.
  const proposed = Array.isArray(item.proposed_actions) ? item.proposed_actions : []
  const actions = proposed.length ? proposed
    : [{ kind: 'create_task', title: item.title, notes: item.summary || (item.body ? item.body.slice(0, 2000) : null) }]
  const chosen = Array.isArray(input.accept_actions) ? input.accept_actions.map(Number) : actions.map((_, i) => i)
  const edits = input.edits || {}
  const evidenceRef = `pm-inbox:${item.id}`
  const evidenceKind = item.source === 'meeting' ? 'meeting' : item.source === 'email' ? 'email' : 'link'
  const taskIds = []

  for (const i of chosen) {
    const base = actions[i]
    if (!base) throw pmError(400, `No proposed action at index ${i}`)
    const a = { ...base, ...(edits[i] || {}) }
    if (a.kind === 'update_task') {
      const t = await updateTask(db, principal, a.task_id, {
        status: a.status, progress: a.progress, due_date: a.due_date, assigned_to: a.assigned_to,
        evidence: [{ url: evidenceRef, kind: evidenceKind, label: item.title }],
        note: a.notes ? `From ${item.source}: ${item.title}\n\n${a.notes}` : undefined,
      })
      taskIds.push(t.id)
    } else {
      const { task } = await createTask(db, principal, {
        title: a.title,
        description: a.notes || null,
        assigned_to: a.assigned_to || null,
        due_date: a.due_date || null,
        priority: a.priority,
        project_id: a.project_id || input.project_id,
        project: a.project || input.project,
        group: a.group || input.group,
        source: item.source,
        external_ref: `inbox:${item.id}:${i}`,
        evidence: [{ url: evidenceRef, kind: evidenceKind, label: item.title }],
      })
      taskIds.push(task.id)
    }
  }

  const allIds = Array.from(new Set([...(item.resulting_task_ids || []), ...taskIds]))
  const status = chosen.length >= actions.length ? 'accepted' : 'partial'
  const up = must(await db.from('inbox_items').update({
    status, triaged_by: who, triaged_at: new Date().toISOString(),
    triage_notes: input.notes || item.triage_notes || null, resulting_task_ids: allIds,
  }).eq('id', id).select('id, status').single(), 'triage')
  return { ...up, task_ids: taskIds }
}
