import { agentRoute } from '../../../lib/server/agentRoute'
import { upsertContentItems } from '../../../lib/pm/hq'

// PUT /api/agent/content-items  { items: [{ external_ref, type?, title?, stage?, ... }] }  (max 500)
// Bulk upsert on external_ref; only the columns sent change. New items need type and title. Moving stage
// resets stage_since. -> { upserted, created, items: [{ id, external_ref, type, stage, stage_since, updated_at }] }
export default agentRoute({
  PUT: { scope: 'content:write', run: (req, db) => upsertContentItems(db, req.body || {}) },
})
