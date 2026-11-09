import { agentRoute, queryParam } from '../../../../../lib/server/agentRoute'
import { appendLearnedRules } from '../../../../../lib/pm/b2b'

// PATCH /api/agent/b2b/business-types/:id { learned_rules: [{ rule, from_reason, count, campaign_id }] }  appended.
export default agentRoute({
  PATCH: { scope: 'b2b:write', run: (req, db) => appendLearnedRules(db, queryParam(req, 'id'), req.body || {}) },
})
