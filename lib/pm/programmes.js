// Programmes, workstreams, "my tasks" and briefings (Jon, 2026-10-15).
//
// Programmes mirror how work is organised in Claude, and Claude keeps them in
// step through sync_workstream:
//   claude.ai Project / sidebar group / agent    ->  programme
//   chat / Claude Code session / agent workstream ->  project inside it
// A workstream row remembers which project a chat/session/agent feeds, so
// actions agreed there land in that project.

import { pmError, resolveProject, actorName, listPeople, STATUSES, PRIORITIES } from './ops'

export const WORKSTREAM_KINDS = ['claude_chat', 'claude_code', 'agent', 'teams', 'other']
const PROGRAMME_SOURCE = { claude_chat: 'claude_project', claude_code: 'sidebar_group', agent: 'agent', teams: 'sync', other: 'sync' }
const DAY = 24 * 60 * 60 * 1000

function must(result, what) {
  if (result.error) throw pmError(500, `${what}: ${result.error.message}`)
  return result.data
}

function cleanName(v, what, max = 120) {
  const s = String(v || '').replace(/\s+/g, ' ').trim()
  if (!s) throw pmError(400, `${what} is required`)
  return s.slice(0, max)
}

export function workstreamKey(kind, { key, programme, title }) {
  if (key && String(key).trim()) return String(key).trim().toLowerCase().slice(0, 300)
  const parts = [programme, title].filter(Boolean).map(s => String(s).trim().toLowerCase().replace(/\s+/g, ' '))
  return `${kind}:${parts.join('/')}`.slice(0, 300)
}

function todayIso(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10)
}

// ─── programmes ─────────────────────────────────────────────────────────────

export async function findProgramme(db, name) {
  const n = cleanName(name, 'programme')
  const rows = must(await db.from('programmes').select('id, name, description, source').is('archived_at', null).ilike('name', n), 'programme lookup')
  return rows[0] || null
}

export async function upsertProgramme(db, principal, { name, description, source = 'sync' }) {
  const existing = await findProgramme(db, name)
  if (existing) return { programme: existing, created: false }
  const ins = await db.from('programmes').insert([{
    name: cleanName(name, 'programme'), description: description || null, source, created_by: actorName(principal),
  }]).select('id, name, description, source').single()
  if (ins.error) {
    if (ins.error.code === '23505') return { programme: await findProgramme(db, name), created: false }
    throw pmError(500, `programme: ${ins.error.message}`)
  }
  return { programme: ins.data, created: true }
}

export async function listProgrammes(db) {
  const programmes = must(await db.from('programmes').select('id, name, description, source, position').is('archived_at', null).order('position').order('name'), 'programmes')
  const projects = must(await db.from('projects').select('id, name, status, programme_id').is('archived_at', null).order('name'), 'projects')
  const byProg = new Map(programmes.map(p => [p.id, { ...p, projects: [] }]))
  const unassigned = []
  for (const pr of projects) (byProg.get(pr.programme_id)?.projects || unassigned).push({ id: pr.id, name: pr.name, status: pr.status })
  return { programmes: [...byProg.values()], unassigned_projects: unassigned }
}

// ─── workstreams ────────────────────────────────────────────────────────────

/**
 * Link a Claude chat / session / agent to its PM project, creating the
 * programme and project when they don't exist yet. Claude calls this at the
 * start of doddl work, so the PM tool always mirrors Claude's grouping.
 * input: { kind, title, programme?, key?, project? (name of an existing project to use) }
 */
