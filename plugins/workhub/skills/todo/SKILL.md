---
name: todo
description: Initialize a project's todo directory with relevant example tasks, then create, update, and work on Markdown tasks in Workhub. Use for init, task capture, project switching, the tree or kanban board, and evidence-based task progress.
---

# Workhub

Workhub calls a connected directory a **workspace**, and a task
ID prefix (`api`, `admin`, `infra`) a **project** within that workspace. The UI's
Project selector filters task lists and boards. Existing MCP arguments remain
compatible: `projectId` is the workspace connection ID and `area` is the task
project. Choose both explicitly when creating or working on tasks. The plugin
display name is Workhub; the skill command remains `$todo`.

For `init`, follow the initialization workflow below. Otherwise call `todo_open`
to discover connected projects, their roots, tasks, statuses,
and labels. Use the intended project ID explicitly in subsequent calls;
the plugin's selected project can differ from this chat's working directory.
Read that project's `AGENTS.md` and linked task policy before creating or
working on a task. Project instructions determine acceptance and authority.

Files are authoritative. Statuses and labels are discovered per project from
current task frontmatter. Reuse established values when they fit; introduce
new ones when the requested workflow needs them. Discovery updates after a
plugin write, Refresh, or reopening the workspace. It does not infer status
from chats, checked boxes, or prose.

## Document missing task rules

Check whether the project's `AGENTS.md` contains todo-file rules or links to
an existing task policy. If neither is present, or `AGENTS.md` is missing,
suggest collecting all of the project's todo-file rules in `todo-files.md` at
the project root and adding this link to `AGENTS.md` (creating it if needed):

`For todo-file workflows, follow [todo-files.md](todo-files.md).`

The document should cover task layout and frontmatter, stable IDs and filenames,
statuses and transitions, blockers and WIP limits, labels, task capture and
acceptance criteria, progress evidence and session links, safe edits, validation
and index refresh, and completion, cancellation, and archiving. Base it on the
project's existing conventions and applicable plugin rules; flag unresolved
choices rather than inventing policy. Reuse an existing linked policy instead
of suggesting a duplicate. This is a suggestion; write or update these documents
only when the user has authorized documentation changes.

## Init a project

Treat `$todo init` and `$todo init <project-directory>` as skill commands.
They are requests for Codex to perform this workflow, not shell executables.

Use the explicit project directory when supplied; otherwise use this chat's
working directory, even if the plugin currently shows a different project.
Resolve the path to an existing project root. Read its `AGENTS.md`, linked
task policy, README, relevant manifests/configuration, and top-level source
and test layout. Use those files to identify the project name, areas, labels,
and a few concrete next steps. Avoid credentials, generated dependencies,
and unrelated projects during this inspection.

1. Inspect existing `todo/` content before creating anything. If current task
   files already exist, ensure their connection as described in step 3,
   report that the project is initialized, and stop without adding examples.
   Do not create a parallel
   TOML task workflow over an existing legacy YAML workflow or migrate it as
   part of `init`. Preserve all existing files and archives. If a task directory
   is a symlink or a file occupies its path, report that conflict without
   replacing it.
2. If the project's existing task policy requires an incompatible layout,
   report that an upgrade is needed and stop. Otherwise, for a project with
   no current tasks, create the missing `todo/` directory with ordinary filesystem tools.
   New tasks live directly in it; `archive/` is created on the first approved
   archive. Preserve an existing compatible `todo/tasks/` layout. An explicitly
   selected custom task folder can use the same flat layout.
   Keep any existing compatible empty directories. The MCP connection tool
   can also create a missing `todo/` folder: call `todo_connect_project` first,
   then use the returned canonical root with `createTodo: true` only when
   directory creation is authorized (as it is for an explicit `init` request).
   A normal connection request alone does not authorize creating directories.
