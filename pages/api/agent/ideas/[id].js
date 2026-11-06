import { agentRoute, queryParam } from '../../../../lib/server/agentRoute'
import { replyIdea } from '../../../../lib/pm/hq'
import { notify } from '../../../../lib/pm/approvals'

// PATCH /api/agent/ideas/:id  { status?: new|picked_up|briefed|declined, hq_reply?, brief_ref? } -> the idea.
// The person who gave the idea gets an in-app notification.
export default agentRoute({
  PATCH: { scope: 'ideas:write', run: (req, db, principal) => replyIdea(db, principal, queryParam(req, 'id'), req.body || {}, { notify }) },
})
