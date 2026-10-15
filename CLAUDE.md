# CLAUDE.md — doddl PM Tool Build Agent Operating Document
**Version:** 1.0 | **Last updated:** April 2026 | **Owner:** Jon Fawcett

---

## READ THIS FIRST — BEFORE DOING ANYTHING ELSE

You are a build agent operating on the doddl-pm codebase. You work in the staging branch only. You do not touch the main branch. You do not touch production infrastructure. Every action you take must be consistent with the rules in this document.

Before writing a single line of code, confirm the following out loud in your response:
1. You are operating on the staging branch
2. Your environment variables point to the staging Supabase project (URL contains iknwprxycshrickpswjz)
3. You understand the four tasks in the build sequence and their order
4. You understand what requires human approval before you proceed

If any of these cannot be confirmed, stop and report the issue. Do not proceed.

---

## System Overview

**Application name:** doddl-pm  
**Purpose:** Internal project and task management tool. Being extended to serve as the PM layer for the doddl AI Operating System.  
**Organisation:** doddl (D0DDL on GitHub)  
**Primary user:** Jon Fawcett (jon@doddl.com)

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js | 14.1.0 |
| Frontend | React | 18.2.0 |
| Database | Supabase (PostgreSQL) | 2.39.0 |
| Auth | Microsoft MSAL (Azure AD) | 3.11.1 |
| Styling | Tailwind CSS | 3.4.1 |
| Hosting | Vercel | — |
| Source control | GitHub | D0DDL/doddl-pm |

---

## Current File Structure

pages/
  api/
    tasks.js           # EXISTING — do not modify
  _app.js              # Auth wrapper — do not modify
  index.js             # MONOLITH ~1957 lines — Task 1 target
lib/
  supabase.js
  supabaseSchema.sql   # Source of truth for schema

---

## Current Database Schema

> **Out of date — kept for history.** The live schema is defined by lib/supabaseSchema.sql
> plus every file in lib/migrations/ (see schema_migrations). Since 16-pm-hardening the PM
> tables also include people, task_history, task_links, inbox_items, agent_keys and oauth_*.
> Agents should read docs/AGENT_BRIEFING.md, not this section.

Three tables. No others exist.

### projects
id, name, description, status, priority, owner, start_date, due_date, created_at, updated_at

### task_groups  
id, project_id, name, position, created_at

### tasks
id, title, description, status, priority, project_id, group_id, assigned_to, due_date, source, message_id, depends_on, notes, position, created_at, updated_at

RLS is enabled on all three tables with open allow-all policies. Do not change RLS until Task 4.

---

## Environment Variables

NEXT_PUBLIC_SUPABASE_URL — staging: https://iknwprxycshrickpswjz.supabase.co  
NEXT_PUBLIC_SUPABASE_ANON_KEY — staging anon key  
NEXT_PUBLIC_AZURE_CLIENT_ID — Azure app client ID  
NEXT_PUBLIC_AZURE_TENANT_ID — Azure tenant ID  

Never hardcode. Never log. Never commit .env.local.

---

## Permission Boundaries

### READ freely:
- Entire codebase on staging branch
- lib/supabaseSchema.sql
- This document

### WRITE in staging without approval:
- New component files in pages/components/
- New API route files in pages/api/ (except tasks.js)
- New SQL migration files in lib/migrations/ (propose only, do not apply)
- CSS/styling changes

### Vercel API access (added 2026-04-21)
- `VERCEL_TOKEN` in `.env.local` authenticates Claude against the Vercel API for
  the `doddl-pm` project.
- Claude may read, create, update, and delete environment variables on both the
  `preview` (staging) and `production` Vercel environments programmatically.
- Claude may trigger redeploys and read deployment status.
- Claude must never log or commit the `VERCEL_TOKEN` or any value it fetches
  (anon keys, service role keys, AGENT_SERVICE_KEY, etc.). Values flow from
  Supabase Management API → Vercel API in-process; neither endpoint gets logged
  to stdout with the secret visible.
- Azure app registration changes remain out of scope (Hard Rule 4 analogue).

### PROPOSE and wait for Jon approval before:
- Any change to authentication logic
- Any change to pages/api/tasks.js
- Adding new environment variables
- Installing new npm packages

