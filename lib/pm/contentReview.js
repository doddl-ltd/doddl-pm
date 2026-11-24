// Amazon content review: Jon and Laura approve every piece before it goes to Amazon (Jon 2026-11-17: "The A+ content
// page needs to go to approvals now for Laura & myself to feedback. Nothing should be built yet. I will want every
// product we have to go through this process ... Push all of this to approval for Laura & me, once we have approved it
// push the content live to Amazon for this SKU").
//
// One process for every product:
//   1. A+ page   a person writes the brief and presses Build; the agent builds it in the house design from the image
//                library (lib/pm/aplusHouse.js) and this module puts it in approvals: one card, Jon and Laura.
//                Approved -> the UK page is approved. Sent back -> it goes back to draft with their notes and panels
//                they untick, and the person rebuilds it.
//   2. each store  when the listing agent has made everything a store needs (translated copy and search terms,
//                translated images, the translated A+ page), one card per store, Jon and Laura. Approved -> every
//                piece is approved with Jon and Laura as the language reviewers, and the store is pushed to Doddl HQ,
//                which checks it with Amazon and makes its own send card. Unticked pieces go back to the agent.
//   English stores (UK, US, CA, IE) have one card for the master copy, images and A+ page.
// Area 'amazon_content' (migration 42): Jon approves, Laura is the second approver, so both must approve.
import { submitForApproval } from './ops'
import { MARKETS, ENGLISH, masterImages, marketImages, sendMaster, LANGUAGE } from './masterSend'
import { modulesFor } from './aplusModel'

export const AREA = 'amazon_content'
export const PROJECT_ID = '7c19e364-53a3-47c6-8960-fcc2b735bff1'   // Amazon branding update (Laura)
const SYSTEM = { kind: 'person', agent_id: null, actor: 'doddl listing agent', scopes: [], on_behalf_of: null }
const fail = (status, message) => Object.assign(new Error(message), { status, expose: true })
const must = (r, what) => { if (r.error) throw fail(500, `${what}: ${r.error.message}`); return r.data }
const COPY = [['title', 'Title'], ['bullet_1', 'Bullet 1'], ['bullet_2', 'Bullet 2'], ['bullet_3', 'Bullet 3'], ['bullet_4', 'Bullet 4'], ['bullet_5', 'Bullet 5'], ['description', 'Description'], ['search_terms', 'Search terms']]

/** A+ modules as review sections: one per module, its image and words (master = the UK page). Pure. */
export function aplusSections(modules, images, master = null, prefix = 'aplus') {
  const byId = Object.fromEntries((images || []).map(x => [x.id, x]))
  const mById = master ? Object.fromEntries((master.images || []).map(x => [x.id, x])) : {}
  return (modules || []).map((m, i) => {
    const img = byId[m.image]
    const mm = master && master.modules ? master.modules[i] : null
    const words = [m.headline, m.body, ...(m.bullets || []), ...(m.blocks || []).flatMap(b => [b.headline, b.body])].filter(Boolean).join('\n')
    return {
      id: `${prefix}_${i + 1}`, label: `A+ panel ${i + 1}${img && /^h_shared_/.test(img.id) ? ' (shared doddl panel)' : ''}`, kind: 'image',
      url: img ? img.url : null, master_url: mm && mById[mm.image] ? mById[mm.image].url : null,
      text: words || (img ? img.alt : ''), note: img && img.alt ? `Alt text: ${img.alt}` : null,
    }
  })
}

/** The A+ page card (UK English, built in the house design). Pure. */
export function aplusArtefact(page, master) {
  const h = page.house || {}
  const lib = h.library || {}
  return {
    kind: 'aplus', asin: page.asin, sku: master.master_sku || null, product: master.product || page.name, market: 'UK',
    brief: page.brief || '', sections: aplusSections(page.modules, page.images),
    shot_list: h.shot_list || [],
    notes: [
      `Built from the brief in doddl's house design (the layout of the 11 live UK A+ pages).`,
      lib.searched != null ? `Image library: ${lib.searched} photos cleared for Amazon matched this product, ${lib.previewed} could be read.` : null,
      (h.shot_list || []).length ? `${h.shot_list.length} panel${h.shot_list.length === 1 ? '' : 's'} left out for lack of a suitable photo: see the shot list.` : null,
      'Untick any panel you want changed and say why; approving with panels unticked sends the page back to be rebuilt.',
      'Nothing goes to Amazon from this card.',
    ].filter(Boolean).join(' '),
    cost_usd: Number(h.cost_usd || page.cost_usd || 0),
  }
}

