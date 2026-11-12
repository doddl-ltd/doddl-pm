import { agentRoute } from '../../../../lib/server/agentRoute'
import { postMasterSeeds } from '../../../../lib/pm/hq'

// POST /api/agent/listings/masters { masters: [...], ptd: [...] } -> { ptd, created, refreshed, kept }
// HQ seeds masters from the live UK listing (never over a master a person has edited) and stores Amazon's definitions.
export default agentRoute({
  POST: { scope: 'listings:write', run: (req, db) => postMasterSeeds(db, req.body || {}) },
})
