import { agentRoute, queryParam } from '../../../../../../lib/server/agentRoute'
import { postSequence } from '../../../../../../lib/pm/b2b'
import { createTeams } from '../../../../../../lib/server/teams'

// POST /api/agent/b2b/campaigns/:id/sequence  creates the b2b_sequence approval (area outreach) and moves the stage.
// See docs/b2b-campaigns/CONTRACT.md for the body. -> { campaign_id, stage, task }
export default agentRoute({
  POST: { scope: 'b2b:write', status: 201, run: (req, db, principal) => postSequence(db, principal, queryParam(req, 'id'), req.body || {}, { teams: createTeams() }) },
})
