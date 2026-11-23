// Per-store categories (migration 41). Jon 2026-11-16: "Recommend browse nodes arent always the same globally, how do we
// deal with this?" Browse node IDs are different in every Amazon store, so the master never copies one across. Each store
// keeps its own node; doddlHQ names them with Amazon's own category names (the categories Amazon ranks doddl's products
// in, sent daily by the Hub), the store's category is the one Amazon files the product under there (free), a person
// approves a change, and it
// is then sent and checked live like every other piece (masterSend.planMarket, label recommended_browse_nodes).
import { approvalError as fail } from './approvals'
import { MARKETS } from './masterSend'

function must(r, what) { if (r.error) throw fail(500, `${what}: ${r.error.message}`); return r.data }
export const splitNodes = (v) => String(v ?? '').split(/\s*\|\s*|,\s*/).map((s) => s.trim()).filter(Boolean)

/** POST /api/agent/listings/categories { rows: [{ marketplace, asin, node, title, sales_rank, read_on }] }: replaces all. */
export async function saveCategories(db, body = {}) {
  const rows = Array.isArray(body.rows) ? body.rows : null
  if (!rows || rows.length > 20000) throw fail(400, 'Send { rows: [{ marketplace, asin, node, title, sales_rank, read_on }] } (up to 20,000)')
  const seen = new Set(), at = new Date().toISOString(), clean = []
  for (const [i, r] of rows.entries()) {
    const m = String((r && r.marketplace) || '').toUpperCase(), a = String((r && r.asin) || '').toUpperCase(), n = String((r && r.node) || '')
    if (!MARKETS.includes(m) || !/^[A-Z0-9]{10}$/.test(a) || !/^\d{3,15}$/.test(n)) throw fail(400, `rows[${i}] needs a marketplace, a 10-character asin and a numeric node`)
    const k = `${m}|${a}|${n}`
    if (seen.has(k)) continue
    seen.add(k)
    clean.push({ marketplace: m, asin: a, node: n, title: String(r.title || '').slice(0, 200) || null, sales_rank: Number.isFinite(Number(r.sales_rank)) ? Math.round(Number(r.sales_rank)) : null, read_on: /^\d{4}-\d{2}-\d{2}$/.test(String(r.read_on || '')) ? r.read_on : null, received_at: at })
  }
  must(await db.from('listing_categories').delete().neq('node', ''), 'listing categories')
  for (let i = 0; i < clean.length; i += 1000) must(await db.from('listing_categories').insert(clean.slice(i, i + 1000)), 'listing categories')
  // daily history (migration 47): one row per store, ASIN, category and day; a resend the same day overwrites that day
  const today = at.slice(0, 10)
  const hist = clean.filter(r => r.sales_rank != null).map(r => ({ marketplace: r.marketplace, asin: r.asin, node: r.node, date: r.read_on || today, title: r.title, sales_rank: r.sales_rank, received_at: at }))
  for (let i = 0; i < hist.length; i += 1000) must(await db.from('listing_rank_daily').upsert(hist.slice(i, i + 1000), { onConflict: 'marketplace,asin,node,date' }), 'rank history')
  return { saved: clean.length, history: hist.length }
}

/** The category picture for one product in one store. Pure. names: Map node -> title for the store. */
export function storeCategory({ market, product, names, ranked, chosen }) {
  const attrs = (product && product.attributes) || []
  const ours = attrs.find((a) => a.name === 'recommended_browse_nodes' && a.source !== 'page') || attrs.find((a) => a.name === 'recommended_browse_nodes')
  const current = splitNodes(ours && ours.value).map((n) => ({ node: n, title: (names && names.get(n)) || null }))
  return { market, current, ranked: (ranked || []).map((r) => ({ node: r.node, title: r.title, rank: r.sales_rank })), chosen: chosen || null }
}

