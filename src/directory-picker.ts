import { fileURLToPath } from "node:url";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OpenAIElicitInput } from "@openai/mcp-extensions/server";

const execFileAsync = promisify(execFile);
const pickerTimeout = 120_000;
const macPickerScript = `
var app = Application.currentApplication();
app.includeStandardAdditions = true;
app.activate();
try {
  JSON.stringify(app.chooseFolder({
    withPrompt: "Choose a workspace or task folder for Workhub."
  }).toString());
} catch (error) {
  if (error.errorNumber === -128) "null";
  else throw error;
}
`;

async function chooseMacDirectory(signal: AbortSignal) {
  const { stdout } = await execFileAsync(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", macPickerScript],
    { signal, timeout: pickerTimeout, maxBuffer: 64 * 1024 },
  );
  return JSON.parse(stdout) as unknown;
}

export async function chooseDirectory(
  elicitInput: OpenAIElicitInput,
  options: {
    signal?: AbortSignal;
    platform?: NodeJS.Platform;
    nativePicker?: (signal: AbortSignal) => Promise<unknown>;
  } = {},
) {
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(pickerTimeout),
  ]);
  signal.throwIfAborted();
  let path: unknown;
  if ((options.platform ?? process.platform) === "darwin") {
    try {
      path = await (options.nativePicker ?? chooseMacDirectory)(signal);
    } catch {
      signal.throwIfAborted();
      throw Error(
        "The macOS folder picker could not open. Enter the folder path manually or try Browse again.",
      );
    }
    if (path === null) return {};
  } else {
    const result = await elicitInput(
      {
        mode: "form",
        message: "Choose a local workspace or task folder for Workhub.",
        requestedSchema: {
          type: "object",
          properties: {
            directory: {
              type: "string",
              title: "Local folder",
              format: "uri",
              "x-openai-input": {
                type: "file",
                options: [],
                userOptions: { kind: "directory" },
              },
            },
          },
          required: ["directory"],
        },
      },
      { signal, timeout: pickerTimeout, maxTotalTimeout: pickerTimeout },
    );
    if (result.action !== "accept") return {};
    const uri = result.content?.directory;
    if (typeof uri !== "string" || !uri.startsWith("file:"))
      throw Error(
        "The folder picker did not return a local path. Enter the folder path manually.",
      );
    path = fileURLToPath(uri);
  }
  signal.throwIfAborted();
  if (typeof path !== "string" || !isAbsolute(path))
    throw Error(
      "The folder picker did not return a local path. Enter the folder path manually.",
    );
  const selectedPath = resolve(path);
  const suggestedRoot =
    basename(selectedPath) === "tasks" &&
    basename(dirname(selectedPath)) === "todo"
      ? dirname(dirname(selectedPath))
      : dirname(selectedPath);
  return { path: selectedPath, suggestedRoot };
}
