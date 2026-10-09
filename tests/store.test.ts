import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  readdir,
  lstat,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoStore, checklist, parseTask, replaceField } from "../src/store.js";
import { execute } from "../src/operations.js";
import { statusName, type Snapshot } from "../src/contracts.js";

function document(id = "infra-1", status = "new", blocker = "") {
  return `+++\ntask_id = "${id}"\nstatus = "${status}"\nworth = "yes"\nadded = "2026-10-08"\nsummary = "Test task"\nlabels = "automation,ci-cd"\n${blocker ? `blocked_by = "${blocker}"\n` : ""}+++\n\n# A task\n\n- [ ] First step\n  - [x] Nested step\n\n\`\`\`md\n- [ ] Example, not a real step\n\`\`\`\n`;
}
async function fixture(t: TestContext) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "workhub-test-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "todo/tasks"), { recursive: true });
  const file = "todo/tasks/1-original-name.md";
  await writeFile(join(root, file), document());
  const store = new TodoStore(join(root, "registry.json"), [
    { id: "fixture", name: "Fixture", root, format: "clos" },
  ]);
  return { root, file, store };
}
test("reads canonical metadata and skips checkboxes inside fenced code", () => {
  const task = parseTask(document("webhook-gw-7"), "task.md", "clos");
  assert.equal(task.id, "webhook-gw-7");
  assert.equal(task.area, "webhook-gw");
  assert.deepEqual(task.labels, ["automation", "ci-cd"]);
  assert.equal(task.checklist.length, 2);
  assert.equal(task.checklist[1].depth, 1);
  assert.equal(checklist("~~~\n- [ ] Example\n~~~\n- [x] Actual").length, 1);
});
test("rejects malformed metadata and invalid dates", () => {
  for (const content of [
    document().replace("2026-10-08", "2026-02-30"),
    document().replace("automation,ci-cd", "automation,,ci-cd"),
    document().replace("automation,ci-cd", "qa,qa"),
    replaceField(document(), "status", " \t "),
    replaceField(document(), "status", "ready\u0000for testing"),
    replaceField(document(), "labels", "qa\u0000label"),
    document().replace("infra-1", "infra-01"),
    document("infra-1", "blocked"),
    document().replace("+++\n\n#", 'next = "extra field"\n+++\n\n#'),
  ])
    assert.throws(() => parseTask(content, "task.md", "clos"));
});
test("discovers custom statuses and labels from current files per project, including external edits", async (t) => {
  const { store, root, file } = await fixture(t);
  const custom = replaceField(
    document("infra-2", "ready for testing"),
    "labels",
    "qa,regression",
  );
  await writeFile(join(root, "todo/tasks/custom.md"), custom);
  await writeFile(
    join(root, "todo/tasks/duplicate-labels.md"),
    replaceField(document("infra-3", "all"), "labels", "qa,constructor"),
  );
  await mkdir(join(root, "todo/archive"));
  await writeFile(
    join(root, "todo/archive/frozen.md"),
    document("infra-99", "archived workflow"),
  );
  const snapshot = await store.snapshot("fixture", true);
  assert.equal(snapshot.warnings.length, 0);
  assert.deepEqual(snapshot.statuses, [
    "new",
    "doing",
    "blocked",
    "all",
    "ready for testing",
    "done",
    "cancelled",
  ]);
  assert.deepEqual(snapshot.labels, [
    "automation",
    "ci-cd",
    "constructor",
    "qa",
    "regression",
  ]);
  assert.equal(statusName("ready for testing"), "ready for testing");
  assert.equal(statusName("constructor"), "constructor");
  await writeFile(
    join(root, file),
    replaceField(
      document("infra-1", "awaiting acceptance"),
      "labels",
      "customer review",
    ),
  );
  assert(
    (await store.snapshot("fixture")).statuses.includes("awaiting acceptance"),
  );
  assert((await store.snapshot("fixture")).labels.includes("customer review"));
  const other = join(root, "other");
  await mkdir(join(other, "todo/tasks"), { recursive: true });
  await writeFile(join(other, "todo/tasks/other.md"), document("api-1"));
  const project = await store.connect(other, "Other");
  const otherSnapshot = await store.snapshot(project.id);
  assert(!otherSnapshot.statuses.includes("ready for testing"));
  assert(!otherSnapshot.labels.includes("qa"));
});
test("agent tools create new labels and transition through custom statuses with revision and blocker rules", async (t) => {
  const { store, file } = await fixture(t);
  const created = await execute(store, "todo_create_task", {
    projectId: "fixture",
    title: "Test recovery",
    area: "infra",
    labels: ["qa", "regression"],
  });
  const task = created.task as Awaited<ReturnType<TodoStore["read"]>>;
  const changed = await execute(store, "todo_set_status", {
    projectId: "fixture",
    file: task.file,
    etag: task.etag,
    status: "ready for testing",
  });
  const ready = changed.task as typeof task;
  assert.equal(ready.status, "ready for testing");
  assert.equal(ready.file, task.file);
  assert.deepEqual(ready.labels, ["qa", "regression"]);
  await assert.rejects(
    execute(store, "todo_set_status", {
      projectId: "fixture",
      file: task.file,
      etag: task.etag,
      status: "awaiting acceptance",
    }),
    /changed on disk/,
  );
  const blocker = await store.read("fixture", file);
  await store.changeStatus("fixture", file, blocker.etag, "blocked", ready.id);
  await assert.rejects(
    store.changeStatus("fixture", ready.file, ready.etag, "done"),
    /still names this task as its blocker/,
  );
  const blocked = await store.changeStatus(
    "fixture",
    ready.file,
    ready.etag,
    "blocked",
    "Testing environment unavailable",
  );
  const resumed = await store.changeStatus(
    "fixture",
    ready.file,
    blocked.task.etag,
    "ready for testing",
  );
  assert.equal(resumed.task.blocked, "");
  assert(
    (await store.snapshot("fixture")).statuses.includes("ready for testing"),
  );
  await assert.rejects(
    execute(store, "todo_create_task", {
      projectId: "fixture",
      title: "Invalid",
      labels: ["one,two"],
    }),
    /comma/,
  );
});
test("save preserves filename, rejects stale content, and retains capture date and ID", async (t) => {
  const { store, file, root } = await fixture(t);
  const old = await store.read("fixture", file);
  const changed = old.content.replace("Test task", "Updated summary");
  const saved = await store.save("fixture", file, old.etag, changed);
  assert.equal(saved.task.title, "Updated summary");
  assert.equal(saved.task.file, file);
  await assert.rejects(
    store.save("fixture", file, old.etag, old.content),
    /changed on disk/,
  );
  assert.equal(await readFile(join(root, file), "utf8"), changed);
  await assert.rejects(
    store.save(
      "fixture",
      file,
      saved.task.etag,
      changed.replace("infra-1", "infra-2"),
    ),
    /task_id is stable/,
  );
  await assert.rejects(
    store.save(
      "fixture",
      file,
      saved.task.etag,
      changed.replace("2026-10-08", "2026-10-09"),
    ),
    /immutable/,
  );
});
test("undo receipts restore exact content in reverse order and are single-use", async (t) => {
  const { store, file } = await fixture(t);
  const before = await store.read("fixture", file);
  const status = await store.changeStatus(
    "fixture",
    file,
    before.etag,
    "doing",
  );
  const checked = await store.toggle(
    "fixture",
    file,
    status.task.etag,
    status.task.checklist[0].line,
    true,
  );
  assert.equal(typeof status.undoToken, "string");
  await assert.rejects(
    store.undo("fixture", status.undoToken!),
    /changed on disk/,
  );
  const undoStep = await execute(store, "todo_undo_task", {
    projectId: "fixture",
    undoToken: checked.undoToken,
  });
  assert.equal((undoStep.task as typeof before).content, status.task.content);
  const undone = await store.undo("fixture", status.undoToken!);
  assert.equal(undone.task?.content, before.content);
  await assert.rejects(
    store.undo("fixture", status.undoToken!),
    /unavailable or expired/,
  );
});
test("undo refuses external edits and rejects receipts from other projects", async (t) => {
  const { store, file, root } = await fixture(t);
  const before = await store.read("fixture", file);
  const saved = await store.save(
    "fixture",
    file,
    before.etag,
    before.content + "\nLocal edit\n",
  );
  const external = saved.task.content + "\nNew external evidence\n";
  await writeFile(join(root, file), external);
  await assert.rejects(
    store.undo("fixture", saved.undoToken!),
    /Newer edits have been preserved/,
  );
  assert.equal(await readFile(join(root, file), "utf8"), external);
  await assert.rejects(
    store.undo("other", saved.undoToken!),
    /unavailable or expired/,
  );
  const restarted = new TodoStore(store.config, await store.projects());
  await assert.rejects(
    restarted.undo("fixture", saved.undoToken!),
    /unavailable or expired/,
  );
});
test("undo creation removes only an unchanged new task without dependents", async (t) => {
  const { store, file, root } = await fixture(t);
  const created = await store.create("fixture", "New work", "infra", ["qa"]);
  const old = await store.read("fixture", file);
  const dependency = await store.changeStatus(
    "fixture",
    file,
    old.etag,
    "blocked",
    created.task.id,
  );
  await assert.rejects(
    store.undo("fixture", created.undoToken),
    /another task names/,
  );
  await store.undo("fixture", dependency.undoToken!);
  const removed = await store.undo("fixture", created.undoToken);
  assert.equal(removed.removedFile, created.task.file);
  assert.equal(removed.task, undefined);
  await assert.rejects(readFile(join(root, created.task.file)), {
    code: "ENOENT",
  });
  assert.equal(await readFile(join(root, file), "utf8"), old.content);
  const edited = await store.create("fixture", "External work", "infra", [
    "qa",
  ]);
  await writeFile(
    join(root, edited.task.file),
    edited.task.content + "\nAgent work\n",
  );
  await assert.rejects(
    store.undo("fixture", edited.undoToken),
    /changed on disk/,
  );
});
test("undo retains current workflow validation and expires bounded session history", async (t) => {
  const { store, file, root } = await fixture(t);
  const before = await store.read("fixture", file);
  const doing = await store.changeStatus("fixture", file, before.etag, "doing");
  const released = await store.changeStatus(
    "fixture",
    file,
    doing.task.etag,
    "new",
  );
  for (let i = 2; i <= 4; i++)
    await writeFile(
      join(root, `todo/tasks/other-${i}.md`),
      document(`infra-${i}`, "doing"),
    );
  await assert.rejects(store.undo("fixture", released.undoToken!), /WIP limit/);
  assert.equal((await store.read("fixture", file)).status, "new");
  let current = await store.read("fixture", file);
  const first = await store.save(
    "fixture",
    file,
    current.etag,
    current.content + "\nFirst\n",
  );
  current = first.task;
  for (let i = 0; i < 20; i++)
    current = (
      await store.save(
        "fixture",
        file,
        current.etag,
        current.content + `\n${i}\n`,
      )
    ).task;
  await assert.rejects(
    store.undo("fixture", first.undoToken!),
    /unavailable or expired/,
  );
});
test("archives exact done files without content changes, reserves IDs, and undoes the whole batch", async (t) => {
  const { store, root, file } = await fixture(t);
  await writeFile(
    join(root, file),
    document("infra-1000", "done").replaceAll("\n", "\r\n"),
  );
  const second = "todo/tasks/second.md";
  await writeFile(join(root, second), document("infra-1001", "done"));
  const originals = await Promise.all(
    [file, second].map((file) => store.read("fixture", file)),
  );
  const result = await execute(store, "todo_archive_done", {
    projectId: "fixture",
    tasks: originals.map((task) => ({ file: task.file, etag: task.etag })),
  });
  assert.deepEqual(result.archivedFiles, [
    "todo/archive/1-original-name.md",
    "todo/archive/second.md",
  ]);
  const archiveTask = await store.read(
    "fixture",
    "todo/archive/1-original-name.md",
  );
  assert.equal(archiveTask.archived, true);
  assert.deepEqual(archiveTask.labels, ["automation", "ci-cd"]);
  assert.equal(archiveTask.body.includes("task_id ="), false);
  for (const task of originals) {
    await assert.rejects(readFile(join(root, task.file)), { code: "ENOENT" });
    assert.equal(
      await readFile(
        join(root, "todo/archive", task.file.split("/").pop()!),
        "utf8",
      ),
      task.content,
    );
  }
  const next = await store.create("fixture", "Next work", "infra", ["qa"]);
  assert.equal(next.task.id, "infra-1002");
  const undone = await store.undo("fixture", result.undoToken as string);
  assert.deepEqual(undone.restoredFiles, [file, second]);
  for (const task of originals)
    assert.equal(await readFile(join(root, task.file), "utf8"), task.content);
  await assert.rejects(
    store.undo("fixture", result.undoToken as string),
    /unavailable or expired/,
  );
});
test("archive rejects stale manifests, non-done tasks, dependencies, duplicates and filename collisions before moving files", async (t) => {
  const { store, root, file } = await fixture(t);
  const old = await store.read("fixture", file);
  await assert.rejects(
    store.archiveDone("fixture", [{ file, etag: old.etag }]),
    /stale/,
  );
  await assert.rejects(lstat(join(root, "todo/archive")), { code: "ENOENT" });
  const done = await store.changeStatus("fixture", file, old.etag, "done");
  const manifest = [{ file, etag: done.task.etag }];
  await assert.rejects(
    store.archiveDone("fixture", [...manifest, ...manifest]),
    /unique/,
  );
  await assert.rejects(
    store.archiveDone("fixture", [{ file, etag: old.etag }]),
    /stale/,
  );
  await writeFile(
    join(root, "todo/tasks/dependent.md"),
    document("infra-2", "blocked", "infra-1"),
  );
  await assert.rejects(
    store.archiveDone("fixture", manifest),
    /names it as a blocker/,
  );
  await rm(join(root, "todo/tasks/dependent.md"));
  await mkdir(join(root, "todo/archive"));
  const destination = join(root, "todo/archive/1-original-name.md");
  await writeFile(destination, "Frozen history\n");
  await assert.rejects(
    store.archiveDone("fixture", manifest),
    /Destination already exists/,
  );
  assert.equal(await readFile(destination, "utf8"), "Frozen history\n");
  assert.equal(await readFile(join(root, file), "utf8"), done.task.content);
  await rm(destination);
  const cancelled = await store.changeStatus(
    "fixture",
    file,
    done.task.etag,
    "cancelled",
  );
  await assert.rejects(
    store.archiveDone("fixture", [{ file, etag: cancelled.task.etag }]),
    /stale/,
  );
});
test("archive rejects symlinks and undo preserves newer archive edits or active destinations", async (t) => {
  const { store, root, file } = await fixture(t);
  const old = await store.read("fixture", file);
  const done = await store.changeStatus("fixture", file, old.etag, "done");
  const external = join(root, "external");
  await mkdir(external);
  await symlink(external, join(root, "todo/archive"));
  await assert.rejects(
    store.archiveDone("fixture", [{ file, etag: done.task.etag }]),
    /symlink/,
  );
  await rm(join(root, "todo/archive"));
  const archived = await store.archiveDone("fixture", [
    { file, etag: done.task.etag },
  ]);
  const target = join(root, archived.archivedFiles[0]);
  await writeFile(target, done.task.content + "\nExternal archive evidence\n");
  await assert.rejects(
    store.undo("fixture", archived.undoToken),
    /Newer edits have been preserved/,
  );
  await writeFile(target, done.task.content);
  await writeFile(join(root, file), document("infra-3"));
  await assert.rejects(
    store.undo("fixture", archived.undoToken),
    /Destination already exists/,
  );
  assert.equal(await readFile(join(root, file), "utf8"), document("infra-3"));
  assert.equal(await readFile(target, "utf8"), done.task.content);
});
test("a concurrent archive destination collision rolls back earlier moves without overwriting the new file", async (t) => {
  const { store, root, file } = await fixture(t);
  await writeFile(join(root, file), document("infra-1", "done"));
  const second = "todo/tasks/second.md";
  await writeFile(join(root, second), document("infra-2", "done"));
  const items = await Promise.all(
    [file, second].map((file) => store.read("fixture", file)),
  );
  type Move = (
    project: { id: string },
    file: string,
    target: string,
    etag: string,
  ) => Promise<void>;
  const seam = store as unknown as { moveExact: Move };
  const original = seam.moveExact.bind(store);
  seam.moveExact = async (project, file, target, etag) => {
    if (file === second)
      await writeFile(join(root, target), "Concurrent destination\n");
    await original(project, file, target, etag);
  };
  await assert.rejects(
    store.archiveDone(
      "fixture",
      items.map((task) => ({ file: task.file, etag: task.etag })),
    ),
    /EEXIST/,
  );
  for (const item of items)
    assert.equal(await readFile(join(root, item.file), "utf8"), item.content);
  assert.equal(
    await readFile(join(root, "todo/archive/second.md"), "utf8"),
    "Concurrent destination\n",
  );
  await assert.rejects(
    readFile(join(root, "todo/archive/1-original-name.md")),
    { code: "ENOENT" },
  );
});
test("status transitions enforce blockers, clear blockers, and enforce WIP", async (t) => {
  const { store, file, root } = await fixture(t);
  const task = await store.read("fixture", file);
  await assert.rejects(
    store.changeStatus("fixture", file, task.etag, "blocked"),
    /needs blocked_by/,
  );
  await assert.rejects(
    store.changeStatus("fixture", file, task.etag, "blocked", "infra-1"),
    /another active task/,
  );
  const blocked = await store.changeStatus(
    "fixture",
    file,
    task.etag,
    "blocked",
    "Waiting for user decision",
  );
  const unblocked = await store.changeStatus(
    "fixture",
    file,
    blocked.task.etag,
    "new",
  );
  assert.equal(unblocked.task.blocked, "");
  for (let i = 2; i <= 4; i++)
    await writeFile(
      join(root, `todo/tasks/${i}.md`),
      document(`infra-${i}`, "doing"),
    );
  await assert.rejects(
    store.changeStatus("fixture", file, unblocked.task.etag, "doing"),
    /WIP limit/,
  );
});
test("checkbox writes preserve CRLF and reject non-checkbox lines", async (t) => {
  const { store, file, root } = await fixture(t);
  await writeFile(join(root, file), document().replaceAll("\n", "\r\n"));
  const task = await store.read("fixture", file);
  const result = await store.toggle(
    "fixture",
    file,
    task.etag,
    task.checklist[0].line,
    true,
  );
  assert.equal(result.task.checklist[0].checked, true);
  assert.equal(
    result.task.content.replaceAll("\r\n", "").includes("\n"),
    false,
  );
  await assert.rejects(
    store.toggle("fixture", file, result.task.etag, 1, true),
    /not a checklist/,
  );
});
test("rejects path traversal, symlink files, and archive writes", async (t) => {
  const { store, file, root } = await fixture(t);
  await writeFile(join(root, "outside.md"), document());
  await symlink(join(root, "outside.md"), join(root, "todo/tasks/link.md"));
  await assert.rejects(
    store.read("fixture", "todo/tasks/../../outside.md"),
    /Only task files/,
  );
  await assert.rejects(
    store.read("fixture", "todo/tasks/link.md"),
    /regular file/,
  );
  await mkdir(join(root, "todo/archive"));
  await writeFile(
    join(root, "todo/archive/closed.md"),
    document("infra-99", "done"),
  );
  const closed = await store.read("fixture", "todo/archive/closed.md");
  await assert.rejects(
    store.save("fixture", closed.file, closed.etag, closed.content),
    /read-only/,
  );
  await assert.rejects(store.read("fixture", "/etc/passwd"), /Invalid task/);
  assert.equal((await store.read("fixture", file)).id, "infra-1");
});
test("creates a unique local ID and preserves existing tasks", async (t) => {
  const { store, root, file } = await fixture(t);
  const first = await store.create("fixture", "New useful task", "api", [
    "auth",
  ]);
  const second = await store.create("fixture", "Another task", "api", ["auth"]);
  assert.equal(first.task.id, "api-1000");
  assert.equal(second.task.id, "api-1001");
  assert.equal(first.task.status, "new");
  assert.equal(await readFile(join(root, file), "utf8"), document());
  await assert.rejects(
    store.create("fixture", "Bad title\nnew line", "api", ["auth"]),
    /one line/,
  );
});
test("connections survive a new process and disconnect never removes files", async (t) => {
  const { store, root, file } = await fixture(t);
  const other = join(root, "other");
  await mkdir(join(other, "todo/tasks"), { recursive: true });
  await writeFile(join(other, "todo/tasks/other.md"), document("web-1"));
  const project = await store.connect(join(other, "todo"), "Other");
  assert.equal(project.format, "clos");
  await assert.rejects(store.connect(other, "Duplicate"), /already connected/);
  const reopened = new TodoStore(store.config);
  assert.equal((await reopened.snapshot(project.id)).tasks[0].id, "web-1");
  await reopened.disconnect("fixture");
  assert.equal((await reopened.projects()).length, 1);
  assert.equal(await readFile(join(root, file), "utf8"), document());
});
test("a fresh registry starts empty and requires explicit workspace connections", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "todo-empty-test-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new TodoStore(join(root, "registry.json"));
  assert.deepEqual(await store.projects(), []);
  const snapshot = await store.snapshot();
  assert.deepEqual(snapshot.projects, []);
  assert.deepEqual(snapshot.tasks, []);
  await mkdir(join(root, "workspace/todo/tasks"), { recursive: true });
  const project = await store.connect(join(root, "workspace"), "Example");
  assert.equal(
    (await new TodoStore(store.config).projects())[0].id,
    project.id,
  );
});
test("a missing todo folder returns a creation request without writing anything", async (t) => {
  const { root } = await fixture(t);
  const workspace = join(root, "empty workspace");
  await mkdir(workspace);
  const store = new TodoStore(join(root, "pending/registry.json"));
  const result = await execute(store, "todo_connect_project", {
    path: workspace,
    name: "Empty",
  });
  assert.deepEqual(result, {
    needsTodoCreation: {
      root: workspace,
      taskDirectory: join(workspace, "todo"),
    },
  });
  assert.deepEqual(await readdir(workspace), []);
  assert.deepEqual(await store.projects(), []);
  await assert.rejects(lstat(join(root, "pending")), { code: "ENOENT" });
  await assert.rejects(
    store.connect(workspace, "Empty", "denti", true),
    /Legacy YAML/,
  );
  await assert.rejects(lstat(join(workspace, "todo")), { code: "ENOENT" });
});
test("confirmed creation supports a missing todo path and connects an empty editable workspace", async (t) => {
  const { root } = await fixture(t);
  const workspace = join(root, "new workspace");
  await mkdir(workspace);
  const store = new TodoStore(join(root, "new.json"));
  const args = { path: join(workspace, "todo"), name: "New" };
  assert(
    "needsTodoCreation" in (await execute(store, "todo_connect_project", args)),
  );
  const result = await execute(store, "todo_connect_project", {
    ...args,
    createTodo: true,
  });
  const snapshot = result.snapshot as Snapshot;
  assert.equal(snapshot.project?.root, workspace);
  assert.equal(snapshot.project?.format, "clos");
  assert.deepEqual(snapshot.tasks, []);
  assert.deepEqual(await readdir(join(workspace, "todo")), []);
  assert.equal((await new TodoStore(store.config).projects()).length, 1);
  await assert.rejects(
    store.connect(workspace, "Duplicate", undefined, true),
    /already connected/,
  );
});
test("creation never creates the workspace root or replaces files or symlink task directories", async (t) => {
  const { root } = await fixture(t);
  const store = new TodoStore(join(root, "new.json"));
  const absent = join(root, "absent");
  await assert.rejects(store.connect(absent, "Missing", undefined, true), {
    code: "ENOENT",
  });
  await assert.rejects(lstat(absent), { code: "ENOENT" });
  const outside = join(root, "outside");
  await mkdir(outside);
  for (const kind of [
    "todo file",
    "todo symlink",
    "tasks file",
    "tasks symlink",
  ]) {
    const workspace = join(root, kind);
    await mkdir(workspace);
    const target = kind.startsWith("tasks")
      ? join(workspace, "todo/tasks")
      : join(workspace, "todo");
    if (kind.startsWith("tasks")) await mkdir(join(workspace, "todo"));
    if (kind.endsWith("file")) await writeFile(target, "preserve me");
    else await symlink(outside, target);
    for (const createTodo of [false, true])
      await assert.rejects(
        store.connect(workspace, "Conflict", undefined, createTodo),
        /real directories/,
      );
    if (kind.endsWith("file"))
      assert.equal(await readFile(target, "utf8"), "preserve me");
  }
  assert.deepEqual(await readdir(outside), []);
  assert.deepEqual(await store.projects(), []);
});
test("confirmation rechecks directory safety and refuses a redirected workspace root", async (t) => {
  const { root } = await fixture(t);
  const workspace = join(root, "pending");
  const outside = join(root, "outside");
  await mkdir(workspace);
  await mkdir(outside);
  const store = new TodoStore(join(root, "new.json"));
  const args = { path: workspace, name: "Pending" };
  assert(
    "needsTodoCreation" in (await execute(store, "todo_connect_project", args)),
  );
  await symlink(outside, join(workspace, "todo"));
  await assert.rejects(
    execute(store, "todo_connect_project", { ...args, createTodo: true }),
    /real directories/,
  );
  await rm(workspace, { recursive: true });
  await symlink(outside, workspace);
  await assert.rejects(
    execute(store, "todo_connect_project", { ...args, createTodo: true }),
    /workspace path changed/,
  );
  assert.deepEqual(await readdir(outside), []);
  assert.deepEqual(await store.projects(), []);
});
test("a creation flag preserves existing flat task folders and their browse-only format", async (t) => {
  const { root } = await fixture(t);
  const workspace = join(root, "legacy");
  await mkdir(join(workspace, "todo"), { recursive: true });
  const file = join(workspace, "todo/1-task.md");
  const content =
    "---\nstatus: new\nsummary: Legacy task\narea: api\n---\n\n# Legacy task\n";
  await writeFile(file, content);
  const store = new TodoStore(join(root, "legacy.json"));
  const project = await store.connect(workspace, "Legacy", undefined, true);
  assert.equal(project.format, "denti");
  assert.equal(await readFile(file, "utf8"), content);
  await assert.rejects(lstat(join(workspace, "todo/tasks")), {
    code: "ENOENT",
  });
});
test("flat and custom TOML folders support safe edits, first archive, and undo", async (t) => {
  const { root } = await fixture(t);
  for (const folder of ["todo", "work-items"]) {
    const workspace = join(root, folder);
    await mkdir(join(workspace, folder), { recursive: true });
    await writeFile(
      join(workspace, folder, "original.md"),
      document("api-3", "done"),
    );
    const store = new TodoStore(join(root, `${folder}.json`));
    const project = await store.connect(
      workspace,
      "Custom",
      undefined,
      false,
      folder,
    );
    assert.equal(project.format, "clos");
    assert.equal(project.taskDirectory, folder);
    const task = await store.read(project.id, `${folder}/original.md`);
    const saved = await store.save(
      project.id,
      task.file,
      task.etag,
      task.content.replace("Test task", "Flat task"),
    );
    const created = await store.create(project.id, "Another task", "api", [
      "qa",
    ]);
    assert(created.task.file.startsWith(`${folder}/`));
    const archive = join(workspace, folder, "archive");
    await assert.rejects(lstat(archive), { code: "ENOENT" });
    const archived = await store.archiveDone(project.id, [
      { file: task.file, etag: saved.task.etag },
    ]);
    assert.deepEqual(archived.archivedFiles, [`${folder}/archive/original.md`]);
    assert(
      (await store.snapshot(project.id, true)).tasks.some((x) => x.archived),
    );
    await store.undo(project.id, archived.undoToken);
    assert.equal((await store.read(project.id, task.file)).title, "Flat task");
    await assert.rejects(store.read(project.id, "todo/tasks/escape.md"));
    await assert.rejects(
      store.read(project.id, `${folder}/archive/../../outside.md`),
    );
  }
});
test("custom folder creation stays inside an existing parent and preserves old connection fallback", async (t) => {
  const { root } = await fixture(t);
  const workspace = join(root, "project");
  await mkdir(workspace);
  const store = new TodoStore(join(root, "custom.json"));
  for (const taskDirectory of ["..", "../escape", workspace])
    await assert.rejects(
      store.connect(workspace, "Invalid", undefined, true, taskDirectory),
      /inside the workspace/,
    );
  await assert.rejects(
    store.connect(workspace, "Nested", undefined, true, "missing/parent"),
    /parent must already exist/,
  );
  assert.deepEqual(await readdir(workspace), []);
  const project = await store.connect(
    workspace,
    "Custom",
    undefined,
    true,
    "my tasks",
  );
  assert.equal(project.taskDirectory, "my tasks");
  assert.deepEqual(await readdir(join(workspace, "my tasks")), []);
  const migrated = join(root, "migrated");
  await mkdir(join(migrated, "todo"), { recursive: true });
  await writeFile(join(migrated, "todo/existing.md"), document("api-9"));
  const old = new TodoStore(join(root, "old.json"), [
    { id: "old", root: migrated, name: "Old", format: "clos" },
  ]);
  assert.equal((await old.snapshot("old")).tasks[0].file, "todo/existing.md");
  assert.equal(
    (
      await old.create("old", "Compatible task", "api", ["qa"])
    ).task.file.startsWith("todo/"),
    true,
  );
});
test("accent preferences persist across processes and connection changes without touching tasks", async (t) => {
  const { store, root, file } = await fixture(t);
  const before = await readFile(join(root, file), "utf8");
  assert.equal((await store.snapshot("fixture")).accentColor, "default");
  await execute(store, "todo_set_accent_color", { color: "green" });
  const reopened = new TodoStore(store.config);
  assert.equal((await reopened.snapshot("fixture")).accentColor, "green");
  const other = join(root, "other");
  await mkdir(join(other, "todo/tasks"), { recursive: true });
  const project = await reopened.connect(other, "Other");
  await reopened.disconnect(project.id);
  assert.equal((await reopened.snapshot("fixture")).accentColor, "green");
  assert.equal(await readFile(join(root, file), "utf8"), before);
  const registry = await readFile(store.config, "utf8");
  await assert.rejects(
    execute(store, "todo_set_accent_color", { color: "unknown" }),
  );
  assert.equal(await readFile(store.config, "utf8"), registry);
  await execute(reopened, "todo_set_accent_color", { color: "default" });
  assert.equal(
    (await new TodoStore(store.config).snapshot()).accentColor,
    "default",
  );
});
test("setting an accent before connecting preserves empty onboarding and legacy registries keep the default", async (t) => {
  const { store, root } = await fixture(t);
  await writeFile(
    store.config,
    JSON.stringify({ version: 1, projects: await store.projects() }),
  );
  assert.equal((await store.snapshot()).accentColor, "default");
  const empty = new TodoStore(join(root, "empty.json"));
  await execute(empty, "todo_set_accent_color", { color: "blue" });
  const snapshot = await new TodoStore(empty.config).snapshot();
  assert.deepEqual(snapshot.projects, []);
  assert.equal(snapshot.accentColor, "blue");
});
test("legacy YAML remains readable, maps watch to blocked, and cannot be edited", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "todo-legacy-test-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "todo"));
  const content =
    "---\nstatus: watch\nsummary: Legacy wait\narea: ci\nblocked: Review\nnext: Check review\n---\n\n## Watch\n\n- state: active\n";
  await writeFile(join(root, "todo/12-wait.md"), content);
  const store = new TodoStore(join(root, "registry.json"), [
    { id: "legacy", name: "Legacy", root, format: "denti" },
  ]);
  const task = await store.read("legacy", "todo/12-wait.md");
  assert.equal(task.status, "blocked");
  assert.equal(task.next, "Check review");
  await assert.rejects(
    store.save("legacy", task.file, task.etag, task.content),
    /Upgrade/,
  );
  assert.match((await store.snapshot("legacy")).warnings[0], /browse only/);
});
test("concurrent plugin writes cannot overwrite each other", async (t) => {
  const { store, file } = await fixture(t);
  const task = await store.read("fixture", file);
  const outcomes = await Promise.allSettled([
    store.save(
      "fixture",
      file,
      task.etag,
      replaceField(task.content, "summary", "One"),
    ),
    store.save(
      "fixture",
      file,
      task.etag,
      replaceField(task.content, "summary", "Two"),
    ),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((x) => x.status === "rejected").length, 1);
});