3. Call `todo_open` to check connections and reuse the project whose canonical
   root matches. Otherwise call `todo_connect_project` with the project root,
   a name from its documentation or directory, an optional `taskDirectory`
   (relative or absolute inside the workspace), and the matching format:
   `clos` for shared TOML or `denti` for existing legacy YAML. A legacy
   connection remains browse-only.
4. For a newly initialized empty task directory, create three example tasks
   with `todo_create_task`, then fill their bodies with `todo_save_task` using
   each returned `etag`. Derive the titles, area, labels, references, next
   action, checklist, and acceptance criteria from the inspected project.
   Reuse its vocabulary when defined. Examples should describe useful proposed
   work, such as verifying the documented setup, recording the existing test
   baseline, or tracing a real entrypoint through the actual modules. Use
   actual file paths and commands only when found in the project; do not
   invent defects, unfinished features, or successful checks.
5. Keep examples in `new` with today's capture date and allocated stable IDs.
   Include this marker in each Markdown body: “Example task created by Todo
   Local init; proposed work, not yet started.” Do not run the tasks' setup,
   tests, or implementation as part of initialization. Refresh with `todo_open`
   and verify the three tasks, their labels, and their status are readable.
6. Report the project, created directory/files, and example IDs. Re-running
   `init` on a populated task directory creates no additional examples and
   never overwrites task content. Report partial creation if a write fails.

Example: `$todo init ~/projects/my-api` creates `todo/`, connects that
project, and seeds three API-specific examples based on its own files.

## Create a task

Use this workflow for requests to capture or plan work. Capturing a task does
not authorize executing it.

1. Choose the project with `todo_open`. Check existing summaries and IDs for a
   duplicate or a related task. Prefer updating an existing task when appropriate.
2. Call `todo_create_task` with a concrete outcome as `title`, an existing area
   when suitable, and 1–3 distinct labels. It allocates an unused `area-1000+`
   ID, creates a stable filename in the connected task folder, and sets `status = "new"`,
   `worth = "yes"`, and today's capture date. A label may be new; it cannot
   contain a comma because the file stores labels as a comma-separated string.
3. Use the returned task content and exact `etag` with `todo_save_task` to
   write the goal, relevant context/references, next action, a short checklist,
   and observable acceptance criteria. Follow the project's body conventions;
   preserve source links and uncertainty without inventing evidence.
4. Report the task ID, project, and file. Do not imply that its implementation
   has started.

Example: “Create an infra task in my-api to test runner recovery, with labels
`ci-cd` and `qa`.”

## Work on a task

Resolve the task with `todo_open`, then read its full file with
`todo_get_task`. Read the task's references and relevant project entrypoints.
Confirm the requested outcome and acceptance criteria from those sources.
A request to explain, review, or plan remains read-only unless changes are
also requested.

When authorized substantive work starts, set `doing` with `todo_set_status`
and record the actual Codex session ID if the project requires it and it is
available. Keep only three tasks in `doing`. Do the requested local work and
run the relevant validation. Update the task's checklist, evidence, and next
step to reflect what was actually proved.

Use the project's status semantics. A custom `ready for testing` status may
mean implementation is complete while testing or acceptance remains; it does
not mean `done`. Mark `done` only when the task's completion criteria are met.
If work is blocked, set `blocked` with the specific task ID, decision, access,
or external dependency. Preserve incomplete and uncertain work. Never close
or cancel a task merely because it is old or its chat has ended.

Task execution does not imply authority for commits, pushes, PRs, merges,
deployments, production changes, purchases, or messages to other people.
Follow the user's existing authorization for those actions.

Example: “Work on my-api `infra-1000`; implement locally and leave it ready for
testing after the local checks pass.”

## Work chats and session links

The task detail's chat button opens an existing `codex://threads/<id>` link,
offers a choice when there are several, or asks the host for a new work chat.
When this chat was started from that button, use the project directory and
task path supplied in its opening request; the chat's initial working
directory may differ. Continue here rather than creating another chat.

