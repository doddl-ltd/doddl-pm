# doddl PM — Agent Briefing

**For any Claude (chat, Claude Code, cloud agent) that reads or updates the PM tool.**
Replaces the October 2026 briefing. The tool now describes its own operations, so this page only covers how to connect and the rules. Last updated 2026-10-14.

---

## 1. How to connect — one door for everyone

The PM tool is an MCP server: **`https://doddl-pm.vercel.app/api/mcp`**

| You are | Connect with | Identity recorded as |
|---|---|---|
| **Claude chat** (claude.ai, Desktop, mobile) | Settings → Connectors → *Add custom connector* → the URL above. Sign in with your doddl Microsoft account and click **Allow**. | `Claude (Jon)` — the person who approved it |
| **Claude Code on a person's machine** | `claude mcp add --transport http doddl-pm https://doddl-pm.vercel.app/api/mcp`, then `/mcp` to sign in. | `Claude Code (Jon)` |
| **Headless agent / cloud run / service** | Header `Authorization: Bearer <key>`, key from Key Vault `doddl-kv-prod` → `pm-agent-key-<agent>`. Never paste keys in chat, URLs or logs. | `agent:<agent>` |

Plain REST exists for scripts that can't speak MCP: `/api/agent/{tasks,lookup,projects,inbox,notes,links,artefacts}` with the same bearer credential and the same rules.

**There is no other write path.** No service-role keys, no Management API SQL, no direct Supabase calls for task updates. The database rejects what the tools reject.

## 2. The tools (their descriptions are authoritative)

`list_projects` · `list_people` · `find_tasks` · `get_task` · `get_decision` · `list_inbox` · `create_task` · `update_task` · `add_note` · `add_link` · `submit_for_approval` · `capture_inbox_item` · `triage_inbox_item`

You only see the tools your credential allows. Call `list_projects` / `list_people` instead of relying on IDs or names from documents.

## 3. Rules

1. **Search before you create.** `find_tasks` first. Anything you might run twice gets an `external_ref` (a stable slug, e.g. `webbuild3-golive`). A repeat returns the existing task.
2. **Done needs evidence.** Marking a task done (status `done` or progress 100) requires a link: commit (`owner/repo@sha`), PR, deploy, artifact, doc or file path. Never mark done on intention.
3. **Progress drives status.** 0 = not started, 1–99 = in progress, 100 = done. `on_track`, `at_risk` and `blocked` are explicit states; progress changes don't override them. Enforced by the database.
4. **Never overwrite context.** Use `add_note`, which appends. Every change is in the task's history with who made it.
5. **Every task belongs to a project.** Groups are optional, but must belong to that project. Assignees must be real people (`list_people`).
6. **Capture, don't create, from conversations.** Emails, meetings and ideas go to the inbox with `capture_inbox_item`, with proposed actions. A person accepts them in **Triage**, or asks their own Claude session to. Agents with keys never triage.
7. **Approvals are human.** You can `submit_for_approval` and read `get_decision`. Approve, reject and request-revision exist only in the PM UI. A decided task is immutable: submit revisions as a new approval task.
8. **Nothing is deleted.** Deletes archive (`archived_at`). Hard deletes are blocked for every role.
9. **Code changes to doddl-pm** follow CLAUDE.md: staging branch, migrations via `scripts/safe-apply-migration.js`, Jon merges to main.

## 4. Approval loop (for agents producing work)

1. `submit_for_approval` with `artefact_type` (`copy`, `document`, `design`, `pr_link`, `deploy_plan`) and the artefact. Pass `title` + `project` to create the task, or `task_id` to attach to an existing one.
2. A person reviews it in **Approvals** and decides.
3. `get_decision(task_id)` returns `pending`, or the `decision`, `decision_by`, `decision_at` and `decision_notes`.

## 5. Where things come from

| Source | Lands in | How |
|---|---|---|
| Teams meetings / calls | Triage (`source: meeting`) | doddl-transcribe posts notes + proposed actions after each internal meeting |
| Email / Teams (Power Automate) | Triage (`source: email`/`teams`) | `POST /api/tasks` with header `x-intake-key` |
| Claude chat | Tasks or Triage | MCP tools, acting for the signed-in person |
| Agents | Tasks, approvals, Triage | MCP or REST with their own key |

## 6. Credentials (names only)

| Secret | Where | Used by |
|---|---|---|
| `pm-agent-key-doddl-transcribe` | Key Vault | doddl-transcribe (inbox:write, tasks:read) |
| `pm-agent-key-claude-agents` | Key Vault | headless Claude agents (tasks read/write, inbox, approvals) |
| `pm-intake-key` | Key Vault + Vercel `INTAKE_KEY` | Power Automate intake flow |

New agent: `powershell -File scripts/mint-agent-key.ps1 -AgentId <name> -Scopes "<scopes>" -Migration lib/migrations/<nn>-agent-keys.sql`, then commit and apply. Revoke by setting `agent_keys.revoked_at` in a migration.
