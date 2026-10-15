import { agentRoute, queryParam } from '../../../lib/server/agentRoute'
import { listProgrammes, programmeOverview } from '../../../lib/pm/programmes'

// GET /api/agent/programmes            programmes with their projects
// GET /api/agent/programmes?name=<n>   one programme's overview (open / overdue / blocked per project)
export default agentRoute({
  GET: {
    scope: 'tasks:read',
    run: (req, db) => {
      const name = queryParam(req, 'name')
      return name ? programmeOverview(db, { programme: name }) : listProgrammes(db)
    },
  },
})
