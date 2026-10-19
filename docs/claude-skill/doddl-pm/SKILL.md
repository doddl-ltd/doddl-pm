---
name: doddl-pm
description: Keeps doddl's project tool (doddl PM) in step with any doddl work in Claude chat or Claude Code — projects, tasks, actions, plans, campaigns, website, Amazon, CRM, product, meetings and emails. Use it whenever the conversation is about doddl work, when actions get agreed, or when the user asks "what are my tasks", "what's on my plate", "brief me", or to set up a project.
---

# doddl PM

doddl PM is reached through the **doddl PM** connector (tools such as `sync_workstream`, `capture_inbox_item`, `my_tasks`). It mirrors how work is organised in Claude:

- a **claude.ai Project**, sidebar group or agent → a PM **programme**
- each **chat, Claude Code session or agent workstream** → a PM **project** inside it

Claude keeps that mapping in step. Never ask the user to maintain it.

## 1. At the start of doddl work: sync once

Before the first doddl-specific answer in a conversation, call `sync_workstream` once:

| Where you are | kind | programme | title | key |
|---|---|---|---|---|
| claude.ai chat | `claude_chat` | The claude.ai Project the chat is in. If the Project instructions contain a line `PM programme: <name>`, use that name exactly; otherwise the Project's name if you can see it; otherwise the closest programme from `list_programmes`; otherwise `doddl General`. | A short workstream name (≤ 6 words, e.g. "CRM build in Klaviyo"). Reuse an existing project name from `list_programmes` when this chat continues that work. | omit |
| Claude Code | `claude_code` | The programme for the repo or folder (from `list_programmes`; e.g. doddl-ads → Marketing). | The workstream name (the session's topic). | `repo:<repo folder name>` when the repo is dedicated to one workstream |
| Headless agent / cloud run | `agent` | The agent's programme. | The agent's workstream. | `repo:<repo name>` |

Then say in one short line which project you're working in, e.g. *"Working in doddl Marketing › CRM build in Klaviyo."* Don't sync again in the same conversation unless the topic moves to a different workstream.

## 2. When actions are agreed: capture them

When the conversation agrees concrete actions (a deliverable, ideally an owner and a date), call `capture_inbox_item`. Don't capture brainstorming or ideas nobody committed to.

- `source`: `chat` in claude.ai, `agent` in Claude Code or an agent.
- `title`: the topic; `summary`: 2–3 sentences on what was decided.
- `proposed_actions`: one per action, each with `title` (imperative, under 12 words), `assigned_to` (a name from `list_people`), `due_date` (YYYY-MM-DD, only if agreed) and `notes` (one line of context). Use `kind: update_task` with `task_id` when an action is clearly progress on an existing task.
- `workstream`: the same object you synced, so it lands in this project.
- `source_ref`: stable, e.g. `chat:<programme>/<title>:<YYYY-MM-DD>:<n>`, so a retry never duplicates.

Claude files captured items into projects automatically (auto-triage) and only leaves unclear ones for a person, so capture freely when something was actually agreed. Afterwards tell the user in one line what you captured.

If the user says "add a task", "make that a task" or similar, call `create_task` directly in the synced project instead.

## 3. Recording progress (mainly Claude Code)

When you finish work that maps to a task, call `update_task` with **evidence**: a commit (`owner/repo@sha`), PR, deploy URL, artifact or file path. A task can't be marked done without evidence. Use `add_note` for context; it appends, never overwrites.

## 4. "My tasks", briefings and projects

- "What are my tasks / what's on my plate" → `my_tasks` (it knows who is signed in). Show overdue first, then this week, grouped by programme and project. Keep it short.
- "Brief me", "where are we with Marketing" → `briefing` (add `programme` for one programme) or `programme_overview`.
- "Set up a project for X" → `create_project` with the programme.

## 5. Never

- Approve or reject anything. Approvals are made by people in the PM app.
- Invent ids. Look projects, tasks and people up first.
- Put passwords, keys or tokens in tasks, notes or captures.
- Hard-delete anything. Deletes archive.

If the doddl PM tools aren't available, say once that the doddl PM connector isn't connected (claude.ai → Settings → Connectors) and carry on with the user's request.
