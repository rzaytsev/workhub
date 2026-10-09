import { test } from "node:test";
import assert from "node:assert/strict";
import { referencedTask } from "../src/task-reference.js";
import { parseTask } from "../src/store.js";

const task = (id: string, title: string, file: string) =>
  parseTask(
    `+++\ntask_id = "${id}"\nstatus = "new"\nworth = "yes"\nadded = "2026-10-09"\nsummary = "${title}"\nlabels = "qa"\n+++\n`,
    file,
    "clos",
  );
const tasks = [
  task("infra-1", "Billing gate", "todo/tasks/gate.md"),
  task("api-2", "Test API", "todo/tasks/test.md"),
];
test("task references resolve IDs, relative and project paths, and unambiguous titles", () => {
  for (const ref of [
    "infra-1",
    "todo:infra-1",
    "todo/tasks/gate.md",
    "./gate.md",
    "../tasks/gate.md#definition",
    "/workspace/todo/tasks/gate.md",
    "billing gate",
  ]) {
    assert.equal(
      referencedTask(ref, tasks, "todo/tasks/test.md", "/workspace")?.id,
      "infra-1",
      ref,
    );
  }
  assert.equal(
    referencedTask("./gate%2Emd", tasks, "todo/tasks/test.md")?.id,
    "infra-1",
  );
});
test("task references reject ambiguous, missing, external and cross-project targets", () => {
  for (const ref of [
    "https://example.com/infra-1",
    "codex://threads/infra-1",
    "javascript:infra-1",
    "/other/todo/tasks/gate.md",
    "../../../todo/tasks/gate.md",
    "todo\\tasks\\gate.md",
    "%E0%A4%A",
    "infra-100",
    "An external billing issue",
  ]) {
    assert.equal(
      referencedTask(ref, tasks, "todo/tasks/test.md", "/workspace"),
      undefined,
      ref,
    );
  }
  assert.equal(
    referencedTask("Billing gate", [
      ...tasks,
      task("infra-3", "Billing gate", "todo/tasks/other.md"),
    ]),
    undefined,
  );
});
