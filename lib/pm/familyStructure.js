// Stage 3: put each store's family on the agreed structure (Jon 2026-11-23: "Every market to have parent SKU of
// P-2IN1-BOWL & the 2 child ASINS"). Per store, in order:
//   1. create the parent: a listing edit kind 'parent' (migration 48) → Doddl HQ builds the create-parent proposal, Amazon
//      validates it, the approval card, then the live PUT;
//   2. once the parent exists, re-point each colour at it: attribute child_parent_sku_relationship = the parent's SKU;
//   3. UK packs: the same under their own parent (the target's moved_out, e.g. P-2IN1-BOWL-TWIN).
// Nothing here talks to Amazon; it raises edits for HQ exactly like a hand edit, one step per click.
import { approvalError as fail } from './approvals'

const LINK = 'child_parent_sku_relationship'
const ENGLISH = new Set(['UK', 'US', 'CA', 'IE'])
const WAITING = ['submitted', 'in_approval']
// Stores that share a seller account with an earlier store: one parent SKU there must point at the same parent ASIN in
// every store of the account (Amazon: merchant_suggested_asin consistent across active marketplaces, CA 2026-11-24).
const ACCOUNT_LEAD = { CA: 'US', FR: 'DE', ES: 'DE', IT: 'DE', NL: 'DE', BE: 'DE', IE: 'DE', PL: 'DE', SE: 'DE' }

function must(r, what) { if (r.error) throw fail(500, `${what}: ${r.error.message}`); return r.data }

/** One group (a parent SKU and the ASINs under it) in one store. Pure. */
function groupState({ market, parentSku, kids, members, products, edits }) {
  const here = (a) => members.find(m => m.asin === a && m.marketplace === market)
  const sold = kids.filter(here)
  if (!sold.length) return null
  const parentProduct = products.find(p => p.marketplace === market && p.sku === parentSku) || null
  const pEdit = edits.find(e => e.marketplace === market && e.kind === 'parent' && e.name === parentSku) || null
  const parentState = parentProduct ? 'live' : pEdit ? (pEdit.status === 'sent' ? 'sent' : WAITING.includes(pEdit.status) ? pEdit.status : pEdit.status === 'refused' ? 'refused' : 'todo') : 'todo'
  const children = sold.map(a => {
    const m = here(a)
    const linked = parentProduct && m.parent_asin === parentProduct.asin
    const e = edits.find(x => x.asin === a && x.marketplace === market && x.kind === 'attribute' && x.name === LINK && String(x.value) === parentSku)
    const state = linked ? 'live' : e ? (e.status === 'sent' ? 'sent' : WAITING.includes(e.status) ? e.status : e.status === 'refused' ? 'refused' : 'todo') : 'todo'
    return { asin: a, sku: m.sku, colour: m.colour, role: m.role, now_parent: m.parent_asin || null, state, note: e && e.hq_note ? e.hq_note : null }
  })
  const parentReady = parentState === 'live' || parentState === 'sent'
  let next = null
  if (parentState === 'todo' || parentState === 'refused') next = 'parent'
  else if (parentReady && children.some(c => c.state === 'todo' || c.state === 'refused')) next = 'children'
  const done = parentState === 'live' && children.every(c => c.state === 'live')
  return { parent_sku: parentSku, parent: { state: parentState, asin: parentProduct ? parentProduct.asin : null, note: pEdit && pEdit.hq_note ? pEdit.hq_note : null }, children, next, done }
}

/** The structure of every store against the target. Pure. */
export function structurePlan({ target, members, products, edits, stores }) {
  if (!target) return null
  const out = {}
  for (const market of stores) {
    const groups = []
    const main = groupState({ market, parentSku: target.parent_sku, kids: target.children || [], members, products, edits })
    if (main) groups.push(main)
    const packFamilies = [...new Set((target.moved_out || []).map(m => m.to_family).filter(Boolean))]
    for (const sku of packFamilies) {
      const g = groupState({ market, parentSku: sku, kids: target.moved_out.filter(m => m.to_family === sku).map(m => m.asin), members, products, edits })
      if (g) groups.push(g)
    }
    if (groups.length) out[market] = { groups, done: groups.every(g => g.done), next: groups.find(g => g.next) ? groups.find(g => g.next).parent_sku : null }
  }
  return out
}

// The parent's title: the English master title (no colour) in English stores; elsewhere the anchor colour's approved
// translation without its colour (the last ', …' part), which also names its language reviewer. Twin packs say so.
function parentTitle({ market, group, anchorAsin, masterTitle, masterCopy = {}, variants, englishListing = {}, who }) {
  const twin = group.parent_sku.endsWith('-TWIN')
  if (ENGLISH.has(market)) return { title: twin ? `${masterTitle}, Twin Pack` : masterTitle, reviewer: market === 'IE' ? who : null, copy: masterCopy }
  // A store whose listing for this product is in English (Seller Central listing language; FR, 2026-11-26) takes the English
  // master title on the parent too, reviewed by the person sending it.
  if (((englishListing || {})[anchorAsin] || []).includes(market)) return { title: twin ? `${masterTitle}, Twin Pack` : masterTitle, reviewer: who, copy: masterCopy }
  const v = ((variants || {})[anchorAsin] || {})[market]
  if (!v || v.status !== 'approved' || !v.copy || !v.copy.title) return { missing: `${market}: the parent's title needs the approved ${market} translation first (Start translations, then approve the store's card)` }
  const parts = String(v.copy.title).split(', ')
  return { title: parts.length > 1 ? parts.slice(0, -1).join(', ') : v.copy.title, reviewer: v.approved_by || v.reviewed_by || who, copy: v.copy }
}

