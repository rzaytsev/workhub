import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
} from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isTaskChatUrl } from "../task-chat.js";

declare global {
  interface Window {
    __TODO_PREVIEW__?: { token: string };
  }
}
type Data = Record<string, unknown>;
let app: App | undefined;
let extensions: OpenAIExtensions | undefined;
let ready: Promise<void> | undefined;
const subscribers = new Set<(data: Data) => void>();
let initialData: Data | undefined;
function receive(result: CallToolResult) {
  if (!result.isError && result.structuredContent) {
    initialData = result.structuredContent;
    subscribers.forEach((fn) => fn(result.structuredContent!));
  }
}
export function subscribe(fn: (data: Data) => void) {
  subscribers.add(fn);
  if (initialData) fn(initialData);
  return () => {
    subscribers.delete(fn);
  };
}
export function hasInitialSnapshot() {
  return initialData?.snapshot != null;
}
export function initialize(): Promise<void> {
  if (ready) return ready;
  if (window.__TODO_PREVIEW__) return (ready = Promise.resolve());
  document.documentElement.dataset.hosted = "true";
  app = new App({ name: "workhub", version: "0.9.0" });
  extensions = new OpenAIExtensions(app);
  const theme = () => {
    const context = app?.getHostContext();
    if (context?.theme) applyDocumentTheme(context.theme);
    if (context?.styles?.variables)
      applyHostStyleVariables(context.styles.variables);
    if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
  };
  app.ontoolresult = receive;
  app.onhostcontextchanged = theme;
  ready = app.connect().then(theme);
  return ready;
}
export async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<Data> {
  await initialize();
  let result: CallToolResult;
  if (window.__TODO_PREVIEW__) {
    result = await fetch("/api/tool", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Todo-Token": window.__TODO_PREVIEW__.token,
      },
      body: JSON.stringify({ name, arguments: args }),
    }).then((r) => r.json());
  } else result = await app!.callServerTool({ name, arguments: args });
  if (result.isError)
    throw Error(
      result.content
        .filter((x) => x.type === "text")
        .map((x) => x.text)
        .join("\n") || "Task operation failed.",
    );
  return result.structuredContent || {};
}
export async function syncContext(context: Record<string, unknown>) {
  await ready;
  if (app)
    await app
      .updateModelContext({
        structuredContent: context,
        content: [
          {
            type: "text",
            text: `Workhub selection: ${JSON.stringify(context)}`,
          },
        ],
      })
      .catch(() => {});
}
export async function openFile(path: string) {
  await ready;
  if (!extensions?.files)
    throw Error(
      "This host cannot open local files. Use the displayed file path in Codex.",
    );
  await extensions.files.open(path);
}
export function canCreateChat() {
  return extensions?.message != null;
}
export async function openTaskChat(url: string) {
  if (!isTaskChatUrl(url)) throw Error("Invalid Codex chat link.");
  await initialize();
  if (!app) throw Error("Open this workspace in Codex to follow chat links.");
  const result = await app.openLink({ url });
  if (result.isError) throw Error("Codex declined to open this chat link.");
}
export async function createTaskChat(prompt: string) {
  await initialize();
  if (!extensions?.message)
    throw Error(
      "Open this workspace in a Codex host that supports creating chats.",
    );
  const result = await extensions.message.send({
    role: "user",
    content: [{ type: "text", text: prompt }],
    _meta: { "openai/message": { target: "new", send: true } },
  });
  if (result.isError) throw Error("Codex declined to create the task chat.");
}