/** Put the UK A+ page in approvals for Jon and Laura. Returns the task. */
export async function submitAplusReview(db, page, master, who = 'unknown') {
  if (!(page.modules || []).length) throw fail(400, 'Build the page first')
  if (page.review_task_id) {
    const t = must(await db.from('tasks').select('id, decision').eq('id', page.review_task_id).maybeSingle(), 'review task')
    if (t && !t.decision) throw fail(409, 'This page is already waiting for Jon and Laura')
  }
  const task = await submitForApproval(db, { ...SYSTEM, actor: who }, {
    title: `A+ page for review: ${master.product || page.asin} (${master.master_sku || page.asin})`, project_id: PROJECT_ID,
    artefact_type: 'content_review', approval_area: AREA, artefact: aplusArtefact(page, master),
    description: `The A+ page built from the brief for ${master.product || page.asin}. Jon and Laura both approve; nothing goes to Amazon from this card.`,
  })
  must(await db.from('listing_aplus').update({ review_task_id: task.id, status: 'draft', updated_by: who }).eq('asin', page.asin), 'A+ page')
  return task
}

/** One store's card: the copy (master and translation), the images in that store and the A+ page. Pure. */
export function storeArtefact({ master, market, translations = [], aplus = null }) {
  const english = ENGLISH.includes(market)
  const v = english ? null : (master.variants || {})[market] || {}
  const copy = master.copy || {}
  const sections = []
  for (const [k, label] of COPY) {
    const text = english ? copy[k] : (v.copy || {})[k]
    if (!text) continue
    sections.push({ id: `copy_${k}`, label, kind: 'text', text, master_text: english ? null : copy[k] || null })
  }
  const want = marketImages(master, market, translations)
  const byUrl = new Map(translations.filter(t => t.locale === market).map(t => [t.source_url, t]))
  want.forEach((w, i) => {
    const t = byUrl.get(w.source)
    sections.push({ id: `img_${i + 1}`, label: `Image ${i + 1}`, kind: 'image', url: w.url || (t && t.url) || w.source, master_url: english ? null : w.source,
      note: english ? null : !t ? 'No words to translate: same as the master' : t.status === 'problem' ? `The check flagged this one: ${t.note || 'see it'}` : null,
      translation_id: t ? t.id : null })
  })
  if (aplus && (aplus.modules || []).length) {
    const mods = english ? { modules: aplus.modules } : (aplus.variants || {})[market]
    if (mods && mods.modules) sections.push(...aplusSections(mods.modules, aplus.images, english ? null : aplus))
  }
  return {
    kind: 'store', asin: master.asin, sku: master.master_sku || null, product: master.product || master.asin, market,
    sections, shot_list: [],
    notes: english
      ? `Everything ${market} gets from the master. Approving pushes ${market} to Doddl HQ, which checks it with Amazon and asks for the final send.`
      : `The ${LANGUAGE[market] || market} store: copy and search terms translated from the master (with this store's Brand Analytics searches where held), the images with their words translated, and the A+ page in ${LANGUAGE[market] || market}. Approving records Jon and Laura as the language reviewers and pushes ${market} to Doddl HQ for the final send. Untick anything to send it back to the agent.`,
    cost_usd: 0,
  }
}

/** Is everything a store needs made (nothing left for the agent)? Pure. */
export function storeReady(state) {
  if (!state || !state.sold) return false
  const stages = [state.copy && state.copy.stage, ...(state.images || []).map(x => x.stage), state.aplus && state.aplus.stage].filter(Boolean)
  return stages.length > 0 && !stages.some(s => s === 'todo' || s === 'made')
}

export async function submitStoreReview(db, { master, market, translations, aplus }) {
  const reviews = { ...((master.rollout || {}).reviews || {}) }
  if (reviews[market] && reviews[market].status === 'waiting') return null
  const artefact = storeArtefact({ master, market, translations, aplus })
  if (!artefact.sections.length) return null
  const task = await submitForApproval(db, SYSTEM, {
    title: `${market} store for review: ${master.product || master.asin} (${master.master_sku || master.asin})`, project_id: PROJECT_ID,
    artefact_type: 'content_review', approval_area: AREA, artefact,
    description: artefact.notes,
  })
  reviews[market] = { task_id: task.id, status: 'waiting', at: new Date().toISOString() }
  must(await db.from('listing_masters').update({ rollout: { ...(master.rollout || {}), reviews } }).eq('asin', master.asin), 'listing master')
  return task
}

const unticked = (task) => Object.entries(task.line_decisions || {}).filter(([k, v]) => !k.includes(':') && v === 'rejected').map(([k]) => k)
const lineNote = (task, id) => (task.line_decisions || {})[`${id}:note`] || null