// What Amazon requires on a parent in every store (EU 2026-11-24: missing on the EU colour listings): the store's approved
// bullets and description, and the fixed facts.
function parentAttributes(copy = {}) {
  const bullets = ['bullet_1', 'bullet_2', 'bullet_3', 'bullet_4', 'bullet_5'].map(k => copy[k]).filter(x => x && String(x).trim())
  return { ...(bullets.length ? { bullet_point: bullets } : {}), ...(copy.description ? { product_description: copy.description } : {}), country_of_origin: 'CN', supplier_declared_dg_hz_regulation: 'not_applicable', batteries_required: false, batteries_included: false }
}

/** The edits for one store's next step (pure): rows to write, or { missing } when something must come first. */
export function nextEdits({ market, group, members, products, masterTitle, masterCopy = {}, who, busy = new Set(), variants = {}, englishListing = {} }) {
  const here = (a) => members.find(m => m.asin === a && m.marketplace === market)
  const base = { marketplace: market, status: 'submitted', source: 'family', created_by: who, updated_by: who, submitted_by: who, submitted_at: new Date().toISOString(), language_reviewed_by: null }
  if (group.next === 'parent') {
    // the anchor is a colour with no other change open in this store (Doddl HQ: one open proposal per ASIN)
    const free = group.children.find(c => !busy.has(c.asin))
    if (!free) return []
    const anchor = here(free.asin)
    const oldParent = anchor.parent_asin ? products.find(p => p.marketplace === market && p.asin === anchor.parent_asin) : null
    const t = parentTitle({ market, group, anchorAsin: anchor.asin, masterTitle, masterCopy, variants, englishListing, who })
    if (t.missing) return { missing: t.missing }
    const value = JSON.stringify({ variation_theme: 'COLOR', item_name: String(t.title || '').slice(0, 200), template_sku: (oldParent && oldParent.sku) || anchor.sku, suggested_asin: (ACCOUNT_LEAD[market] ? ((members.find(m => m.asin === anchor.asin && m.marketplace === ACCOUNT_LEAD[market]) || {}).parent_asin || null) : anchor.parent_asin) || null, brand: 'doddl', manufacturer: 'Doddl Ltd', attributes: parentAttributes(t.copy) })
    return [{ ...base, language_reviewed_by: t.reviewer, asin: anchor.asin, kind: 'parent', name: group.parent_sku, value, live: anchor.parent_asin ? { parent_asin: anchor.parent_asin, parent_sku: oldParent ? oldParent.sku : null } : null, note: `Create the variation parent ${group.parent_sku} in ${market}` }]
  }
  if (group.next === 'children') {
    return group.children.filter(c => (c.state === 'todo' || c.state === 'refused') && !busy.has(c.asin)).map(c => {
      const old = c.now_parent ? products.find(p => p.marketplace === market && p.asin === c.now_parent) : null
      return { ...base, asin: c.asin, kind: 'attribute', name: LINK, value: group.parent_sku, live: old ? old.sku : null, note: `Move ${c.colour || c.asin} under ${group.parent_sku} in ${market}` }
    })
  }
  return []
}

/** POST op structure_send { market }: raise the next structure step for one store (and its pack group). */
export async function structureSend(db, user, code, market, data) {
  const plan = data.structure && data.structure[market]
  if (!plan) throw fail(404, `${market}: nothing of this family is sold there`)
  const who = user.name || 'unknown'
  const open = must(await db.from('listing_edits').select('asin').eq('marketplace', market).in('status', WAITING).in('asin', data.members.map(m => m.asin)), 'open edits')
  const busy = new Set(open.map(e => e.asin))
  const kids = [...new Set(plan.groups.flatMap(g => g.children.map(c => c.asin)))]
  const ms = must(await db.from('listing_masters').select('asin, variants, rollout').in('asin', kids), 'masters')
  const variants = Object.fromEntries(ms.map(m => [m.asin, m.variants || {}]))
  const englishListing = Object.fromEntries(ms.map(m => [m.asin, ((m.rollout || {}).english_listing) || []]))
  const rows = [], missing = []
  for (const g of plan.groups) if (g.next) { const r = nextEdits({ market, group: g, members: data.members, products: data.products_all, masterTitle: data.copy && data.copy.title, masterCopy: data.copy || {}, who, busy, variants, englishListing }); if (Array.isArray(r)) rows.push(...r); else missing.push(r.missing) }
  if (!rows.length && missing.length) throw fail(409, missing.join(' '))
  if (!rows.length) throw fail(409, plan.done ? `${market} is already on the agreed structure` : `${market}: waiting on Amazon or an approval (each ASIN takes one change at a time); nothing to send yet`)
  const sent = []
  for (const r of rows) {
    const held = must(await db.from('listing_edits').select('id, status').eq('asin', r.asin).eq('marketplace', r.marketplace).eq('kind', r.kind).eq('name', r.name).maybeSingle(), 'listing edit')
    if (held && WAITING.includes(held.status)) continue
    const row = { ...r, approval_task_id: null, proposal_id: null, hq_note: null, hq_at: null }
    if (held) { delete row.created_by; must(await db.from('listing_edits').update(row).eq('id', held.id), 'listing edit') }
    else must(await db.from('listing_edits').insert(row), 'listing edit')
    sent.push({ asin: r.asin, kind: r.kind, name: r.name, value: r.kind === 'parent' ? JSON.parse(r.value) : r.value })
  }
  return { ok: true, market, sent }
}
