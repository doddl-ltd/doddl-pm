import { agentRoute, queryParam } from '../../../../lib/server/agentRoute'
import { knownDomains } from '../../../../lib/pm/b2bKnown'

// GET /api/agent/b2b/known-domains?domains=a.com,b.co.uk[&exclude_campaign_id=] (b2b:read)
// -> { domains: [{ domain, reason: prospect_in_live_campaign | partner | suppressed }] }. Domain and reason only.
export default agentRoute({
  GET: {
    scope: 'b2b:read',
    run: (req, db) => knownDomains(db, String(queryParam(req, 'domains') || '').split(',').map(s => s.trim()).filter(Boolean), { excludeCampaignId: queryParam(req, 'exclude_campaign_id') || null }),
  },
})