/** After Jon and Laura decide a content_review card. Never throws (the decision stands). */
export async function afterContentDecision(db, task, actor) {
  try {
    const a = task.artefact || {}
    const ok = ['approved', 'approved_with_edits', 'partially_approved'].includes(task.decision)
    const back = unticked(task)
    const reviewers = (task.approvers || []).join(' & ') || actor
    const now = new Date().toISOString()
    if (a.kind === 'aplus') {
      const page = must(await db.from('listing_aplus').select('*').eq('asin', a.asin).maybeSingle(), 'A+ page')
      if (!page || page.review_task_id !== task.id) return
      if (ok && !back.length) {
        must(await db.from('listing_aplus').update({ status: 'approved', approved_by: reviewers, approved_at: now, updated_by: actor }).eq('asin', a.asin), 'A+ page')
      } else {
        const notes = [task.decision_notes, ...back.map(id => `${id}: ${lineNote(task, id) || 'change it'}`)].filter(Boolean).join('\n')
        const house = { ...(page.house || {}), feedback: { at: now, by: reviewers, notes, panels: back } }
        must(await db.from('listing_aplus').update({ status: 'draft', house, updated_by: actor }).eq('asin', a.asin), 'A+ page')
      }
      return
    }
    if (a.kind !== 'store') return
    const m = must(await db.from('listing_masters').select('*').eq('asin', a.asin).maybeSingle(), 'listing master')
    if (!m) return
    const market = a.market, english = ENGLISH.includes(market)
    const reviews = { ...((m.rollout || {}).reviews || {}) }
    if (!reviews[market] || reviews[market].task_id !== task.id) return
    const sections = a.sections || []
    const sentBack = new Set(back)
    if (!ok) { reviews[market] = { ...reviews[market], status: 'sent_back', decided_at: now, notes: task.decision_notes || null }; must(await db.from('listing_masters').update({ rollout: { ...m.rollout, reviews } }).eq('asin', a.asin), 'listing master'); return }
    // Copy: the store's translation is approved (language review) unless a copy line was unticked.
    const copyBack = sections.filter(s => s.id.startsWith('copy_') && sentBack.has(s.id))
    let variants = m.variants || {}
    if (!english && variants[market]) {
      variants = { ...variants, [market]: copyBack.length
        ? { ...variants[market], status: 'draft', review_notes: copyBack.map(s => `${s.label}: ${lineNote(task, s.id) || 'change it'}`).join('\n') }
        : { ...variants[market], status: 'approved', approved_by: reviewers, approved_at: now } }
    }
    // Images: each translated image approved, or rejected with the note (the agent redoes it).
    // With English pictures in every store (rollout.english_images, Jon 2026-11-23) translated pictures are neither
    // approved nor rejected here: the store shows the approved English pictures.
    for (const s of (m.rollout && m.rollout.english_images) ? [] : sections.filter(x => x.translation_id)) {
      const rejected = sentBack.has(s.id)
      await db.from('image_translations').update({ status: rejected ? 'rejected' : 'approved', note: rejected ? (lineNote(task, s.id) || 'Sent back in the store review') : null, decided_by: reviewers, decided_at: now, updated_at: now }).eq('id', s.translation_id).in('status', ['checked', 'problem'])
    }
    // A+: the store's translated page.
    const aplusBack = sections.some(s => s.id.startsWith('aplus_') && sentBack.has(s.id))
    const page = must(await db.from('listing_aplus').select('*').eq('asin', a.asin).maybeSingle(), 'A+ page')
    if (page && !english && (page.variants || {})[market]) {
      const v = page.variants[market]
      must(await db.from('listing_aplus').update({ variants: { ...page.variants, [market]: aplusBack ? { ...v, status: 'draft' } : { ...v, status: 'approved', approved_by: reviewers, approved_at: now } }, updated_by: actor }).eq('asin', a.asin), 'A+ page')
    }
    reviews[market] = { ...reviews[market], status: back.length ? 'partly_sent_back' : 'approved', decided_at: now, sent_back: back }
    must(await db.from('listing_masters').update({ variants, rollout: { ...m.rollout, reviews } }).eq('asin', a.asin), 'listing master')
    // Push what was approved: HQ checks it with Amazon and makes the send card.
    if (!copyBack.length) await sendMaster(db, { name: reviewers }, { asin: a.asin, markets: [market] })
    if (page && !aplusBack && page.status === 'approved') {
      const fresh = must(await db.from('listing_aplus').select('*').eq('asin', a.asin).maybeSingle(), 'A+ page')
      if (modulesFor(fresh, market)) {
        const cur = (fresh.sends || {})[market]
        if (!cur || !['submitted', 'in_approval', 'sent', 'live'].includes(cur.status)) {
          const sends = { ...(fresh.sends || {}), [market]: { status: 'submitted', by: reviewers, at: now, version: fresh.approved_at, ref: cur && cur.ref ? cur.ref : null, note: null } }
          must(await db.from('listing_aplus').update({ sends, updated_by: actor }).eq('asin', a.asin), 'A+ page')
        }
      }
    }
  } catch (e) {
    console.error('content review: after decision failed:', e.message)
  }
}

export { MARKETS, masterImages }
