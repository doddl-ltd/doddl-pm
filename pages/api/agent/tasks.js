import { agentRoute, queryParam } from '../../../lib/server/agentRoute'
import { findTasks, getTask, createTask, updateTask } from '../../../lib/pm/ops'

// GET   /api/agent/tasks?id=<uuid>                       one task with links, comments, history
// GET   /api/agent/tasks?project=&assigned_to=&status=&q=&include_done=&limit=&offset=
// POST  /api/agent/tasks            create (idempotent when external_ref is given)
// PATCH /api/agent/tasks?id=<uuid>  update; marking done needs evidence
export default agentRoute({
  GET: {
    scope: 'tasks:read',
    run: (req, db) => {
      const id = queryParam(req, 'id')
      if (id) return getTask(db, id)
      return findTasks(db, {
        project_id: queryParam(req, 'project_id'),
        project: queryParam(req, 'project'),
        assigned_to: queryParam(req, 'assigned_to') || queryParam(req, 'assignee'),
        status: req.query.status,
        q: queryParam(req, 'q'),
        external_ref: queryParam(req, 'external_ref'),
        include_done: queryParam(req, 'include_done') === 'true',
        limit: queryParam(req, 'limit'),
        offset: queryParam(req, 'offset'),
      })
    },
  },
  POST: {
    scope: 'tasks:write',
    run: (req, db, principal) => createTask(db, principal, req.body || {}),
    status: (out) => (out.created ? 201 : 200),
  },
  PATCH: {
    scope: 'tasks:write',
    run: (req, db, principal) => updateTask(db, principal, queryParam(req, 'id'), req.body || {}),
  },
})