export async function syncWorkstream(db, principal, input = {}) {
  const kind = input.kind || 'other'
  if (!WORKSTREAM_KINDS.includes(kind)) throw pmError(400, `kind must be one of ${WORKSTREAM_KINDS.join(', ')}`)
  const title = cleanName(input.title, 'title', 200)
  const programmeName = input.programme ? cleanName(input.programme, 'programme') : null
  const key = workstreamKey(kind, { key: input.key, programme: programmeName, title })
  const who = actorName(principal)
  const created = { programme: false, project: false, workstream: false }

  let programme = null
  if (programmeName) {
    const r = await upsertProgramme(db, principal, { name: programmeName, source: PROGRAMME_SOURCE[kind] })
    programme = r.programme
    created.programme = r.created
  }

  const existing = must(await db.from('workstreams').select('id, project_id, programme_id, title').eq('kind', kind).eq('key', key).maybeSingle(), 'workstream lookup')
  let project = null
  if (existing && existing.project_id) {
    project = must(await db.from('projects').select('id, name, programme_id, archived_at').eq('id', existing.project_id).maybeSingle(), 'project')
    if (project && project.archived_at) project = null
  }
  if (!project && input.project) project = await resolveProject(db, { project: input.project })
  if (!project) {
    // A project already named like this workstream is reused rather than duplicated.
    const same = must(await db.from('projects').select('id, name, programme_id').is('archived_at', null).ilike('name', title), 'project lookup')
    project = same[0] || null
  }
  if (!project) {
    const ins = await db.from('projects').insert([{
      name: title, status: 'active', priority: 'medium', programme_id: programme ? programme.id : null,
      description: `Created by ${who} for the ${kind.replace('_', ' ')} "${title}"${programmeName ? ` in ${programmeName}` : ''}.`,
    }]).select('id, name, programme_id').single()
    if (ins.error) throw pmError(500, `project: ${ins.error.message}`)
    project = ins.data
    created.project = true
  } else if (programme && project.programme_id !== programme.id) {
    // Claude's grouping is the source of truth: move the project under it.
    must(await db.from('projects').update({ programme_id: programme.id }).eq('id', project.id).select('id').single(), 'move project')
    project.programme_id = programme.id
  }

  let workstream
  if (existing) {
    workstream = must(await db.from('workstreams').update({
      title, project_id: project.id, programme_id: programme ? programme.id : existing.programme_id, last_seen_at: new Date().toISOString(),
    }).eq('id', existing.id).select('id, kind, key, title').single(), 'workstream update')
  } else {
    const ins = await db.from('workstreams').insert([{
      kind, key, title, project_id: project.id, programme_id: programme ? programme.id : null, created_by: who,
    }]).select('id, kind, key, title').single()
    if (ins.error && ins.error.code === '23505') {
      workstream = must(await db.from('workstreams').select('id, kind, key, title').eq('kind', kind).eq('key', key).single(), 'workstream')
    } else if (ins.error) {
      throw pmError(500, `workstream: ${ins.error.message}`)
    } else {
      workstream = ins.data
      created.workstream = true
    }
  }
  return {
    workstream,
    programme: programme ? { id: programme.id, name: programme.name } : null,
    project: { id: project.id, name: project.name },
    created,
  }
}

// ─── projects ───────────────────────────────────────────────────────────────

export async function createProject(db, principal, input = {}) {
  const name = cleanName(input.name, 'name', 200)
  const dup = must(await db.from('projects').select('id, name, programme_id').is('archived_at', null).ilike('name', name), 'project lookup')
  if (dup.length) return { project: dup[0], created: false }
  let programmeId = null
  if (input.programme) programmeId = (await upsertProgramme(db, principal, { name: input.programme })).programme.id
  if (input.priority && !PRIORITIES.includes(input.priority)) throw pmError(400, `priority must be one of ${PRIORITIES.join(', ')}`)
  const ins = await db.from('projects').insert([{
    name,
    description: input.description || null,
    status: 'active',
    priority: input.priority || 'medium',
    owner: input.owner || null,
    start_date: input.start_date || null,
    due_date: input.due_date || null,
    programme_id: programmeId,
  }]).select('id, name, programme_id, status').single()
  if (ins.error) throw pmError(400, `project: ${ins.error.message}`)
  return { project: ins.data, created: true }
}

// ─── my tasks / briefing / overview ─────────────────────────────────────────

async function liveTasks(db, filter) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    let q = db.from('tasks').select('id, title, status, progress, priority, assigned_to, project_id, due_date, updated_at')
      .is('archived_at', null).eq('is_group', false).range(from, from + 999)
    q = filter(q)
    const page = must(await q, 'tasks')
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

async function projectIndex(db) {
  const projects = must(await db.from('projects').select('id, name, programme_id, programmes(name)').is('archived_at', null), 'projects')
  return new Map(projects.map(p => [p.id, { name: p.name, programme: p.programmes ? p.programmes.name : null, programme_id: p.programme_id }]))
}

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }

function label(t, idx) {
  const p = idx.get(t.project_id) || {}
  return { id: t.id, title: t.title, status: t.status, progress: t.progress, priority: t.priority, due_date: t.due_date, assigned_to: t.assigned_to, project: p.name || null, programme: p.programme || null }
}

function sortTasks(list) {
  return list.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9))
}

async function resolvePerson(db, principal, person) {
  const people = await listPeople(db)
  const name = person || (principal && principal.on_behalf_of)
  if (!name) throw pmError(400, 'person is required (the name of a doddl person, e.g. "Laura")')
  const hit = people.find(p => p.name.toLowerCase() === String(name).trim().toLowerCase() || (p.email && p.email.toLowerCase() === String(name).trim().toLowerCase()))
  if (!hit) throw pmError(404, `Unknown person "${name}". Valid: ${people.map(p => p.name).join(', ')}`)
  return hit.name
}

