import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const plugin = join(root, "plugins/workhub");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const lock = JSON.parse(
  await readFile(join(root, "package-lock.json"), "utf8"),
);
const description =
  "Manage local Markdown task files across workspaces and projects, with a tree and kanban board.";
const presentation = {
  displayName: "Workhub",
  shortDescription: "Local tasks, tree and kanban",
  longDescription: description,
  developerName: "Workhub contributors",
  category: "Productivity",
  capabilities: ["Interactive", "Read", "Write"],
  composerIcon: "./assets/icon.svg",
  logo: "./assets/icon.svg",
  defaultPrompt: ["Open my local todo workspace."],
};
await mkdir(join(plugin, ".codex-plugin"), { recursive: true });
await mkdir(join(plugin, "assets"), { recursive: true });
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
await writeFile(
  join(plugin, "plugin.json"),
  json({
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "workhub",
    version: pkg.version,
    description,
    license: "MIT",
    repository: "https://github.com/rzaytsev/workhub",
    extensions: { "com.openai": { interface: presentation } },
  }),
);
await writeFile(
  join(plugin, ".codex-plugin/plugin.json"),
  json({
    name: "workhub",
    version: pkg.version,
    description,
    license: "MIT",
    skills: "./skills/",
    mcpServers: "./.mcp.json",
    interface: presentation,
  }),
);
const launch = {
  command: "node",
  args: ["${PLUGIN_ROOT}/dist/server/server.js"],
};
await writeFile(
  join(plugin, "mcp.json"),
  json({
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: { "workhub": { type: "stdio", ...launch } },
  }),
);
await writeFile(
  join(plugin, ".mcp.json"),
  json({ mcpServers: { "workhub": launch } }),
);
await rm(join(plugin, "dist"), { recursive: true, force: true });
for (const directory of ["server", "app"]) {
  await cp(join(root, "dist", directory), join(plugin, "dist", directory), {
    recursive: true,
  });
}
await writeFile(
  join(plugin, "package.json"),
  json({ type: "module", engines: pkg.engines }),
);
await cp(join(root, "LICENSE"), join(plugin, "LICENSE"));

const notices: string[] = [
  "# Third-party notices\n\nThe built server and UI include the following runtime dependencies.\nTheir licenses and attribution remain applicable to those components.\n",
];
for (const [path, metadata] of Object.entries(lock.packages) as [
  string,
  { dev?: boolean; license?: string },
][]) {
  if (!path || metadata.dev) continue;
  const directory = join(root, path);
  const dependency = JSON.parse(
    await readFile(join(directory, "package.json"), "utf8"),
  );
  if (!metadata.license) throw Error(`Missing license for ${dependency.name}`);
  notices.push(
    `## ${dependency.name} ${dependency.version}\n\nLicense: ${metadata.license}\n`,
  );
  const files = (await readdir(directory))
    .filter((name) => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name))
    .sort();
  for (const file of files) {
    notices.push(
      `\n${file}:\n\n${await readFile(join(directory, file), "utf8")}\n`,
    );
  }
}
await writeFile(join(root, "docs/third-party-notices.md"), notices.join("\n"));
await cp(
  join(root, "docs/third-party-notices.md"),
  join(plugin, "THIRD_PARTY_NOTICES.md"),
);
await writeFile(
  join(plugin, "assets/icon.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#858a97" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="m7 8 2 2 3-4m-5 10 2 2 3-4M16 8h2m-2 8h2"/></svg>',
);
process.stdout.write(
  "Packaged Workhub with bundled runtime dependencies and portable launch paths\n",
);
