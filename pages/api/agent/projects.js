import { agentRoute, queryParam } from '../../../lib/server/agentRoute'
import { listProjects, listPeople } from '../../../lib/pm/ops'

// GET /api/agent/projects            live projects with open/total task counts
// GET /api/agent/projects?people=1   also returns valid assignees
export default agentRoute({
  GET: {
    scope: 'tasks:read',
    run: async (req, db) => {
      const projects = await listProjects(db, { status: queryParam(req, 'status') })
      return queryParam(req, 'people') ? { projects, people: await listPeople(db) } : { projects }
    },
  },
})