async function load(db, asin) {
  const [m, products, cats] = await Promise.all([
    db.from('listing_masters').select('*').eq('asin', asin).maybeSingle(),
    db.from('listing_products').select('marketplace, attributes').eq('asin', asin),
    db.from('listing_categories').select('marketplace, asin, node, title, sales_rank').limit(20000),
  ])
  return { master: must(m, 'listing master'), products: must(products, 'listings'), cats: must(cats, 'listing categories') }
}

/** Every store's categories for one product (names, Amazon's ranked categories, the chosen one). */
export async function productCategories(db, asin) {
  const A = String(asin || '').toUpperCase()
  const d = await load(db, A)
  if (!d.master) throw fail(404, `No master for ${A}`)
  return Object.fromEntries(d.products.map((p) => {
    const inStore = d.cats.filter((c) => c.marketplace === p.marketplace)
    const names = new Map(inStore.filter((c) => c.title).map((c) => [c.node, c.title]))
    return [p.marketplace, storeCategory({ market: p.marketplace, product: p, names, ranked: inStore.filter((c) => c.asin === A).sort((a, b) => (a.sales_rank || 9e9) - (b.sales_rank || 9e9)), chosen: (d.master.categories || {})[p.marketplace] })]
  }))
}

/**
 * The store's category, free (Jon 2026-11-16: "why is it charging us to recommend an amazon category"): the category
 * Amazon itself files the product under in that store, i.e. the one it ranks it best in (the most specific). No Claude:
 * on DOD004 it gave the same answer as Claude did in all 12 stores. Pure.
 */
export function pickCategory(store) {
  const best = (store.ranked || []).filter((r) => r.node).sort((x, y) => (x.rank || 9e9) - (y.rank || 9e9))[0]
  if (!best) return null
  const keep = (store.current || []).some((c) => c.node === best.node)
  return { node: best.node, title: best.title || null, keep, why: keep ? 'Already in the category Amazon files it under' : `Amazon files it under ${best.title || best.node} (rank ${best.rank ?? '?'}); the listing points somewhere else` }
}

/** POST /api/listings/categories { op: 'suggest', asin }: every store's category from Amazon's own filing (free). */
export async function suggestCategories(db, user, { asin }) {
  const A = String(asin || '').toUpperCase()
  const d = await load(db, A)
  if (!d.master) throw fail(404, `No master for ${A}`)
  const stores = await productCategories(db, A)
  if (!Object.keys(stores).length) throw fail(400, 'This product is not on any Amazon store yet')
  const at = new Date().toISOString()
  const next = { ...(d.master.categories || {}) }
  const none = []
  for (const [mk, st] of Object.entries(stores)) {
    if (next[mk] && next[mk].status === 'approved' && !next[mk].keep) continue   // a person's choice stays
    const p = pickCategory(st)
    if (!p) { none.push(mk); continue }
    next[mk] = { node: p.node, title: p.title, status: p.keep ? 'approved' : 'suggested', keep: p.keep, why: p.why, by: p.keep ? 'Doddl HQ (already right)' : null, at }
  }
  must(await db.from('listing_masters').update({ categories: next }).eq('asin', A), 'listing master')
  return { asin: A, categories: next, not_ranked_yet: none, cost_usd: 0 }
}

/** POST { op: 'approve' | 'reject', asin, market }: a person's decision on a store's suggested category. */
export async function decideCategory(db, user, { asin, market, op }) {
  const A = String(asin || '').toUpperCase()
  if (!MARKETS.includes(market)) throw fail(400, 'market must be an Amazon store')
  const m = must(await db.from('listing_masters').select('categories').eq('asin', A).maybeSingle(), 'listing master')
  if (!m) throw fail(404, `No master for ${A}`)
  const cur = (m.categories || {})[market]
  if (!cur) throw fail(404, `No category suggested for ${market}`)
  const next = { ...(m.categories || {}) }
  if (op === 'approve') next[market] = { ...cur, status: 'approved', by: (user && user.name) || 'unknown', at: new Date().toISOString() }
  else if (op === 'reject') delete next[market]
  else throw fail(400, 'op must be approve or reject')
  must(await db.from('listing_masters').update({ categories: next }).eq('asin', A), 'listing master')
  return { asin: A, categories: next }
}
