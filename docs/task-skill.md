# Task skill

The plugin includes the [todo skill](../plugins/workhub/skills/todo/SKILL.md)
for initializing projects, capturing new tasks, and working through existing
ones. It reads the selected project's instructions, checks duplicates,
captures acceptance criteria, preserves stable identity, and records progress
from actual evidence.

Example requests after Codex reloads the plugin:

- `$todo init` initializes this chat's project; `$todo init ~/projects/my-api` uses an explicit project directory.
- `$todo create an infra task in my-api to test runner recovery, with labels ci-cd and qa.`
- `$todo work on my-api infra-1000; implement locally and leave it ready for testing after local checks pass.`

Creating a task captures work; executing it requires a request to work on it.

`init` inspects the chosen project's instructions, README, configuration,
and source layout, creates a missing flat `todo/` folder, connects the
project, and adds three project-specific example tasks in Backlog. Each example
has context, references, a next step, and acceptance criteria. Re-running it
preserves existing tasks and adds no further examples. Existing legacy task
directories are reused in browse mode. This is a skill command for Codex,
rather than a terminal executable.

The local preview binds only to `127.0.0.1`, rejects other browser origins,
and uses a per-process request token. The plugin uses stdio and makes no outbound requests to a task service.
Task contents returned through MCP may be processed and retained by the Codex
host and its model provider. See [the privacy notes](privacy.md).
