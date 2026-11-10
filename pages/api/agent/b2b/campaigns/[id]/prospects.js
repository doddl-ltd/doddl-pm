import { agentRoute, queryParam } from '../../../../../../lib/server/agentRoute'
import { upsertProspects } from '../../../../../../lib/pm/b2b'

// POST /api/agent/b2b/campaigns/:id/prospects { prospects: [{ hq_ref, name, place?, details?, sources?, match?, fit?,
// contact?: {role, type}, status?, excluded_reason? }] }  bulk upsert on hq_ref (max 500). No names,
// e-mails or phones of people. -> { upserted, created, updated }
export default agentRoute({
  POST: { scope: 'b2b:write', run: (req, db) => upsertProspects(db, queryParam(req, 'id'), req.body || {}) },
})
