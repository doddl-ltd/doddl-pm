import { agentRoute } from '../../../lib/server/agentRoute'
import { listForHq, suggestFromHq, updateFromHq } from '../../../lib/pm/requests'

// GET   /api/agent/requests?stage=asked|in_progress|running   what HQ scopes, makes or keeps running
// POST  /api/agent/requests { suggest: { kind, mode, title, why, from } }   an agent's suggestion for a person to accept
// PATCH /api/agent/requests { updates: [{ id, op: scope|ask|made|results|health, ... }] }
export default agentRoute({
  GET: { scope: 'requests:read', run: (req, db) => listForHq(db, Array.isArray(req.query.stage) ? req.query.stage[0] : req.query.stage) },
  POST: { scope: 'requests:write', run: (req, db) => suggestFromHq(db, req.body || {}) },
  PATCH: { scope: 'requests:write', run: (req, db) => updateFromHq(db, req.body || {}) },
})
