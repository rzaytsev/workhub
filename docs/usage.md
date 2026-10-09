# Using Workhub

New installations start with no connected workspaces. The start page explains the
`todo/*.md` layout and required TOML metadata, and shows the prompt
`$todo init /path/to/project` for creating an empty task directory with three
project-specific example tasks. Replace the placeholder with your project folder
and send it in a Codex chat. **Connect workspace** accepts a workspace
root or its `todo` directory. **Task folder** can select any folder inside that
workspace, using a relative or absolute path. Leaving it blank detects `todo/`
or an existing `todo/tasks/` layout. TOML and legacy YAML are detected from
the files. Mixed formats require separate task folders.
If the task folder is missing, Workhub asks before creating the empty
folder and connecting it. Going back or closing the prompt creates nothing.
Existing task folders are preserved; example tasks are added through `$todo init`.
**Browse workspace** and **Browse task folder** request a local directory picker
from compatible Codex hosts. Canceling changes no connection or files. Manual
path entry remains available if the host cannot provide a local folder path.
New connections default to flat task files in `todo/`, with `todo/archive/`
created on the first approved archive. A custom task folder uses its own
`archive/` child; existing nested `todo/tasks/` uses sibling `todo/archive/`.
After migrating a previously registered YAML project, disconnect and reconnect
it to update its stored format.

**Settings** in the top header offers Default (the current purple), Blue, Green,
Orange, Pink, and Red accent colors. Changes apply immediately and save automatically
for all workspaces, including after reopening Workhub. Each color adapts to the host's
light or dark theme. Accent settings are outside task-file undo.

Connections and the accent preference are stored in `~/.local/share/codex-todo/projects.json` (override
with `TODO_CONFIG`). This stores paths and display names, not task copies.
Disconnecting a workspace removes its connection only.

Connected folders are **workspaces**. Task ID prefixes
such as `api`, `admin`, and `infra` are **projects** within a workspace. The left
sidebar lists **Projects** below **Tasks**, with **All projects** or one
discovered project; it filters both Tree and Board and resets when switching workspaces. New task
defaults to the selected project. The top header shows workspace, state, project,
and the number of tasks matching all current filters. Task references reveal their target even if
it belongs to a different project in the same workspace.

The tree groups tasks by project, then expands task checklists. Each workspace
discovers statuses and labels from its current Markdown frontmatter. New
statuses become board columns, task status options, and sidebar filters.
The toolbar's label dropdown has checkboxes for selecting several labels:
tasks matching any selected label appear in both Tree and Board.
**All labels** clears the filter; switching
workspaces resets it. Arrow keys navigate the dropdown, Space toggles a checkbox,
and Escape closes it. Discovered labels become filter options and suggestions when creating tasks;
the creation form also accepts new labels. The familiar backlog, in-progress,
blocked, done, and cancelled statuses remain available on an empty board.
**Show completed is on by default**, including after switching workspaces,
and the Done board column remains available when
completed tasks are hidden. **Show completed** and **Show archive** are separate
filters. Archived files are read-only. Task filenames remain stable after
status changes; a legacy done sweep remains a separate project operation.

**Archive done** reviews all `done` tasks in the selected workspace, including
those outside the current filters. Confirming moves the exact reviewed files
to the task folder's `archive/` (sibling `todo/archive/` for the existing nested
layout), preserving filenames and bytes. The directory is created only after
the archive preview passes validation. Stale previews, malformed
project metadata, symlinks, collisions, and tasks named as blockers are rejected.
If a batch move fails, earlier moves are reversed when their revisions still
match. Existing Markdown links to moved task files may need updating after the move.
Cmd-Z restores the whole batch during this session, provided archived files are
unchanged and the original paths remain free. Legacy YAML archives remain
browse-only. No existing project tasks are archived merely by installing this update.

In the tree list, a task checkbox marks it Done; unchecking returns it to
Backlog. Expanded subtasks have editable Markdown checkboxes. Checking every
subtask does not automatically close its parent. Drag board cards between
columns to change status, including custom statuses. Moving to Blocked asks
for a blocker. These editing controls remain disabled for legacy YAML and
archived tasks.

