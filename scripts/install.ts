import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = join(root, ".agents/plugins");
const marketplace = {
  name: "workhub",
  interface: { displayName: "Workhub" },
  plugins: [
    {
      name: "workhub",
      source: { source: "local", path: "./plugins/workhub" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    },
  ],
};
await mkdir(directory, { recursive: true });
const path = join(directory, "marketplace.json");
try {
  const previous = JSON.parse(await readFile(path, "utf8"));
  if (previous.name !== marketplace.name)
    throw Error(
      "An unrelated marketplace already exists. Preserve it and install manually.",
    );
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
await writeFile(path, JSON.stringify(marketplace, null, 2) + "\n");
const run = promisify(execFile);
for (const args of [
  ["plugin", "marketplace", "add", root, "--json"],
  ["plugin", "add", "workhub@workhub", "--json"],
]) {
  const { stdout, stderr } = await run("codex", args, { cwd: root });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}
