import { uiRoute, q } from '../../../../../lib/server/uiRoute'
import { submitCampaign } from '../../../../../lib/pm/b2b'
import { createTeams } from '../../../../../lib/server/teams'

// POST /api/b2b/campaigns/:id/submit  creates the b2b_definition approval (area outreach) and sets the stage
// to define_review -> { campaign, task }
export default uiRoute({
  POST: ({ req, db, user }) => submitCampaign(db, user.name, q(req, 'id'), { teams: createTeams() }),
})
