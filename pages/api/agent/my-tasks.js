import { agentRoute, queryParam } from '../../../lib/server/agentRoute'
import { myTasks, briefing } from '../../../lib/pm/programmes'

// GET /api/agent/my-tasks?person=Laura[&briefing=1][&programme=...]
// For OAuth sessions the person defaults to whoever signed in.
export default agentRoute({
  GET: {
    scope: 'tasks:read',
    run: (req, db, principal) => {
      const args = { person: queryParam(req, 'person'), programme: queryParam(req, 'programme') }
      return queryParam(req, 'briefing') ? briefing(db, principal, args) : myTasks(db, principal, args)
    },
  },
})
