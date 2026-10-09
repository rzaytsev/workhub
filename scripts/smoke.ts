import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  cp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const temporary = await realpath(
  await mkdtemp(join(tmpdir(), "workhub-package-")),
);
const plugin = join(temporary, "plugin with spaces");
const config = join(temporary, "registry.json");
const client = new Client({ name: "todo-smoke", version: "1" });
try {
  await cp(new URL("../plugins/workhub/", import.meta.url), plugin, {
    recursive: true,
  });
  const manifest = JSON.parse(await readFile(join(plugin, "mcp.json"), "utf8"));
  const launch = manifest.mcpServers["workhub"];
  assert.equal(launch.type, "stdio");
  assert.equal(launch.command, "node");
  assert.deepEqual(launch.args, ["${PLUGIN_ROOT}/dist/server/server.js"]);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: launch.args.map((arg: string) =>
      arg.replaceAll("${PLUGIN_ROOT}", plugin),
    ),
    cwd: temporary,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      TODO_CONFIG: config,
    },
  });
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.title, "Workhub");
  const { tools } = await client.listTools();
  assert.equal(tools.length, 12);
  assert.equal(
    tools.find((tool) => tool.name === "todo_undo_task")?.annotations
      ?.destructiveHint,
    true,
  );
  const view = tools.find((tool) => tool.name === "todo_open")!;
  assert.equal(view.title, "Open Workhub");
  assert.deepEqual(
    (view._meta?.["openai/ui"] as { entrypoints: unknown[] }).entrypoints,
    [{ type: "global" }],
  );
  const empty = await client.callTool({ name: "todo_open", arguments: {} });
  assert(!empty.isError);
  assert.deepEqual(
    (empty.structuredContent as { snapshot: { projects: unknown[] } }).snapshot
      .projects,
    [],
  );
  const preference = await client.callTool({
    name: "todo_set_accent_color",
    arguments: { color: "blue" },
  });
  assert(!preference.isError);
  assert.equal(
    (preference.structuredContent as { accentColor: string }).accentColor,
    "blue",
  );
  const newRoot = join(temporary, "empty project");
  await mkdir(newRoot);
  const pending = await client.callTool({
    name: "todo_connect_project",
    arguments: { path: newRoot, name: "New" },
  });
  assert(!pending.isError);
  assert.deepEqual(pending.structuredContent, {
    needsTodoCreation: { root: newRoot, taskDirectory: join(newRoot, "todo") },
  });
  const created = await client.callTool({
    name: "todo_connect_project",
    arguments: { path: newRoot, name: "New", createTodo: true },
  });
  assert(!created.isError);
  const project = (
    created.structuredContent as { snapshot: { project: { id: string } } }
  ).snapshot.project;
  await client.callTool({
    name: "todo_disconnect_project",
    arguments: { projectId: project.id },
  });
  const workspace = join(temporary, "example");
  await mkdir(join(workspace, "todo/tasks"), { recursive: true });
  await writeFile(
    join(workspace, "todo/tasks/example.md"),
    '+++\ntask_id = "infra-1000"\nstatus = "new"\nworth = "yes"\nadded = "2026-10-09"\nsummary = "Example task"\nlabels = "automation"\n+++\n\n# Example task\n',
  );
  const connection = await client.callTool({
    name: "todo_connect_project",
    arguments: { path: workspace, name: "Example" },
  });
  assert(!connection.isError);
  const loaded = await client.callTool({ name: "todo_open", arguments: {} });
  assert(!loaded.isError);
  assert.equal(
    (loaded.structuredContent as { snapshot: { accentColor: string } }).snapshot
      .accentColor,
    "blue",
  );
  assert.equal(
    (loaded.structuredContent as { snapshot: { tasks: unknown[] } }).snapshot
      .tasks.length,
    1,
  );
  const resource = await client.readResource({
    uri: "ui://todo-local/workspace-v1",
  });
  const html = resource.contents[0];
  assert("text" in html && html.text.includes('<script type="module">'));
  assert("text" in html && html.text.includes("<title>Workhub</title>"));
  assert("text" in html && !html.text.includes('src="/assets/'));
  process.stdout.write(
    "MCP: relocated plugin without node_modules, empty onboarding, explicit fixture connection, 12 tools and self-contained UI passed\n",
  );
} finally {
  await client.close();
  await rm(temporary, { recursive: true, force: true });
}
