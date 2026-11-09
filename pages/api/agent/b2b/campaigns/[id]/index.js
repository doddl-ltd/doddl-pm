import { agentRoute, queryParam } from '../../../../../../lib/server/agentRoute'
import { agentPatchCampaign } from '../../../../../../lib/pm/b2b'

// PATCH /api/agent/b2b/campaigns/:id { metrics?: {found, approved, contacts_missing, emailed, opened, replied, meetings, orders},
// estimate?: {found, match, contact, after_rules}, stage?: 'done' (from live only) }
export default agentRoute({
  PATCH: { scope: 'b2b:write', run: (req, db) => agentPatchCampaign(db, queryParam(req, 'id'), req.body || {}) },
})
