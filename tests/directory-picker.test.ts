import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chooseDirectory } from "../src/directory-picker.js";

test("directory picker requests the host's local directory field and decodes selected paths", async () => {
  const root = join(tmpdir(), "example project");
  const folder = join(root, "todo");
  const result = await chooseDirectory(async (request) => {
    assert.deepEqual(request.requestedSchema.properties?.directory, {
      type: "string",
      title: "Local folder",
      format: "uri",
      "x-openai-input": {
        type: "file",
        options: [],
        userOptions: { kind: "directory" },
      },
    });
    return {
      action: "accept",
      content: { directory: pathToFileURL(folder).href },
    };
  });
  assert.deepEqual(result, { path: folder, suggestedRoot: root });
  assert.equal(
    (
      await chooseDirectory(async () => ({
        action: "accept",
        content: { directory: pathToFileURL(join(folder, "tasks")).href },
      }))
    ).suggestedRoot,
    root,
  );
});
test("directory picker cancellation does nothing and nonlocal resources require manual entry", async () => {
  assert.deepEqual(
    await chooseDirectory(async () => ({ action: "cancel" })),
    {},
  );
  await assert.rejects(
    chooseDirectory(async () => ({
      action: "accept",
      content: { directory: "resource://uploaded-folder" },
    })),
    /local path/,
  );
});
