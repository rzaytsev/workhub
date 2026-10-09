import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  OpenAIExtensions,
  type OpenAIUiToolMetadata,
  type OpenAIUiResourceMetadata,
} from "@openai/mcp-extensions/server";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { TodoStore } from "./store.js";
import { schemas, execute, type ToolName } from "./operations.js";
import { chooseDirectory } from "./directory-picker.js";

const UI = "ui://todo-local/workspace-v1";
const icon = {
  src:
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="m7 9 2 2 3-4m-5 9 2 2 3-4m3-5h3m-3 7h3"/></svg>',
    ),
  mimeType: "image/svg+xml",
  sizes: ["any"],
};
const server = new McpServer({
  name: "workhub",
  title: "Workhub",
  version: "0.9.1",
  icons: [icon],
});
const extensions = new OpenAIExtensions(server);
const store = new TodoStore();
const html = await readFile(
  new URL("../app/index.html", import.meta.url),
  "utf8",
);

registerAppResource(
  server,
  "todo-workspace",
  UI,
  {
    description:
      "Local task workspace with workspace and project selection, a tree and a kanban board.",
  },
  async () => ({
    contents: [
      {
        uri: UI,
        mimeType: RESOURCE_MIME_TYPE,
        text: html,
        _meta: {
          ui: {
            prefersBorder: false,
            csp: { connectDomains: [], resourceDomains: [] },
          },
          "openai/ui": {
            preferredDisplayMode: "fullscreen",
            availableDisplayModes: ["inline", "fullscreen"],
          } satisfies OpenAIUiResourceMetadata,
        },
      },
    ],
  }),
);
const titles: Record<ToolName, string> = {
  todo_choose_directory: "Choose a local folder",
  todo_set_accent_color: "Set Workhub accent color",
  todo_open: "Open Workhub",
  todo_connect_project: "Connect local workspace",
  todo_disconnect_project: "Disconnect workspace",
  todo_get_task: "Read task",
  todo_save_task: "Save task",
  todo_undo_task: "Undo task action",
  todo_archive_done: "Archive done tasks",
  todo_set_status: "Change task status",
  todo_toggle_checklist: "Update task checklist",
  todo_create_task: "Create task",
};
const descriptions: Record<ToolName, string> = {
  todo_choose_directory:
    "Ask the user to choose a local folder. Uses the native system dialog on macOS and OpenAI directory form fields on other compatible hosts. Returns its path and a suggested workspace root; cancellation returns no path. Does not connect or write files. Picker requests are cancellable and expire after two minutes; manual paths remain supported.",
  todo_set_accent_color:
    "Set the Workhub accent color across workspaces. Persists in the local plugin registry; does not change task files. Use default to restore the original purple accent.",
  todo_open:
    "Open Workhub or list tasks for a connected local workspace. Returns statuses and labels discovered from its Markdown files. Call without projectId to discover workspaces. The projectId argument identifies a workspace root; task area values identify projects such as api or admin. The shared TOML format is editable; legacy YAML is read-only.",
  todo_connect_project:
    "Connect an existing local workspace root with an optional taskDirectory inside it (relative or absolute). Defaults to todo; existing nested todo/tasks folders remain supported. TOML tasks are editable in either layout; legacy YAML is browse-only. A missing task folder returns needsTodoCreation without writes. After explicit user approval, retry with that canonical root and taskDirectory and createTodo: true to create the empty folder. Archive is created on first approved archive inside the selected folder (legacy todo/tasks uses todo/archive).",
  todo_disconnect_project:
    "Remove a local workspace connection. Does not remove or change task files.",
  todo_get_task:
    "Read a task's full Markdown, canonical path, and revision for subsequent edits. Use the file path returned by todo_open.",
  todo_save_task:
    "Save the full task Markdown with its exact read revision. Preserves task_id and filename. Validates metadata and rejects stale revisions. Project authority rules still apply; saving a task does not start its execution.",
  todo_undo_task:
    "Undo a successful task action using its returned undoToken, within this server session. Restores previous content, reverses an archive move, or removes a newly created task. Rejects newer disk revisions, changed project connections, dependencies, and invalid workflow states. Requires authorization to revert that action.",
  todo_archive_done:
    "Move an explicitly reviewed list of done TOML tasks to the connected folder's archive directory, creating it on first use and preserving filenames and bytes. Requires an exact file/etag manifest from latest reads and explicit authorization for those moves. Rejects stale revisions, non-done tasks, dependencies, symlinks and destination collisions. Returns a session undoToken. Never archives cancelled or active work.",
  todo_set_status:
    "Change task status with an exact read revision. Custom single-line statuses are allowed and discovered on refresh. Blocked requires a blocker; leaving blocked clears it. No files are moved and no work is started. Mark done only with evidence of completion.",
  todo_toggle_checklist:
    "Set a Markdown checkbox by the line number and revision returned by todo_get_task. Other content is preserved.",
  todo_create_task:
    "Create a new TOML task with a stable locally allocated area-1000+ ID, Backlog status, accepted worth, and 1–3 unique labels. Reuse labels returned by todo_open or supply new ones. No execution is started.",
};
for (const name of Object.keys(schemas) as ToolName[]) {
  registerAppTool(
    server,
    name,
    {
      title: titles[name],
      description: descriptions[name],
      inputSchema: schemas[name],
      annotations: {
        readOnlyHint: [
          "todo_open",
          "todo_get_task",
          "todo_choose_directory",
        ].includes(name),
        destructiveHint: ["todo_undo_task", "todo_archive_done"].includes(name),
        openWorldHint: name === "todo_connect_project",
        idempotentHint: [
          "todo_open",
          "todo_get_task",
          "todo_disconnect_project",
          "todo_set_accent_color",
        ].includes(name),
      },
      _meta: {
        ui: { resourceUri: UI, visibility: ["model", "app"] },
        "openai/ui": {
          entrypoints: name === "todo_open" ? [{ type: "global" }] : [],
        } satisfies OpenAIUiToolMetadata,
      },
    },
    async (
      args: Record<string, unknown>,
      extra: { signal: AbortSignal },
    ): Promise<CallToolResult> => {
      try {
        const data = await execute(store, name, args, () =>
          chooseDirectory(extensions.elicitInput, { signal: extra.signal }),
        );
        return {
          content: [
            {
              type: "text",
              text:
                name === "todo_open"
                  ? "Local task workspace loaded. See structuredContent.snapshot for projects and tasks."
                  : `${titles[name]} completed.`,
            },
          ],
          structuredContent: data,
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    },
  );
}
await server.connect(new StdioServerTransport());
