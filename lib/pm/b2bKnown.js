// HQ de-duplication (docs/b2b-campaigns/OUTREACH-MAIL.md "HQ changes"): which business domains PM already knows.
// Agent-facing (GET /api/agent/b2b/known-domains, MCP b2b_known_domains): it answers domain + reason ONLY and never
// reads the contacts or mailboxes tables; e-mail suppressions are reduced to their domain.
import { b2bError } from '../b2b'
import { domainOf } from '../b2bMail/rules'

function must(result, what) {
  if (result.error) throw b2bError(500, `${what}: ${result.error.message}`)
  return result.data
}

async function pageAll(build, cap = 50000) {
  const rows = []
  for (let from = 0; from < cap; from += 1000) {
    const data = must(await build().range(from, from + 999), 'rows')
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return rows
}

/**
 * GET /api/agent/b2b/known-domains?domains=a,b (HQ de-duplication): which domains are already a prospect in another
 * live campaign, a partner, or suppressed. Domain + reason only; never an address.
 */
export async function knownDomains(db, domains, { excludeCampaignId = null } = {}) {
  const want = [...new Set((domains || []).map(d => domainOf(d)).filter(Boolean))]
  if (want.length > 50) throw b2bError(400, 'At most 50 domains per call')
  if (!want.length) return { domains: [] }
  const reasons = new Map()
  const add = (d, why) => { if (want.includes(d) && !reasons.has(d)) reasons.set(d, why) }
  const sup = await pageAll(() => db.from('b2b_suppressions').select('email, domain, reason').order('id'))
  for (const s of sup) add(s.email ? null : s.domain, s.reason === 'partner' ? 'partner' : 'suppressed')
  const supEmailDomains = new Set(sup.filter(s => s.email).map(s => domainOf(s.email)))
  const live = must(await db.from('b2b_campaigns').select('id').in('stage', ['live', 'golive_review', 'words_review', 'finding', 'paused']).is('archived_at', null), 'campaigns').map(c => c.id).filter(id => id !== excludeCampaignId)
  const pros = live.length ? await pageAll(() => db.from('b2b_prospects').select('details, status').in('campaign_id', live).order('id')) : []
  for (const p of pros) {
    const d = domainOf((p.details || {}).website)
    if (!d) continue
    add(d, p.status === 'partner' ? 'partner' : 'prospect_in_live_campaign')
  }
  for (const d of want) if (!reasons.has(d) && supEmailDomains.has(d)) reasons.set(d, 'suppressed')
  return { domains: [...reasons.entries()].map(([domain, reason]) => ({ domain, reason })) }
}
