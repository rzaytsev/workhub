# Workhub project instructions

## Read first

Read [README.md](README.md) for the product and documentation entrypoints.
Read [docs/development.md](docs/development.md) for development and validation
and [docs/installation.md](docs/installation.md) for compatibility.
For todo-file rules, follow
[docs/shared-format.md](docs/shared-format.md) and the
[todo skill](plugins/workhub/skills/todo/SKILL.md). Read
[docs/sharing.md](docs/sharing.md) before packaging or distribution work.

Workhub is a local TypeScript MCP server and React/Vite MCP App for Markdown
tasks. Node.js 22.12 or newer is required. Keep the display name **Workhub**,
installation ID `workhub@workhub`,
`$todo` command, and existing MCP contracts compatible unless the user explicitly
requests a breaking change.

## Source map

- `src/store.ts`: task-file storage, validation, and workspace connections.
- `src/operations.ts` and `src/contracts.ts`: operations and shared contracts.
- `src/server.ts`: stdio MCP server; `src/dev.ts`: loopback preview.
- `src/app/`: UI, host bridge, styles, and shortcuts.
- `src/task-chat.ts` and `src/task-reference.ts`: chat links and task references.
- `plugins/workhub/skills/todo/SKILL.md`: editable source of the plugin skill.
- `scripts/package.ts`: generates plugin manifests and assets during the build.
- `scripts/install.ts`: registers and installs the local marketplace.
- `tests/`: unit tests; `scripts/smoke.ts` and `scripts/browser-smoke.ts`: integration checks.

Change source files rather than built output in `dist/` or installed plugin
caches. Change `scripts/package.ts` for generated manifest changes. Preserve
unrelated edits and keep changes scoped to the requested behavior.

## Task-file safety

Markdown files remain the source of truth. Shared TOML tasks are editable;
legacy YAML and archived files are browse-only. Do not migrate another
project's format or relax its policy without explicit authorization.

Preserve task IDs, capture dates, filenames, references, and uncertain work.
Use fresh revisions for writes and reconcile conflicts without overwriting
newer edits. Preserve the existing atomic writes, locks, symlink checks, blocker
validation, and three-task `doing` limit. Follow each connected project's own
`AGENTS.md`, linked task policy, validators, and status semantics.

Task completion does not imply archive permission. Archive only an explicitly
approved set of completed tasks, preserving filenames and contents. Keep undo
revision checks and dependent-task protections. Run project-specific validation and index commands separately from plugin writes.

Use temporary fixtures for tests. Smoke checks use isolated registries and temporary projects;
do not read or edit real connected task files as test data. Keep credentials and local
registry data out of code, reports, and distributable artifacts. Preserve the
preview's loopback binding, origin checks, and request-token protection.

## Validation and delivery

For code changes, run `npm run typecheck` and `npm test`. Run `npm run build`
when changing the UI, server, or packaging. For MCP changes, run `npm run smoke`;
for UI changes, run `npm run test:browser` and inspect the affected flow.
Documentation-only changes need a final diff review, not the full code suite.

Distinguish temporary-fixture tests, browser preview checks, simulated host
checks, and actual native Codex acceptance. Report only what was verified.
Update the README when user-visible behavior or commands change.

Installation, commits, pushes, PR creation, publishing, and changes to other
workspaces require explicit user authorization. When installation is authorized,
use `npm run build` followed by `npm run install-plugin`. Do not publish until
the applicable gates in `docs/sharing.md` have been met.