/** Open tasks for a person, bucketed by urgency and labelled with project + programme. */
export async function myTasks(db, principal, { person, programme, due_within_days, now = Date.now() } = {}) {
  const who = await resolvePerson(db, principal, person)
  const idx = await projectIndex(db)
  const today = todayIso(now)
  const weekEnd = todayIso(now + 7 * DAY)
  let tasks = (await liveTasks(db, q => q.eq('assigned_to', who).neq('status', 'done'))).map(t => label(t, idx))
  if (programme) tasks = tasks.filter(t => (t.programme || '').toLowerCase() === String(programme).toLowerCase())
  if (due_within_days != null) {
    const until = todayIso(now + Number(due_within_days) * DAY)
    tasks = tasks.filter(t => t.due_date && t.due_date <= until)
  }
  const buckets = { overdue: [], due_this_week: [], later: [], no_date: [], blocked: [] }
  for (const t of sortTasks(tasks)) {
    if (t.status === 'blocked' || t.status === 'at_risk') buckets.blocked.push(t)
    else if (!t.due_date) buckets.no_date.push(t)
    else if (t.due_date < today) buckets.overdue.push(t)
    else if (t.due_date <= weekEnd) buckets.due_this_week.push(t)
    else buckets.later.push(t)
  }
  return { person: who, today, total_open: tasks.length, ...buckets }
}

/** The state of a programme: each project's open / overdue / blocked / recently done. */
export async function programmeOverview(db, { programme, programme_id, now = Date.now() } = {}) {
  let prog
  if (programme_id) prog = must(await db.from('programmes').select('id, name, description').eq('id', programme_id).maybeSingle(), 'programme')
  else prog = await findProgramme(db, programme)
  if (!prog) throw pmError(404, `No programme "${programme || programme_id}". Call list_programmes.`)
  const projects = must(await db.from('projects').select('id, name, status, due_date').is('archived_at', null).eq('programme_id', prog.id).order('name'), 'projects')
  const ids = projects.map(p => p.id)
  const today = todayIso(now)
  const weekAgo = new Date(now - 7 * DAY).toISOString()
  const tasks = ids.length ? await liveTasks(db, q => q.in('project_id', ids)) : []
  const idx = new Map(projects.map(p => [p.id, { name: p.name, programme: prog.name }]))
  const per = projects.map(p => {
    const ts = tasks.filter(t => t.project_id === p.id)
    const open = ts.filter(t => t.status !== 'done')
    return {
      project: p.name, project_id: p.id, status: p.status, due_date: p.due_date,
      open: open.length,
      overdue: open.filter(t => t.due_date && t.due_date < today).length,
      blocked: open.filter(t => t.status === 'blocked' || t.status === 'at_risk').length,
      done_last_7_days: ts.filter(t => t.status === 'done' && t.updated_at >= weekAgo).length,
    }
  })
  const attention = sortTasks(tasks.filter(t => t.status !== 'done' && ((t.due_date && t.due_date < today) || t.status === 'blocked' || t.status === 'at_risk'))).slice(0, 15).map(t => label(t, idx))
  return { programme: prog.name, description: prog.description, projects: per, needs_attention: attention }
}

/** What a person (or a programme) needs to know right now. */
export async function briefing(db, principal, { person, programme, now = Date.now() } = {}) {
  const mine = await myTasks(db, principal, { person, programme, now })
  const dayAgo = new Date(now - DAY).toISOString()
  const [{ count: needsReview }, { count: filed24h }] = await Promise.all([
    db.from('inbox_items').select('id', { count: 'exact', head: true }).in('status', ['new', 'partial']).in('auto_status', ['needs_review']),
    db.from('inbox_items').select('id', { count: 'exact', head: true }).eq('auto_status', 'filed').gte('auto_at', dayAgo),
  ])
  const doneRows = await liveTasks(db, q => q.eq('assigned_to', mine.person).eq('status', 'done').gte('updated_at', new Date(now - 7 * DAY).toISOString()))
  return {
    person: mine.person,
    today: mine.today,
    overdue: mine.overdue,
    due_this_week: mine.due_this_week,
    blocked: mine.blocked,
    open_total: mine.total_open,
    done_last_7_days: doneRows.length,
    triage: { needs_a_look: needsReview || 0, auto_filed_last_24h: filed24h || 0 },
    programme_overview: programme ? await programmeOverview(db, { programme, now }) : undefined,
  }
}

export { STATUSES }
