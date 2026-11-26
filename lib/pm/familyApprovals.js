// Every approval card waiting for one family (Jon 2026-11-23, 2-in-1 Bowl: "no need for Laura's approval on this"; one
// press instead of ~50): the store review cards (content_review, Jon + Laura) and Doddl HQ's Amazon cards (listing edits
// and A+ sends in approval). Jon approves them himself here, after opening any he wants; a two-person card is decided
// without the second approver, as on the card itself.
import { approvalError as fail, decide } from './approvals'

function must(r, what) { if (r.error) throw fail(500, `${what}: ${r.error.message}`); return r.data }

/** The open cards for these ASINs: [{ id, title, kind, approvers }]. */
export async function familyCards(db, asins) {
  const ids = new Map()
  const edits = must(await db.from('listing_edits').select('approval_task_id, asin, marketplace, kind, name').in('asin', asins).eq('status', 'in_approval').not('approval_task_id', 'is', null), 'listing edits')
  for (const e of edits) ids.set(e.approval_task_id, e.kind === 'parent' ? 'parent' : e.name === 'child_parent_sku_relationship' ? 'move' : 'content')
  const pages = must(await db.from('listing_aplus').select('asin, sends').in('asin', asins), 'A+ pages')
  for (const p of pages) for (const s of Object.values(p.sends || {})) if (s && s.status === 'in_approval' && s.approval_task_id) ids.set(s.approval_task_id, 'aplus')
  const reviews = must(await db.from('tasks').select('id, title, approvers, artefact, decision, archived_at').eq('artefact_type', 'content_review').is('decision', null).is('archived_at', null).limit(500), 'store reviews')
  for (const t of reviews) if (t.artefact && asins.includes(t.artefact.asin)) ids.set(t.id, t.artefact.kind === 'aplus' ? 'aplus_review' : 'store_review')
  // Doddl HQ approval cards whose listing edit lost its link (a cancelled poller run raised the proposal, the next run
  // refused the edit as a duplicate; 2026-11-26, 33 colour cards): open HQ proposal approvals naming one of these ASINs
  const hq = must(await db.from('tasks').select('id, title').eq('task_type', 'approval').like('external_ref', 'doddl-hq:proposal:%').is('decision', null).is('archived_at', null).limit(1000), 'HQ approvals')
  for (const t of hq) if (!ids.has(t.id)) { const a = (String(t.title).match(/\b(B0[A-Z0-9]{8})\b/) || [])[1]; if (a && asins.includes(a)) ids.set(t.id, /child_parent_sku_relationship/.test(t.title) ? 'move' : /parent_listing/.test(t.title) ? 'parent' : 'content') }
  if (!ids.size) return []
  const tasks = must(await db.from('tasks').select('id, title, approvers, decision, archived_at, created_at').in('id', [...ids.keys()]), 'cards')
  return tasks.filter(t => !t.decision && !t.archived_at).map(t => ({ id: t.id, title: t.title, kind: ids.get(t.id), approvers: t.approvers || [], created_at: t.created_at }))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
}

/** Approve the listed cards as the signed-in first approver; two-person cards are then decided without the second. */
export async function approveCards(db, user, asins, ids) {
  if (!/^jon\b/i.test(String(user.name || ''))) throw fail(403, 'Only Jon approves these together')
  const open = await familyCards(db, asins)
  const todo = open.filter(c => !ids || ids.includes(c.id))
  const out = []
  for (const c of todo) {
    try {
      let decided = false
      try { decided = (await decide(db, user.name, { task_id: c.id, outcome: 'approved' })).decided } catch (e) { if (!/already answered/.test(e.message)) throw e }
      if (!decided && (c.approvers || []).length > 1) decided = (await decide(db, user.name, { task_id: c.id, outcome: 'approved', waive_second: true })).decided
      out.push({ id: c.id, title: c.title, decided })
    } catch (e) { out.push({ id: c.id, title: c.title, error: e.message }) }
  }
  return { approved: out.filter(x => x.decided).length, results: out }
}