### NEVER do autonomously:
- Touch main branch
- Write arbitrary row data (INSERT/UPDATE/DELETE) against production Supabase (ikcjciscttsvpxoijnqe) — migrations only, per Hard Rule 3
- Deploy to production Vercel URL
- Change Azure app registration
- Delete any table, column, or row (destructive DDL)

---

## Build Sequence

### TASK 1 — Codebase Decomposition (DO THIS FIRST)

Decompose pages/index.js (~1957 lines) into components.

Target structure:
components/                          # at repo root — Next.js 14 Pages Router treats every .jsx under pages/ as a route, so components live outside pages/
  TaskRow.jsx
  TaskDetailPanel.jsx
  ProjectSection.jsx
  KanbanBoard.jsx
  StatusBadge.jsx
  PriorityBadge.jsx
  MyWorkView.jsx
  (plus shared leaf components extracted during decomposition: AssigneeSelect, ProgressBar, TagsCell, InlineEdit, DateCell, OwnerAvatar, CalendarPicker, TimelineCell, LoginScreen, CommentBody, MentionInput, ProjectTableRow, ProjectGroup, ProjectDashboard, GanttView, AddTaskModal, AddProjectModal)
lib/
  constants.js    (new — STATUSES, PRIORITIES, COL_WIDTHS, SOURCE_COLORS, TAG_COLORS + maps)
  team.js         (new — TEAM roster, name/email helpers, PROJECT_COLORS, GROUP_TINTS, getProjectColor)
  msal.js         (new — MSAL_CONFIG, getMsal)
pages/api/
  projects.js     (new)
  task-groups.js  (new)
pages/index.js    (shell only, under 150 lines)

Acceptance criteria:
- pages/index.js under 150 lines
- Every component has single clear responsibility
- All existing functionality works identically — zero regressions
- npm run build passes clean
- No new features added — decomposition only

### TASK 2 — Agent API Access Layer

Depends on Task 1 complete.

- lib/agentAuth.js — service key validation middleware
- agent_audit_log table (propose SQL, await approval)
- pages/api/agent/tasks.js — agent task creation
- pages/api/agent/artefacts.js — agent artefact attachment
- Rate limiting: 60 req/min per agent ID, 429 on exceeded
- New env var required: AGENT_SERVICE_KEY (propose first)

### TASK 3 — Approval Artefact Model

Depends on Task 2 complete.

Schema additions to tasks table (propose SQL, await approval):
- task_type: standard/approval/go_live/incident
- artefact_type: text
- artefact: jsonb
- decision: approved/rejected/revision_requested
- decision_notes: text
- decision_by: text
- decision_at: timestamptz
- agent_id: text
- staging_url: text

New component: pages/components/ApprovalTaskPanel.jsx
New file: lib/artefactTypes.js

### TASK 4 — RLS Policies

Depends on Tasks 1-3 complete.

Replace allow-all policies with three levels:
- Human users: full read, write own tasks/projects
- Agent service account: write tasks + audit_log, read tasks/projects/task_groups
- System administrator: full read

Propose full migration SQL. Apply to staging only. Full regression test before flagging ready.

---

## Communication Protocol

After each unit of work report:
COMPLETED: [what was done]
FILES CHANGED: [list]
TESTS PASSED: [acceptance criteria]
NEXT STEP: [what comes next]
AWAITING APPROVAL: [anything needing Jon sign-off]

---

## Hard Rules

1. staging branch only — never main
2. Row-level data writes (INSERT / UPDATE / DELETE on `projects`, `tasks`, `task_groups`, `comments`, `notifications`, `inbox_items`, `task_links`) go through one of three paths only: (a) the agent layer — MCP at `/api/mcp` or REST at `/api/agent/*`, authenticated with a per-agent key or OAuth (see docs/AGENT_BRIEFING.md), (b) the live UI (which reaches the DB only via the `/api/db` proxy), or (c) a committed migration file under `lib/migrations/` applied via `scripts/safe-apply-migration.js`. Never via ad-hoc SQL, direct Supabase SQL Editor sessions, or scripts outside `lib/migrations/`. "Fix this row quickly in staging" is still not an exception — put it in a migration if you need it durable. Rule 9 (no DELETE/TRUNCATE on `projects` / `tasks` / `task_groups`) continues to apply on top of this rule: a migration can INSERT and UPDATE row data, but it still cannot DELETE from those three tables.
3. SQL migrations — Claude Code may apply migrations to either Supabase project (staging `iknwprxycshrickpswjz` or production `ikcjciscttsvpxoijnqe`) via the Supabase Management API using `SUPABASE_ACCESS_TOKEN` (PAT). Jon no longer applies migrations by hand. Preconditions when targeting production:
   - The migration SQL file must be committed to git (staging or main) BEFORE the Management API call. No "try it against prod first" — the working-copy-only path is staging-only.
   - The file must live under `lib/migrations/` and be idempotent (re-apply-safe).
   - Apply via `scripts/safe-apply-migration.js`, which enforces Rules 8–11 below (check ledger, snapshot, apply, register).
