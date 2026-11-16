// Brand Analytics keywords for the listing agent (migration 40). Jon 2026-11-16: "local keywords should be found by the
// agent using the brand analytics tool". The Hub sends, once a day, every store's Search Query Performance searches on
// which each doddl ASIN was shown in the last 3 months (doddl-analytics agg.amazon_asin_keywords) with the search volume
// and the ASIN's own impressions, clicks and purchases; asin '*' rows are the store's biggest searches across doddl's
// ASINs, for a product with none of its own. Only stores with Brand Analytics have rows (UK DE FR ES US CA).
import { approvalError as fail } from './approvals'
const MARKETS = ['UK', 'US', 'CA', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'IE', 'PL', 'SE']

function must(r, what) { if (r.error) throw fail(500, `${what}: ${r.error.message}`); return r.data }
const int = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))))
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
export const PROMPT_TERMS = 60

/** POST /api/agent/listings/keywords { marketplace, rows: [...] }: replaces that store's keywords. */
export async function saveKeywords(db, body = {}) {
  const m = String(body.marketplace || '').toUpperCase()
  if (!MARKETS.includes(m)) throw fail(400, `marketplace must be one of ${MARKETS.join(', ')}`)
  const rows = Array.isArray(body.rows) ? body.rows : null
  if (!rows || rows.length > 20000) throw fail(400, 'Send { marketplace, rows: [{ asin, search_query, query_volume, ... }] } (up to 20,000 rows)')
  const at = new Date().toISOString()
  const seen = new Set()
  const clean = []
  for (const [i, r] of rows.entries()) {
    const asin = String((r && r.asin) || '').trim().toUpperCase()
    const q = String((r && r.search_query) || '').replace(/\s+/g, ' ').trim().slice(0, 300)
    if (!(asin === '*' || /^[A-Z0-9]{10}$/.test(asin)) || !q) throw fail(400, `rows[${i}] needs an asin (10 characters or '*') and a search_query`)
    const k = `${asin}|${q.toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k)
    clean.push({ marketplace: m, asin, search_query: q, query_volume: int(r.query_volume), asin_impressions: int(r.asin_impressions), asin_clicks: int(r.asin_clicks), asin_purchases: int(r.asin_purchases), is_brand_term: r.is_brand_term === true || /doddl/i.test(q), period_from: day(r.period_from), period_to: day(r.period_to), received_at: at })
  }
  must(await db.from('listing_keywords').delete().eq('marketplace', m), 'listing keywords')
  for (let i = 0; i < clean.length; i += 1000) must(await db.from('listing_keywords').insert(clean.slice(i, i + 1000)), 'listing keywords')
  return { marketplace: m, saved: clean.length }
}

/** The searches for one product in one store: its own if it has any, else the store's biggest. */
export async function keywordsFor(db, asin, market) {
  const rows = must(await db.from('listing_keywords').select('asin, search_query, query_volume, asin_impressions, asin_clicks, asin_purchases, is_brand_term, period_from, period_to').eq('marketplace', market).in('asin', [String(asin).toUpperCase(), '*']).limit(400), 'listing keywords')
  const own = rows.filter(r => r.asin !== '*')
  const list = (own.length ? own : rows).filter(r => !r.is_brand_term).sort((a, b) => (b.query_volume || 0) - (a.query_volume || 0)).slice(0, PROMPT_TERMS)
  return { market, basis: !rows.length ? 'none' : own.length ? 'product' : 'store', period_from: rows.length ? rows[0].period_from : null, period_to: rows.length ? rows[0].period_to : null, terms: list }
}

/** The keyword part of the translation prompt. Pure. */
export function keywordBrief(kw, locale, language) {
  if (!kw || !kw.terms || !kw.terms.length) {
    return `Amazon ${locale} has no Brand Analytics data for doddl, so choose the local keywords yourself: in the title and the first bullet, use the term a ${language}-speaking parent would actually type to find this product (the common local product name, then the age or stage). For the search terms, write the words a native ${language}-speaking parent types into Amazon ${locale} for this product: local names and synonyms for the product type, age and stage phrases, material, use and occasion words, and common alternative spellings.`
  }
  const lines = kw.terms.map(t => `${t.search_query} | ${t.query_volume ?? '?'} | ${t.asin_impressions ?? 0} | ${t.asin_clicks ?? 0} | ${t.asin_purchases ?? 0}`)
  return [
    `Keywords come from Amazon ${locale}'s own search data (Brand Analytics, ${kw.period_from || '?'} to ${kw.period_to || '?'}): ${kw.basis === 'product' ? 'the searches on which this product was shown' : 'the biggest searches on which doddl products were shown in this store'}. Columns: search | searches in the store | times this product was shown | clicks | purchases.`,
    lines.join('\n'),
    `Build the keywords from this list, not from a literal translation. Use only searches that describe THIS product (its type, age or stage, material, use); ignore searches for other kinds of product, and never use another brand's name. In the title and the first bullet, use the most-searched relevant term naturally. Fill the search terms with the other relevant searches from the list (words not already in the title), most searched first. Return the searches you used, exactly as written in the list, in keywords_used.`,
  ].join('\n')
}