The play button beside the task's file button starts work or opens a `codex://threads/...`
link found in the Markdown. Multiple links open a chooser. With no link, it
requests a new Codex chat carrying the selected project directory, task path,
and work instructions. The new chat is instructed to save its actual thread
link in Agent Sessions before working; refresh the task afterward to see it.
The UI prevents repeated creation requests while waiting for that link.
Chat actions need a compatible Codex host; the loopback preview cannot create
or navigate Codex chats. Rejected host requests appear as errors.

Right-click a task row, board card, or checklist step for **Start working**,
**Edit content**, and **Change status**. The status picker shows the current
status and all statuses discovered in that project. Checklist menus also
complete or reopen the step. Shift-F10 opens the same menu from the keyboard;
arrow keys navigate and Escape dismisses it.

**Cmd-Z** (Ctrl-Z on other platforms) or the toolbar's undo button reverts
the last task-file action in the current project: a status change, checkbox,
saved content edit, task creation, or archive batch. Undo retains up to 20 recent actions
in the current UI/server session. It requires the exact revision written by
that action, preserves newer external edits, and applies the same workflow
validation. Undoing creation removes only the unchanged new file and refuses
if another task names it as a blocker. Text fields retain normal typing undo.
Chat requests, project connections, and view changes are outside file undo.

Workhub uses Codex's supplied font families and typography sizes, including
initial host styles, custom font declarations, and subsequent host style changes.
The standalone preview falls back to system fonts and a 14px base when no host
styles exist. Codex supplies the plugin's title; the hosted view hides its
duplicate branding. The standalone preview keeps one checklist icon and name.

The task detail panel's left edge is draggable. Its divider also supports
Left/Right arrows (Shift for a larger step), Home/End for the allowed bounds,
and double-click to reset. The width is retained while opening other tasks in
this UI session, with bounds that keep it usable on smaller windows. Long card
titles and inline-code paths wrap inside cards; title Markdown supports safe
code, bold, italic, and strikethrough formatting.

**Help**, next to Refresh,
opens a short guide and the full shortcut list. Button tooltips show shortcuts.
Single-letter actions apply outside text fields and use the selected task:

| Action                               | Shortcut               |
| ------------------------------------ | ---------------------- |
| Search                               | Cmd-K / Ctrl-K         |
| New / edit / work / done or reopen   | N / E / W / D          |
| Save draft                           | Cmd-Enter / Ctrl-Enter |
| Refresh / tree / board               | R / T / B              |
| Next / previous task                 | J / K                  |
| Review archive done                  | Shift-A                |
| Undo task-file action                | Cmd-Z / Ctrl-Z         |
| Focused item's menu                  | Shift-F10              |
| Help / close popup, menu, or details | ? / Esc                |

Task IDs in Markdown, relative task-file links, and blocker IDs or exact,
unambiguous task titles open the target in the current tree or board view.
Navigation reveals the target through active filters, selects it, and scrolls
to it. External blocker explanations without a task reference remain text.

Writes require the revision returned by the latest read. Stale saves are
rejected. Task files and directories cannot be symlinks. Saves preserve the
frontmatter format and validate required fields, blockers,
IDs, labels, and the project's WIP limit when entering `doing`.

Workhub does not execute scripts in connected workspaces. Run any project-specific
validation or index refresh separately, following that project's instructions.
Custom statuses and labels accepted by the plugin may still be rejected by a
project's own validator; update that policy only with authorization.

For example, changing frontmatter to `status = "ready for testing"` and
`labels = "qa,regression"` creates that column and those label options after
**Refresh from files**, returning to Workhub, or reopening the workspace.
Plugin writes refresh the view automatically. Opening Workhub rereads the selected
workspace instead of retaining an older host snapshot. **Read at** in the footer
shows that snapshot's read time, including seconds; it is not a live clock.
Returning focus to Workhub or
making its document visible reloads the selected workspace and open task,
including new and removed files. The view, filters, selection, and scroll position
are retained where their targets still exist. Focus and visibility events are
combined into one reload. Unsaved editor drafts and their original revision are
preserved; if the file changed on disk, a notice explains it and a stale save is
still rejected. Automatic refresh skips active operations and open dialogs or
context menus. External file edits are not watched continuously.
