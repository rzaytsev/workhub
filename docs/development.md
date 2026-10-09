# Development

Requires Node.js 22.12 or newer.

```sh
npm ci
npm run build
npm test
npm run dev
```

Open the loopback URL printed by `dev` for browser testing. The same built UI
is served as an MCP App by the stdio server in the plugin.

## Validation

```sh
npm run typecheck
npm test
npm run build
npm run smoke
npm run test:browser
```

Tests and MCP smoke checks use temporary project fixtures and isolated registries.
The smoke check copies the plugin to a directory with spaces outside the checkout
and launches its bundled server without `node_modules`. Browser checks use a
simulated MCP App host and remove their temporary screenshots afterward.

Browser tests need Playwright Chromium (`npx playwright install chromium`) or an
existing browser supplied through `PLAYWRIGHT_EXECUTABLE_PATH`. The checks cover
task-file revisions, archive/undo, blockers, custom statuses and labels, keyboard
navigation, host fonts, workspace isolation, focus refresh and unsaved drafts,
chat requests, and narrow layouts. Native Codex host acceptance and validation on
a second machine remain separate checks.

The display name is Workhub. The installation ID is `workhub@workhub`.
MCP tool names and argument fields, the local config location, and the `$todo`
skill remain compatible. In MCP arguments, `projectId` identifies a connected workspace
and `area` identifies its task project.

Built on [OpenAI MCP Extensions](https://github.com/openai/mcp-extensions),
the MCP SDK, and the MCP Apps standard. See the
[official plugin packaging guide](https://developers.openai.com/plugins/build/plugins).

The exact schema and legacy migration requirements are in
[docs/shared-format.md](shared-format.md).

Before distributing outside this machine, see the concrete remaining gates in
[docs/sharing.md](sharing.md).
