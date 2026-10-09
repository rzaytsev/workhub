import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { chooseDirectory } from "../src/directory-picker.js";

test("directory picker requests the host's local directory field and decodes selected paths", async () => {
  const root = join(tmpdir(), "example project");
  const folder = join(root, "todo");
  const result = await chooseDirectory(
    async (request, options) => {
      assert.ok(options?.signal);
      assert.equal(options.timeout, 120_000);
      assert.equal(options.maxTotalTimeout, 120_000);
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
    },
    { platform: "linux" },
  );
  assert.deepEqual(result, { path: folder, suggestedRoot: root });
  assert.equal(
    (
      await chooseDirectory(
        async () => ({
          action: "accept",
          content: { directory: pathToFileURL(join(folder, "tasks")).href },
        }),
        { platform: "linux" },
      )
    ).suggestedRoot,
    root,
  );
});
test("directory picker cancellation does nothing and nonlocal resources require manual entry", async () => {
  assert.deepEqual(
    await chooseDirectory(async () => ({ action: "cancel" }), {
      platform: "linux",
    }),
    {},
  );
  await assert.rejects(
    chooseDirectory(
      async () => ({
        action: "accept",
        content: { directory: "resource://uploaded-folder" },
      }),
      { platform: "linux" },
    ),
    /local path/,
  );
});

test("macOS uses its native folder picker without a host elicitation request", async () => {
  const host = async (): Promise<never> => {
    throw Error("Unexpected host request");
  };
  const path = join(tmpdir(), "example project", "todo", "tasks");
  assert.deepEqual(
    await chooseDirectory(host, {
      platform: "darwin",
      nativePicker: async (signal) => {
        assert.equal(signal.aborted, false);
        return path + "/";
      },
    }),
    { path, suggestedRoot: dirname(dirname(path)) },
  );
  assert.deepEqual(
    await chooseDirectory(host, {
      platform: "darwin",
      nativePicker: async () => null,
    }),
    {},
  );
});

test("picker failures allow manual entry and cancellation stops the native request", async () => {
  const host = async (): Promise<never> => {
    throw Error("Unexpected host request");
  };
  for (const nativePicker of [
    async () => {
      throw Error("Native UI unavailable");
    },
    async () => "relative/path",
  ]) {
    await assert.rejects(
      chooseDirectory(host, { platform: "darwin", nativePicker }),
      /manually/,
    );
  }
  const controller = new AbortController();
  const request = chooseDirectory(host, {
    platform: "darwin",
    signal: controller.signal,
    nativePicker: (signal) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  });
  controller.abort(Error("Picker cancelled"));
  await assert.rejects(request, /Picker cancelled/);
  let opened = false;
  await assert.rejects(
    chooseDirectory(host, {
      platform: "darwin",
      signal: controller.signal,
      nativePicker: async () => {
        opened = true;
        return null;
      },
    }),
    /Picker cancelled/,
  );
  assert.equal(opened, false);
});
