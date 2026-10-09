import { fileURLToPath } from "node:url";
import { basename, dirname } from "node:path";
import type { OpenAIElicitInput } from "@openai/mcp-extensions/server";

export async function chooseDirectory(elicitInput: OpenAIElicitInput) {
  const result = await elicitInput({
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
  });
  if (result.action !== "accept") return {};
  const uri = result.content?.directory;
  if (typeof uri !== "string" || !uri.startsWith("file:"))
    throw Error(
      "The folder picker did not return a local path. Enter the folder path manually.",
    );
  const path = fileURLToPath(uri);
  const suggestedRoot =
    basename(path) === "tasks" && basename(dirname(path)) === "todo"
      ? dirname(dirname(path))
      : dirname(path);
  return { path, suggestedRoot };
}
