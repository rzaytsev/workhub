# Installation

Download the ZIP from [Releases](https://github.com/rzaytsev/workhub/releases),
extract it, and run the two `codex plugin` commands below inside `workhub/`.
Validated updates to `main` publish a prerelease when the package version changes.

Clone this repository and register its included marketplace with the Codex CLI:

```sh
git clone https://github.com/rzaytsev/workhub.git
cd workhub
codex plugin marketplace add .
codex plugin add workhub@workhub
```

The plugin includes its built UI and server with bundled runtime dependencies.
Node.js 22.12 or newer must be available as `node` on Codex's PATH. No task-service
account or API key is required. Launch paths resolve from the installed plugin;
they do not point back to the author's machine or require this checkout's
`node_modules`.

For development, rebuild and install with `npm run build` followed by
`npm run install-plugin`. Restart Codex or open a new chat so it discovers the
plugin. Open **Workhub** from the plugin entrypoint, or ask Codex to open the
todo board. This is an experimental source release: native chat creation and
navigation still need acceptance in your Codex host.

## Compatibility after renaming

The installation ID is now `workhub@workhub`. Replace the previous plugin
installation when switching so two plugins do not edit the same tasks. The
`$todo` skill, `todo_*` MCP tool names, task formats, registry location
(`~/.local/share/codex-todo/projects.json`), `TODO_CONFIG`, resource URI, and
task lock names remain compatible. Existing connected workspaces are preserved.
