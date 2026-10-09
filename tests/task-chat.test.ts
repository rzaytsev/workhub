import { test } from "node:test";
import assert from "node:assert/strict";
import { taskChats, taskWorkPrompt, isTaskChatUrl } from "../src/task-chat.js";
import type { Project, TaskDetail } from "../src/contracts.js";

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
test("finds and deduplicates real chat links, keeps labels, and ignores examples and malformed links", () => {
  const content = `## Agent Sessions
- [Work chat](codex://threads/${first})
- [Later session](codex://threads/${second}?view=review)
- [Current chat](codex://threads/${first})
\`\`\`md
[Example](codex://threads/00000000-0000-0000-0000-000000000000)
\`\`\`
\`\`\`\`md
\`\`\`
[Nested example](codex://threads/00000000-0000-0000-0000-000000000000)
\`\`\`\`
codex://threads/${first}bad
https://example.com/threads/${second}
codex://review?pr=example
codex://threads/not-a-thread-id
`;
  assert.deepEqual(taskChats(content), [
    { id: first, url: `codex://threads/${first}`, label: "Current chat" },
    { id: second, url: `codex://threads/${second}`, label: "Later session" },
  ]);
  assert(isTaskChatUrl(`codex://threads/${first}`));
  assert(!isTaskChatUrl(`codex://threads/${first}?view=review`));
  assert(!isTaskChatUrl(`https://example.com/${first}`));
});
test("new work chat targets the selected project and exact task, and requests an actual saved session link", () => {
  const project: Project = {
    id: "beta",
    name: "Beta API",
    root: "/projects/beta",
    format: "clos",
  };
  const task = {
    id: "api-3",
    area: "api",
    title: 'Verify "health" endpoint',
    file: "todo/tasks/api-3.md",
    absolutePath: "/projects/beta/todo/tasks/api-3.md",
  } as TaskDetail;
  const prompt = taskWorkPrompt(project, task);
  assert(prompt.includes('Workspace directory: "/projects/beta"'));
  assert(prompt.includes('Project: "api"'));
  assert(prompt.includes('Task file: "/projects/beta/todo/tasks/api-3.md"'));
  assert(prompt.includes('Workhub workspace ID (projectId): "beta"'));
  assert(prompt.includes("CODEX_THREAD_ID"));
  assert(prompt.includes("latest exact etag"));
  assert(prompt.includes("never invent an ID"));
});
