// MCP endpoint for the PM tool — the single door for Claude chat (custom
// connector, OAuth), Claude Code (OAuth or agent key) and cloud agents
// (agent key). Stateless Streamable HTTP: a fresh server per request.
//
// Tools are thin wrappers over lib/pm/ops.js, so they enforce exactly the
// same rules as the REST API and the UI triage screen. Each principal only
// sees the tools its scopes allow. Tool descriptions + server instructions
// replace the old briefing doc's API reference, so they cannot drift.

import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { withAgentAuth } from '../../lib/agentAuth'
import { hasScope } from '../../lib/server/credentials'
import { adminClient } from '../../lib/server/admin'
import { baseUrl } from '../../lib/server/oauth'
import * as ops from '../../lib/pm/ops'

const INSTRUCTIONS = `doddl PM tool: projects contain tasks (optionally in groups). People: use list_people for valid assignees.
Rules:
- Search before creating (find_tasks) so you don't duplicate work. For anything you might run twice, pass external_ref (a stable slug) to create_task — a repeat returns the existing task.
- Marking a task done (status "done" or progress 100) needs evidence: a URL, commit ref ("owner/repo@sha") or file path proving the work exists. Never mark done on intention alone.
- Progress drives status: 0 = not_started, 1-99 = in_progress, 100 = done. on_track / at_risk / blocked are explicit states.
- Add context with add_note (appends, never overwrites). Attach proof with add_link.
- Approve / reject decisions are made by people in the PM UI only. You can submit work for approval and read the decision.
- Emails, meetings and ideas go to the inbox first (capture_inbox_item); a person triages them into tasks.
- Dates are YYYY-MM-DD. Use British English. Never invent IDs — look them up.`

const json = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })

function tool(fn) {
  return async (args) => {
    try {
      return json(await fn(args))
    } catch (e) {
      if (e.expose) return { isError: true, content: [{ type: 'text', text: e.message }] }
      throw e
    }
  }
}

const statusEnum   = z.enum(ops.STATUSES)
const priorityEnum = z.enum(ops.PRIORITIES)
const date         = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
const evidence     = z.array(z.string().min(1)).max(10).optional()
  .describe('URLs, commit refs ("owner/repo@sha") or file paths proving the work')

const actionSchema = z.object({
  kind: z.enum(['create_task', 'update_task']).default('create_task'),
  title: z.string().optional().describe('Task title (create_task)'),
  task_id: z.string().uuid().optional().describe('Existing task (update_task)'),
  owner_email: z.string().optional(),
  assigned_to: z.string().optional(),
  due_date: date.nullable().optional(),
  status: statusEnum.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  priority: priorityEnum.optional(),
  project: z.string().optional(),
  group: z.string().optional(),
  external_ref: z.string().optional(),
  evidence,
  notes: z.string().optional(),
})

