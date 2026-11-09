import { agentRoute } from '../../../../lib/server/agentRoute'
import { agentWork } from '../../../../lib/pm/b2b'

// GET /api/agent/b2b/work  campaigns whose stage needs HQ, each with needs (sample | resubmit_sample | find_and_words |
// resubmit_words | golive | resubmit_golive | run), the approved definition, country rules, learned rules and the
// sample's approved / rejected hq_refs (with reasons).
export default agentRoute({
  GET: { scope: 'b2b:read', run: (req, db) => agentWork(db) },
})
