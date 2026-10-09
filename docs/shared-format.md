# Shared task format

Use TOML frontmatter with open status and label values. Markdown
files remain authoritative. The plugin does not migrate existing project files
or upgrade their validators.

```markdown
+++
task_id = "infra-1000"
status = "new"
worth = "yes"
added = "2026-10-09"
summary = "Connect a local project to the task workspace"
labels = "automation"
+++

# Connect a local project to the task workspace

## Definition

Describe the outcome and why it matters.

## Next

Name the next concrete action.

## Plan

- [ ] First step
- [ ] Verify the outcome

## References

Preserve Jira, GitHub, Slack, and contact context here.
```

New active files live directly in `todo/`, or another chosen task folder inside
the project. The folder may contain an `archive/` child, created on first approved
archive. Existing `todo/tasks/` layouts keep their files and sibling
`todo/archive/`; Workhub does not move files just by connecting them. Keep each filename stable when status,
labels, summary, or task IDs are standardized. Never rename a task merely
because an external issue was created. Use `task_id` for identity.

Required metadata: `task_id`, `status`, `worth`, `added`, `summary`, `labels`.
Optional metadata: `blocked_by`. Additional context belongs in the Markdown
body. The plugin accepts custom statuses and labels; existing project
validators may still restrict those values to their original vocabulary.

- Status: a non-empty single-line string; the usual values are `new`, `doing`,
  `blocked`, `done`, and `cancelled`. Custom values such as `ready for testing`
  are discovered automatically on refresh. Only `done` and `cancelled` are closed.
- Worth: `yes`, `later`.
- Added: immutable capture date as a quoted `YYYY-MM-DD` string.
- Labels: one to three distinct non-empty labels as a comma-separated string.
  Existing labels become suggestions; new labels such as `qa` or `regression`
  are accepted. A label cannot contain a comma.
- Statuses and individual labels are case-sensitive and at most 100 characters;
  control characters are not allowed. Surrounding whitespace is trimmed.
- Blocked tasks need a concise `blocked_by` string. An exact task ID must name
  another active task; free text can name an external decision or dependency.
- Clear `blocked_by` when leaving blocked. Limit `doing` to three tasks.
- Local IDs start at 1000 within an area. Confirmed issue IDs may use their
  issue number. New tasks stay in backlog until work starts with authority.

Use existing project labels when they fit. There is no plugin-wide allowlist.
Project switches discover each project's values independently. Frozen archive
files do not define the current workflow.

## Legacy YAML migration requirements

An upgrade must cover task files, scripts, templates, agent instructions,
brief workflows, and incoming links together.

| Existing field | Shared representation |
| --- | --- |
| Filename number and area | Stable task_id, with a reviewed area mapping |
| status: watch | status = "blocked"; keep the complete Watch section |
| blocked | blocked_by when blocked; otherwise preserve as body context |
| summary | summary |
| updated | Dated evidence in the body; added uses the earliest verified capture date |
| next | Next section in the body |
| jira, slack, contacts, extra fields | References or context sections in the body, without dropping values |

Capture an inventory and backups before migrating. Preserve the full original
body and any prose embedded in YAML frontmatter. Keep task filenames, update
references for any authorized task-folder move, and leave archives frozen.
Validate IDs, collisions, statuses, blockers, labels, WIP, and all local links.
Do not infer completion or invent a capture date during migration.
