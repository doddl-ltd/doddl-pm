// The listing agent (cron /api/cron/listing-agent, every 10 minutes). Jon 2026-11-16: "Master images should defined, then
// the agent should pull to the UK, US, CA for english, and then the agent should take the images and create translated
// versions for each other market"; "local keywords should be found by the agent using the brand analytics tool".
// For every APPROVED master whose rollout a person started (rollout panel, with a budget), in each non-English store
// where doddl sells the product, it makes what is missing, cheapest first:
//   1. the listing translation with local keywords from Brand Analytics (masterSend.translateVariant)
//   2. each master image (main left out) translated and repainted on the server (imageTranslate.agentTranslateImage)
//   3. the A+ page translation, once the A+ page is approved (aplus 'translate')
// English stores need nothing made: they take the master as it is. Everything the agent makes waits for a person's
// approval; pushing to Amazon is a person's click; nothing here writes to Amazon. It stops at the rollout's budget,
// gives up on one item after 3 failures (and says so), and leaves a minute of the run spare.
import { approvalError as fail } from './approvals'
import { LANGUAGE, masterImages, translateVariant } from './masterSend'
import { agentTranslateImage } from './imageTranslate'
import { aplusOp } from './aplus'
import { PER_IMAGE_USD, PER_TRANSLATION_USD } from './rollout'

function must(r, what) { if (r.error) throw fail(500, `${what}: ${r.error.message}`); return r.data }
const AGENT = { name: 'Doddl HQ listing agent' }
const MAX_FAILS = 3

/** What is still to make for one master, in order. Pure. */
export function agentQueue({ master, sold, translations = [], aplus = null, fails = {} }) {
  const out = []
  const langs = sold.filter(mk => LANGUAGE[mk])
  const imgs = masterImages(master).slice(1).filter(x => x && x.url)
  for (const mk of langs) if (!(master.variants || {})[mk]) out.push({ kind: 'copy', market: mk, key: `copy:${mk}`, cost: PER_TRANSLATION_USD })
  for (const mk of langs) {
    imgs.forEach((x, k) => {
      const t = translations.find(r => r.locale === mk && r.source_url === x.url)
      if (!t || t.status === 'read') out.push({ kind: 'image', market: mk, url: x.url, slot: `PT${String(k + 1).padStart(2, '0')}`, key: `image:${mk}:${x.url}`, cost: t ? 0.01 : PER_IMAGE_USD })
    })
  }
  if (aplus && aplus.status === 'approved') for (const mk of langs) if (!(aplus.variants || {})[mk]) out.push({ kind: 'aplus', market: mk, key: `aplus:${mk}`, cost: PER_TRANSLATION_USD })
  return out.filter(x => (fails[x.key] || 0) < MAX_FAILS)
}

export async function runListingAgent(db, { deadline = Date.now() + 240_000, claude, paint } = {}) {
  const masters = must(await db.from('listing_masters').select('*').eq('status', 'approved').not('rollout', 'is', null), 'listing masters')
  const active = masters.filter(m => m.rollout && m.rollout.started_at && !m.rollout.paused)
  const report = { masters: active.length, made: 0, spent: 0, stopped: null, items: [] }
  for (const m of active) {
    const r = { ...m.rollout, fails: { ...((m.rollout && m.rollout.fails) || {}) } }
    const [products, trans, aplus] = await Promise.all([
      db.from('listing_products').select('marketplace').eq('asin', m.asin),
      db.from('image_translations').select('locale, source_url, status').eq('asin', m.asin),
      db.from('listing_aplus').select('status, variants').eq('asin', m.asin).maybeSingle(),
    ])
    const sold = [...new Set(must(products, 'listings').map(p => p.marketplace))]
    const queue = agentQueue({ master: m, sold, translations: must(trans, 'image translations'), aplus: must(aplus, 'A+ page'), fails: r.fails })
    let note = queue.length ? null : 'Nothing left to make: everything waits for a person or for Amazon'
    for (const item of queue) {
      const spent = Number(r.spent_usd || 0)
      if (spent + item.cost > Number(r.budget_usd || 0)) { note = `Stopped at the budget ($${spent.toFixed(2)} of $${Number(r.budget_usd || 0).toFixed(2)}): raise it to carry on`; break }
      if (Date.now() > deadline - (item.kind === 'image' ? 70_000 : 40_000)) { note = 'Carries on in the next run'; report.stopped = 'time'; break }
      try {
        let cost = 0
        if (item.kind === 'copy') cost = Number(((await translateVariant(db, AGENT, { asin: m.asin, locale: item.market }, { client: claude })).variants || {})[item.market]?.cost_usd || 0)
        else if (item.kind === 'image') cost = (await agentTranslateImage(db, { asin: m.asin, locale: item.market, url: item.url, slot: item.slot }, { claude, paint })).cost
        else cost = Number(((await aplusOp(db, AGENT, { op: 'translate', asin: m.asin, locale: item.market }, { client: claude })).variants || {})[item.market]?.cost_usd || 0)
        r.spent_usd = Math.round((spent + cost) * 10000) / 10000
        report.made++; report.spent += cost
        report.items.push({ asin: m.asin, ...item, ok: true, cost })
      } catch (e) {
        r.fails[item.key] = (r.fails[item.key] || 0) + 1
        const msg = String((e && e.message) || e).slice(0, 200)
        r.last_error = `${item.kind} ${item.market}: ${msg}${r.fails[item.key] >= MAX_FAILS ? ' (given up after 3 tries)' : ''}`
        report.items.push({ asin: m.asin, ...item, ok: false, error: msg })
        if (e && e.status === 503) { note = msg; break }   // no Anthropic key: nothing else will work either
      }
    }
    r.last_run_at = new Date().toISOString()
    r.last_note = note || `Made ${report.items.filter(x => x.asin === m.asin && x.ok).length} this run`
    must(await db.from('listing_masters').update({ rollout: r }).eq('asin', m.asin), 'listing master')
  }
  report.spent = Math.round(report.spent * 10000) / 10000
  return report
}
