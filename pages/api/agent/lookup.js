import { agentRoute, queryParam } from '../../../lib/server/agentRoute'
import { findTasks, getTask, getDecision } from '../../../lib/pm/ops'

// GET /api/agent/lookup?task_id=<uuid>            task detail incl. decision
// GET /api/agent/lookup?project_id=<uuid>
// GET /api/agent/lookup?assignee=Laura&status=not_started
export default agentRoute({
  GET: {
    scope: 'tasks:read',
    run: async (req, db) => {
      const taskId = queryParam(req, 'task_id')
      if (taskId) {
        const [task, decision] = await Promise.all([getTask(db, taskId), getDecision(db, taskId)])
        return { ...task, pending_decision: decision.pending }
      }
      return findTasks(db, {
        project_id: queryParam(req, 'project_id'),
        assigned_to: queryParam(req, 'assignee'),
        status: req.query.status,
        include_done: queryParam(req, 'include_done') === 'true',
        limit: queryParam(req, 'limit'),
        offset: queryParam(req, 'offset'),
      })
    },
  },
})