4. MSAL auth never modified without explicit instruction
5. pages/api/tasks.js keeps its request/response contract (Power Automate depends on it). Since 2026-10-14 it requires the `x-intake-key` header and captures into the triage inbox; change it only with Jon's approval.
6. No npm package installed without stating name, version, reason first
7. No credentials ever in code or git history
8. **Check `schema_migrations` before every migration.** If the migration's id is already in the ledger, skip — do not re-apply. Adopted 2026-04-21 after production seed data was overwritten by a re-apply.
9. **Never `DELETE` or `TRUNCATE` from `projects`, `tasks`, or `task_groups`.** Not in a migration, not in an ad-hoc script, not with service-role keys. These tables are live data. If rows need to be removed, archive by setting a status column or soft-delete; talk to Jon first. Past migrations that did this (`doddl_journey_migration.sql`, the production wipe-and-seed on 2026-04-21) are historical; no future SQL does it.
10. **Seed files are one-time only.** `doddl_ai_os_seed.sql`, `doddl_business_projects_seed.sql`, `doddl_journey_migration.sql` are all registered in `schema_migrations` as already applied. Never re-run them against either database. If new seed data is needed, write a new migration with a fresh id under `lib/migrations/`.
11. **Every migration must call `backup_before_migration('<id>')` before any DDL or row writes.** The function lives in both databases and snapshots every `projects` + `tasks` row into `migration_backups` as JSONB. `scripts/safe-apply-migration.js` does this automatically; hand-rolled SQL must include it explicitly as the first statement.
12. **Code deployments never touch the database.** Pushing to `origin/staging` or `origin/main` triggers Vercel builds only — no migration runs on deploy. DB changes are explicit migration files applied via `scripts/safe-apply-migration.js`. If a PR changes code that assumes a new schema, the migration must have already been applied via the normal path before the PR merges.

---

## Operating Rules (added 2026-04-21)

### Autonomous commit & push

1. **Auto-approved commands** — the following Bash commands run without a
   permission prompt (enforced via `.claude/settings.json`):
   `npm run dev`, `npm run build`, `npm run start`, `echo`, `git status`,
   `git add`, `git commit`, `git push origin staging`, `git log`, `git diff`,
   `git fetch`, `node`, `curl`, `rm`, `mkdir`, `cp`, `mv`, `ls`, `cat`.

2. **Auto-commit** — after completing any unit of work that passes
   `npm run build`, commit to `staging` with a clear message. Do not wait
   for instruction.

3. **Auto-push** — after each commit on `staging`, push to `origin/staging`
   immediately. Do not wait for instruction. Jon reviews in the staging URL.

4. **Auto-update PM tool task status** — after completing any build unit that
   maps to a task in the PM Tool database, update it through the MCP server
   (`/api/mcp`) or the agent REST API with a per-agent key — never the
   service-role client. Find it with `find_tasks` (not by exact title); mark
   it done only with evidence (commit/PR/deploy link). If partially complete,
   set a realistic `progress`. See docs/AGENT_BRIEFING.md.

5. **Only stop and ask when:**
   - A decision is required that Jon has not already made
   - An action would touch the `main` branch
   - An uncommitted migration would be applied to production Supabase
     (`ikcjciscttsvpxoijnqe`) — commit first, then apply
   - A production Supabase action would be anything other than an idempotent
     migration (e.g. row-level data writes, destructive DDL outside migrations)
   - An error persists after two resolution attempts

   Everything else: build it, test it, commit it, push it.

Hard Rules 1–7 above still apply and override these rules wherever they
conflict. In particular: never push to `main`, never write arbitrary row
data to production Supabase, never install npm packages without approval.
Production migrations are permitted per Hard Rule 3 (committed + via the
Management API).