Before substantive work, record this chat's actual thread link in the task's
Agent Sessions section. Use trusted runtime context such as `CODEX_THREAD_ID`;
never guess an ID or identify the current chat from its title alone. Preserve
existing links and add the current link only once. Use a fresh task revision
for TOML writes; legacy task updates follow the project's own documented
workflow. If the ID is unavailable or the file is archived, report that limit.

An explicit request for a separate work chat can also use Codex's native
`list_projects` and `create_thread` tools, choosing the matching saved project.
Use the returned real `threadId` for its link; a queued `clientThreadId` is not
a chat deeplink. Open an existing linked chat with `navigate_to_codex_page`.
Ordinary task capture or work in the current chat does not request a new one.

## Edit safely

The task menu's Start working action uses the same work-chat flow. Task IDs
and task-file links in the UI navigate within the selected project and view;
plain external blocker explanations do not identify another task.

For an explicitly requested reversal, `todo_undo_task` uses the `undoToken`
returned by a successful task write in this server session. It restores the
previous file exactly, removes an unchanged newly created task, or restores an
archive batch to its original paths. Apply
undo in reverse order; it rejects newer disk edits, changed project roots,
dependent tasks, and invalid workflow states. Never invent a receipt or
overwrite newer work to make undo succeed. The UI's Cmd-Z uses this tool for
its recent task-file actions; text fields keep normal typing undo.

Use `todo_set_status` for transitions and `todo_toggle_checklist` for individual
checkboxes. Use `todo_save_task` for body, labels, or other frontmatter changes.
Always use the exact `etag` from the latest read or mutation. On a conflict,
preserve the intended edit, read again, and reconcile with the newer file;
never retry by overwriting it blindly.

Keep `task_id`, `added`, and filenames stable. Shared files use TOML fenced
with `+++`; required fields are `task_id`, `status`, `worth`, `added`, `summary`,
and `labels`. Put extra context in the Markdown body. Statuses and labels are
case-sensitive, non-empty single-line values of at most 100 characters.
Labels contain 1–3 unique comma-separated values. Only `done` and `cancelled`
are closed; other custom statuses remain active.

`blocked_by` is required only for `blocked`. Leaving `blocked` clears it.
An exact ID must reference another active task and cannot reference itself.
Do not close a task while another blocked task depends on it.

Project CLI validators may have stricter status or label lists than the plugin.
Workhub does not run project validators or refresh their indexes. Run those
commands separately when the project's policy requires them, and report their
actual results. Do not claim project checks passed or silently rewrite values
to bypass its policy. Upgrade project scripts and policies only within
authorized scope.

## Archive completed tasks

Archive only when the user asks for it and the project's policy permits the
requested move. Ordinary task editing and completion do not authorize archiving.
The UI's Archive done button previews all current done files before confirmation.

For an agent operation, inspect the current project's policy and `todo_open`
snapshot. Read each intended file with `todo_get_task`, verify its status is
exactly `done`, and use that fresh `{file, etag}` list with `todo_archive_done`.
Do not include cancelled, custom active, or already archived tasks. The server
preserves file contents and names while moving them to the connected task
folder's `archive/` (sibling `todo/archive/` for existing `todo/tasks/`); it
rejects stale revisions, destination collisions, malformed metadata, and tasks
still named as blockers. Existing file-path references may need an authorized
update after moving. Never overwrite an archive file to resolve a conflict.

Report the moved paths, separately run project checks, and returned undo receipt. For an
explicit reversal, use `todo_undo_task` with that receipt in reverse action
order. Archive undo restores the entire reviewed batch only while the archived
revisions are unchanged and their original destinations are free; preserve
external edits or new destination files when it refuses.

Legacy YAML is browse-only; `watch` appears as Blocked. Archived files
are read-only. Do not migrate, archive, or sweep tasks as part of ordinary
editing. Connecting or disconnecting changes only the local project registry.
