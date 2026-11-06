import { agentRoute, queryParam } from '../../../../lib/server/agentRoute'
import { listIdeas } from '../../../../lib/pm/hq'

// GET /api/agent/ideas?status=new  -> { ideas[] }
export default agentRoute({
  GET: { scope: 'ideas:read', run: (req, db) => listIdeas(db, { status: queryParam(req, 'status'), limit: queryParam(req, 'limit') }) },
})