function buildServer(principal) {
  const db = adminClient(principal.actor)
  const server = new McpServer({ name: 'doddl-pm', version: '2.0.0' }, { instructions: INSTRUCTIONS })
  const can = (scope) => hasScope(principal, scope)

  if (can('tasks:read')) {
    server.registerTool('list_projects', {
      title: 'List projects',
      description: 'Live projects with open/total task counts. Use the name or id with other tools.',
      inputSchema: { status: z.enum(['active', 'on_hold', 'completed']).optional() },
      annotations: { readOnlyHint: true },
    }, tool((a) => ops.listProjects(db, a)))

    server.registerTool('list_people', {
      title: 'List people',
      description: 'Valid assignees (names) and their emails.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    }, tool(() => ops.listPeople(db)))

    server.registerTool('find_tasks', {
      title: 'Find tasks',
      description: 'Search tasks. Excludes done tasks unless include_done or an explicit status is given. Paged (max 200).',
      inputSchema: {
        project: z.string().optional().describe('Project name (exact or unique partial)'),
        project_id: z.string().uuid().optional(),
        assigned_to: z.string().optional().describe('Person name, e.g. "Laura" or "Claude"'),
        status: z.array(statusEnum).optional(),
        q: z.string().optional().describe('Text to match in the title'),
        external_ref: z.string().optional(),
        include_done: z.boolean().optional(),
        updated_since: z.string().optional().describe('ISO timestamp'),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true },
    }, tool((a) => ops.findTasks(db, a)))

    server.registerTool('get_task', {
      title: 'Get task',
      description: 'One task with its links (evidence), recent comments and change history.',
      inputSchema: { task_id: z.string().uuid() },
      annotations: { readOnlyHint: true },
    }, tool((a) => ops.getTask(db, a.task_id)))

    server.registerTool('get_decision', {
      title: 'Get approval decision',
      description: 'Whether an approval task has been approved, rejected or sent back for revision.',
      inputSchema: { task_id: z.string().uuid() },
      annotations: { readOnlyHint: true },
    }, tool((a) => ops.getDecision(db, a.task_id)))

    server.registerTool('list_inbox', {
      title: 'List inbox',
      description: 'Captured emails / meetings / proposals awaiting triage.',
      inputSchema: {
        status: z.enum(['new', 'partial', 'accepted', 'dismissed', 'all']).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true },
    }, tool((a) => ops.listInbox(db, a)))
  }

  if (can('tasks:write')) {
    server.registerTool('create_task', {
      title: 'Create task',
      description: 'Create a task in a project. Pass external_ref for idempotency. Creating as done requires evidence.',
      inputSchema: {
        title: z.string().min(1).max(300),
        project: z.string().optional().describe('Project name (or use project_id)'),
        project_id: z.string().uuid().optional(),
        group: z.string().optional().describe('Group name within the project'),
        description: z.string().optional(),
        assigned_to: z.string().optional(),
        status: statusEnum.optional(),
        progress: z.number().int().min(0).max(100).optional(),
        priority: priorityEnum.optional(),
        due_date: date.optional(),
        start_date: date.optional(),
        external_ref: z.string().max(200).optional(),
        evidence,
        note: z.string().optional().describe('First comment on the task'),
      },
      annotations: { idempotentHint: true },
    }, tool((a) => ops.createTask(db, principal, a)))

    server.registerTool('update_task', {
      title: 'Update task',
      description: 'Change status, progress, owner, dates etc. Marking done needs evidence (here or already linked). Add a note to explain the change.',
      inputSchema: {
        task_id: z.string().uuid(),
        title: z.string().min(1).max(300).optional(),
        description: z.string().optional(),
        status: statusEnum.optional(),
        progress: z.number().int().min(0).max(100).optional(),
        priority: priorityEnum.optional(),
        assigned_to: z.string().nullable().optional(),
        due_date: date.nullable().optional(),
        start_date: date.nullable().optional(),
        group: z.string().nullable().optional(),
        evidence,
        note: z.string().optional(),
      },
    }, tool(({ task_id, ...rest }) => ops.updateTask(db, principal, task_id, rest)))

    server.registerTool('add_note', {
      title: 'Add note',
      description: 'Append a comment to a task (visible in the PM UI). Never overwrites earlier notes.',
      inputSchema: { task_id: z.string().uuid(), body: z.string().min(1).max(10000) },
    }, tool((a) => ops.addNote(db, principal, a.task_id, a.body)))

    server.registerTool('add_link', {
      title: 'Add link',
      description: 'Attach evidence to a task: commit, PR, deploy, artifact, doc, file, email or meeting reference.',
      inputSchema: {
        task_id: z.string().uuid(),
        url: z.string().min(1),
        kind: z.enum(ops.LINK_KINDS).optional(),
        label: z.string().optional(),
      },
      annotations: { idempotentHint: true },
    }, tool((a) => ops.addLink(db, principal, a.task_id, a)))
  }

  if (can('approvals:write')) {
    server.registerTool('submit_for_approval', {
      title: 'Submit for approval',
      description: 'Attach an artefact (copy, design brief, plan...) to a task for a person to approve in the PM UI. Without task_id, creates the approval task (pass title + project). Decided tasks are immutable.',
      inputSchema: {
        task_id: z.string().uuid().optional(),
        title: z.string().optional(),
        project: z.string().optional(),
        project_id: z.string().uuid().optional(),
        assigned_to: z.string().optional().describe('Who should review'),
        artefact_type: z.string(),
        artefact: z.record(z.any()),
        staging_url: z.string().optional(),
      },
    }, tool((a) => ops.submitForApproval(db, principal, a)))
  }

  if (can('inbox:write')) {
    server.registerTool('capture_inbox_item', {
      title: 'Capture to inbox',
      description: 'Record an email, meeting outcome or idea for a person to triage. Proposed actions become tasks only when accepted. Idempotent on source + source_ref.',
      inputSchema: {
        source: z.enum(['email', 'teams', 'meeting', 'agent', 'manual']),
        source_ref: z.string().optional().describe('Stable id, e.g. email message-id'),
        title: z.string().min(1).max(300),
        summary: z.string().optional(),
        body: z.string().optional(),
        participants: z.array(z.string()).optional(),
        occurred_at: z.string().optional(),
        proposed_actions: z.array(actionSchema).optional(),
      },
      annotations: { idempotentHint: true },
    }, tool((a) => ops.captureInbox(db, principal, a)))
  }

  if (can('inbox:triage')) {
    server.registerTool('triage_inbox_item', {
      title: 'Triage inbox item',
      description: 'Accept (creates/updates the proposed tasks, optionally only some, with edits) or dismiss an inbox item. Only do this when the person you are working for asks.',
      inputSchema: {
        id: z.string().uuid(),
        decision: z.enum(['accept', 'dismiss']),
        accept_actions: z.array(z.number().int().min(0)).optional().describe('Indexes of proposed_actions to accept (default all)'),
        edits: z.record(actionSchema.partial()).optional().describe('Per-index overrides, e.g. {"0": {"assigned_to": "Laura"}}'),
        project: z.string().optional().describe('Default project for created tasks'),
        notes: z.string().optional(),
      },
    }, tool(({ id, ...rest }) => ops.triageInbox(db, principal, id, rest)))
  }

  return server
}

function challenge(req, res) {
  const metadata = `${baseUrl(req)}/.well-known/oauth-protected-resource/api/mcp`
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadata}"`)
  return res.status(401).json({ error: 'Authentication required' })
}

async function handler(req, res, principal) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server: POST only)' }, id: null })
  }
  const server = buildServer(principal)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => { transport.close(); server.close() })
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
}

const authed = withAgentAuth(handler, { onUnauthorised: challenge })

export default async function mcp(req, res) {
  // Unauthenticated GET/DELETE get the same OAuth challenge so clients can discover auth.
  return authed(req, res)
}
