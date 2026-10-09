import { constants } from "node:fs";
import {
  readFile,
  writeFile,
  readdir,
  realpath,
  lstat,
  mkdir,
  rename,
  unlink,
  link,
  open,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  resolve,
  join,
  dirname,
  basename,
  relative,
  isAbsolute,
  sep,
} from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parse } from "smol-toml";
import type {
  Project,
  Format,
  Task,
  TaskDetail,
  Snapshot,
  ChecklistItem,
  AccentColor,
  TodoCreation,
} from "./contracts.js";
import {
  ACCENT_COLORS,
  validTaskValue,
  projectArchiveFolder,
} from "./contracts.js";

export const STATUSES = ["new", "doing", "blocked", "done", "cancelled"];
const ID = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*-[1-9][0-9]*$/;
const MAX_BYTES = 1024 * 1024;
const isTaskFilename = (name: string) =>
  name.endsWith(".md") &&
  !/^(index|README|review-|reconciliation-)/i.test(name);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
function textError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
export class MissingTodoDirectoryError extends Error {
  readonly creation: TodoCreation;
  constructor(root: string, taskDirectory: string) {
    super("This workspace has no task folder. Confirm creation to connect it.");
    this.creation = { root, taskDirectory };
  }
}
async function todoDirectoryExists(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error("Todo directories must be real directories, not symlinks.");
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
export function splitDocument(content: string) {
  const lines = content.split(/\r?\n/);
  const fence = lines[0]?.replace(/^\uFEFF/, "");
  if (fence !== "+++" && fence !== "---")
    throw Error("Task needs TOML frontmatter (+++).");
  const end = lines.findIndex((line, i) => i > 0 && line === fence);
  if (end < 1) throw Error("Frontmatter has no closing fence.");
  let metadata: Record<string, unknown>;
  if (fence === "+++") metadata = parse(lines.slice(1, end).join("\n"));
  else {
    metadata = {};
    for (const line of lines.slice(1, end)) {
      const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
      if (!match) continue; // Match the legacy project's parser; preserve prose in the raw document.
      if (match[1] in metadata)
        throw Error(`Duplicate metadata field: ${match[1]}`);
      metadata[match[1]] = match[2];
    }
  }
  return { metadata, body: lines.slice(end + 1).join("\n"), end, fence, lines };
}
export function checklist(content: string): ChecklistItem[] {
  let fenced = false;
  let fence = "";
  const items: ChecklistItem[] = [];
  for (const [line, value] of content.split(/\r?\n/).entries()) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(value)?.[1];
    if (marker) {
      if (!fenced) {
        fenced = true;
        fence = marker[0];
      } else if (marker[0] === fence) fenced = false;
      continue;
    }
    if (fenced) continue;
    const match = /^(\s*)(?:[-*+] |\d+[.)] )\[([ xX])\]\s+(.*)$/.exec(value);
    if (match)
      items.push({
        line,
        checked: match[2].toLowerCase() === "x",
        text: match[3],
        depth: Math.floor(match[1].replaceAll("\t", "  ").length / 2),
      });
  }
  return items;
}
function field(
  values: Record<string, unknown>,
  name: string,
  required = false,
): string {
  const value = values[name];
  if (value == null && !required) return "";
  if (
    typeof value !== "string" ||
    (required && !value.trim()) ||
    /[\r\n\t]/.test(value)
  )
    throw Error(
      `${name} must be a ${required ? "non-empty " : ""}single-line string.`,
    );
  return value;
}
function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function parseTask(
  content: string,
  file: string,
  format: Format,
  modified = "",
  archived = false,
): TaskDetail {
  const { metadata: m, body, fence } = splitDocument(content);
  if (format === "clos" && fence !== "+++")
    throw Error("Use the shared TOML format (+++), not YAML.");
  const title = field(m, "summary", true);
  const rawStatus = field(m, "status", true).trim();
  const status =
    rawStatus === "watch" && format === "denti" ? "blocked" : rawStatus;
  if (!validTaskValue(status))
    throw Error(
      "Status must be a non-empty single-line value of at most 100 characters.",
    );
  const id =
    format === "clos"
      ? field(m, "task_id", true)
      : (/^\d+/.exec(basename(file))?.[0] ?? basename(file, ".md"));
  const area =
    format === "clos" ? id.replace(/-\d+$/, "") : field(m, "area") || "general";
  const labels = field(m, "labels")
    ? field(m, "labels")
        .split(",")
        .map((x) => x.trim())
    : [];
  const blocked = field(m, format === "clos" ? "blocked_by" : "blocked");
  const added = field(m, "added");
  if (format === "clos") {
    const unexpected = Object.keys(m).filter(
      (key) =>
        ![
          "task_id",
          "status",
          "worth",
          "added",
          "summary",
          "labels",
          "blocked_by",
        ].includes(key),
    );
    if (unexpected.length)
      throw Error(
        `Unsupported TOML metadata: ${unexpected.join(", ")}. Preserve extra context in the Markdown body.`,
      );
    if (!ID.test(id)) throw Error("task_id must use <area>-<positive number>.");
    if (!["yes", "later"].includes(field(m, "worth", true)))
      throw Error("worth must be yes or later.");
    if (!validDate(added))
      throw Error("added must be a valid YYYY-MM-DD date.");
    if (
      labels.length < 1 ||
      labels.length > 3 ||
      new Set(labels).size !== labels.length ||
      labels.some((x) => !validTaskValue(x))
    )
      throw Error(
        "Use 1–3 unique non-empty labels of at most 100 characters each.",
      );
    if (status === "blocked" && !blocked.trim())
      throw Error("A blocked task needs blocked_by.");
    if (status !== "blocked" && blocked)
      throw Error("Clear blocked_by when leaving blocked.");
  }
  return {
    id,
    file,
    title,
    status,
    area,
    labels,
    blocked,
    added,
    updated: field(m, "updated") || modified,
    next: field(m, "next"),
    checklist: checklist(content),
    archived,
    content,
    body,
    etag: sha(content),
    absolutePath: "",
  };
}
export function replaceField(content: string, key: string, value: string) {
  const doc = splitDocument(content);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const pattern = new RegExp(`^${key}\\s*${doc.fence === "+++" ? "=" : ":"}`);
  const line = doc.lines.findIndex(
    (x, i) => i > 0 && i < doc.end && pattern.test(x),
  );
  const replacement =
    doc.fence === "+++"
      ? `${key} = ${JSON.stringify(value)}`
      : `${key}: ${value}`;
  if (line > 0) doc.lines[line] = replacement;
  else doc.lines.splice(doc.end, 0, replacement);
  return doc.lines.join(newline);
}

export class TodoStore {
  readonly config: string;
  private undoHistory = new Map<
    string,
    { projectId: string; root: string } & (
      | {
          kind: "write";
          file: string;
          before?: string;
          etag: string;
        }
      | {
          kind: "archive";
          tasks: { file: string; archivedFile: string; etag: string }[];
        }
    )
  >();
  constructor(
    config = process.env.TODO_CONFIG ||
      join(homedir(), ".local/share/codex-todo/projects.json"),
    private seeds?: Project[],
  ) {
    this.config = config;
  }
  async projects(): Promise<Project[]> {
    return (await this.readConfig()).projects;
  }
  private async readConfig(): Promise<{
    projects: Project[];
    accentColor: AccentColor;
  }> {
    try {
      const config = JSON.parse(await readFile(this.config, "utf8"));
      if (
        !Array.isArray(config.projects) ||
        config.projects.some(
          (p: Project) =>
            !p ||
            !p.id ||
            !p.name ||
            !isAbsolute(p.root) ||
            !["clos", "denti"].includes(p.format) ||
            (p.taskDirectory !== undefined &&
              (typeof p.taskDirectory !== "string" ||
                !p.taskDirectory ||
                isAbsolute(p.taskDirectory) ||
                !inside(p.root, resolve(p.root, p.taskDirectory)) ||
                resolve(p.root, p.taskDirectory) === p.root)),
        )
      )
        throw Error("Invalid project registry.");
      return {
        projects: config.projects,
        accentColor: ACCENT_COLORS.includes(config.accentColor)
          ? config.accentColor
          : "default",
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return { projects: this.seeds ?? [], accentColor: "default" };
  }
  async connect(
    rootInput: string,
    name: string,
    format?: Format,
    createTodo = false,
    taskDirectory?: string,
  ) {
    if (!rootInput.trim())
      throw Error("Enter an existing workspace directory.");
    const input = resolve(rootInput.replace(/^~(?=$|\/)/, homedir()));
    const requestedRoot =
      basename(input) === "todo" && !taskDirectory ? dirname(input) : input;
    const root = await realpath(requestedRoot);
    if (createTodo && root !== requestedRoot)
      throw Error(
        "The workspace path changed. Connect again before creating its task folder.",
      );
    if (!(await lstat(root)).isDirectory())
      throw Error("The workspace path must be an existing directory.");
    if (!name.trim() || name.length > 80)
      throw Error("Project name must contain 1–80 characters.");
    if ((await this.projects()).some((x) => x.root === root))
      throw Error("This project is already connected.");
    let directory = resolve(
      root,
      (taskDirectory || "todo").replace(/^~(?=$|\/)/, homedir()),
    );
    await this.validateTaskDirectoryPath(root, directory, true);
    let exists = await todoDirectoryExists(directory);
    // Existing conventional workspaces keep their nested layout.
    if (
      !taskDirectory &&
      exists &&
      (await todoDirectoryExists(join(directory, "tasks")))
    ) {
      directory = join(directory, "tasks");
      exists = true;
    }
    if (!format && exists) {
      const formats = new Set<Format>();
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!isTaskFilename(entry.name) || !entry.isFile()) continue;
        const handle = await open(
          join(directory, entry.name),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          const buffer = Buffer.alloc(64);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          const fence = buffer
            .subarray(0, bytesRead)
            .toString("utf8")
            .replace(/^\uFEFF/, "");
          if (fence.startsWith("+++")) formats.add("clos");
          else if (fence.startsWith("---")) formats.add("denti");
        } finally {
          await handle.close();
        }
      }
      if (formats.size > 1)
        throw Error(
          "This folder mixes TOML and legacy YAML tasks. Choose a folder with one task format.",
        );
      format = formats.has("denti") ? "denti" : "clos";
    }
    format ??= "clos";
    if (!exists) {
      if (format === "denti")
        throw Error("Legacy YAML connections need an existing task folder.");
      if (!createTodo) throw new MissingTodoDirectoryError(root, directory);
    }
    const project: Project = {
      id: sha(root).slice(0, 16),
      name: name.trim(),
      root,
      format,
      taskDirectory: relative(root, directory).split(sep).join("/"),
    };
    await this.withConfigLock(async () => {
      const projects = await this.projects();
      if (projects.some((x) => x.root === root))
        throw Error("This project is already connected.");
      if (!exists) {
        if ((await realpath(root)) !== root)
          throw Error(
            "The workspace path changed. Connect again before creating its task folder.",
          );
        await this.validateTaskDirectoryPath(root, directory, true);
        await mkdir(directory);
      }
      await this.taskDirectory(project);
      await this.writeConfig([...projects, project]);
    });
    return project;
  }
  async disconnect(id: string) {
    await this.withConfigLock(async () =>
      this.writeConfig((await this.projects()).filter((x) => x.id !== id)),
    );
  }
  async setAccentColor(accentColor: AccentColor) {
    if (!ACCENT_COLORS.includes(accentColor))
      throw Error("Invalid accent color.");
    return this.withConfigLock(async () => {
      await this.writeConfig(await this.projects(), accentColor);
      return accentColor;
    });
  }
  private async writeConfig(projects: Project[], color?: AccentColor) {
    const accentColor = color ?? (await this.readConfig()).accentColor;
    const temporary = `${this.config}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporary,
        JSON.stringify({ version: 1, projects, accentColor }, null, 2) + "\n",
        { mode: 0o600, flag: "wx" },
      );
      await rename(temporary, this.config);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  private async withConfigLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.config), { recursive: true });
    return this.lock(`${this.config}.lock`, operation);
  }
  private async lock<T>(path: string, operation: () => Promise<T>): Promise<T> {
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw Error("Another Workhub write is running. Retry shortly.");
      throw e;
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      await unlink(path);
    }
  }
  async project(id: string) {
    const project = (await this.projects()).find((x) => x.id === id);
    if (!project) throw Error("Unknown project connection.");
    return project;
  }
  private async validateTaskDirectoryPath(
    root: string,
    directory: string,
    allowMissing = false,
  ) {
    if (!inside(root, directory) || directory === root)
      throw Error("Choose a task folder inside the workspace directory.");
    const parts = relative(root, directory).split(sep);
    let current = root;
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      if (
        !(await todoDirectoryExists(current)) &&
        (!allowMissing || index !== parts.length - 1)
      )
        throw Error("The task folder's parent must already exist.");
    }
  }
  private async taskDirectory(project: Project) {
    const root = await realpath(project.root);
    if (root !== project.root)
      throw Error(
        "The project root changed or became a symlink. Reconnect it.",
      );
    let directory = resolve(
      root,
      project.taskDirectory ||
        (project.format === "clos" ? "todo/tasks" : "todo"),
    );
    // Older connections remain usable after an explicitly requested flattening.
    if (
      !project.taskDirectory &&
      project.format === "clos" &&
      (await todoDirectoryExists(join(root, "todo"))) &&
      !(await todoDirectoryExists(directory))
    )
      directory = join(root, "todo");
    await this.validateTaskDirectoryPath(root, directory);
    if (!(await todoDirectoryExists(directory)))
      throw Error(
        "The connected task folder no longer exists. Reconnect the workspace.",
      );
    return directory;
  }
  private async resolveFile(project: Project, file: string) {
    if (isAbsolute(file) || !file.endsWith(".md"))
      throw Error("Invalid task path.");
    const dir = await this.taskDirectory(project);
    const path = resolve(project.root, file);
    const archive = join(project.root, projectArchiveFolder(project));
    if (dirname(path) !== dir && dirname(path) !== archive)
      throw Error(
        "Only task files inside the connected project's todo directory are allowed.",
      );
    if (dirname(path) === archive) {
      const stat = await lstat(archive);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error("Archive cannot be a symlink.");
    }
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > MAX_BYTES ||
      !inside(project.root, await realpath(path))
    )
      throw Error(
        "Task must be a regular file inside the project and under 1 MiB.",
      );
    return { path, archived: dirname(path) === archive };
  }
  async read(id: string, file: string) {
    const project = await this.project(id);
    const { path, archived } = await this.resolveFile(project, file);
    const info = await lstat(path);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const content = await handle.readFile("utf8");
      if (archived) {
        try {
          const task = parseTask(
            content,
            file,
            content.startsWith("+++") ? "clos" : "denti",
            info.mtime.toISOString().slice(0, 10),
            true,
          );
          task.absolutePath = path;
          return task;
        } catch {
          // Historical archives are displayable even when they predate the shared schema.
        }
        let title = /^#\s+(.+)$/m.exec(content)?.[1] || basename(file, ".md");
        let id = basename(file, ".md").split("-")[0];
        try {
          const { metadata } = splitDocument(content);
          title =
            typeof metadata.summary === "string" ? metadata.summary : title;
          id = typeof metadata.task_id === "string" ? metadata.task_id : id;
        } catch {
          /* Frozen archives may predate frontmatter. */
        }
        return {
          id,
          file,
          title,
          status: "done",
          area: "archive",
          labels: [],
          blocked: "",
          added: "",
          updated: info.mtime.toISOString().slice(0, 10),
          next: "",
          checklist: checklist(content),
          archived: true,
          content,
          body: content,
          etag: sha(content),
          absolutePath: path,
        };
      }
      const format =
        archived && content.startsWith("---") ? "denti" : project.format;
      const task = parseTask(
        content,
        file,
        format,
        info.mtime.toISOString().slice(0, 10),
        archived,
      );
      task.absolutePath = path;
      return task;
    } finally {
      await handle.close();
    }
  }
  async snapshot(
    projectId?: string,
    includeArchive = false,
  ): Promise<Snapshot> {
    const { projects, accentColor } = await this.readConfig();
    const project = projectId
      ? projects.find((x) => x.id === projectId)
      : projects[0];
    if (projectId && !project) throw Error("Unknown project connection.");
    const snapshot: Snapshot = {
      accentColor,
      projects,
      project,
      tasks: [],
      statuses: [...STATUSES],
      labels: [],
      warnings: [],
      refreshedAt: new Date().toISOString(),
    };
    if (!project) return snapshot;
    try {
      const directory = await this.taskDirectory(project);
      const directories = [directory];
      if (includeArchive) {
        const archive = join(project.root, projectArchiveFolder(project));
        try {
          const stat = await lstat(archive);
          if (stat.isDirectory() && !stat.isSymbolicLink())
            directories.push(archive);
        } catch {
          /* Archive is optional. */
        }
      }
      for (const dir of directories) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (!isTaskFilename(entry.name) || !entry.isFile()) continue;
          const file = relative(project.root, join(dir, entry.name));
          try {
            const {
              content: _content,
              body: _body,
              etag: _etag,
              absolutePath: _path,
              ...task
            } = await this.read(project.id, file);
            snapshot.tasks.push(task);
          } catch (e) {
            snapshot.warnings.push(`${file}: ${textError(e)}`);
          }
        }
      }
      const ids = new Set<string>();
      for (const task of snapshot.tasks.filter((t) => !t.archived)) {
        if (ids.has(task.id))
          snapshot.warnings.push(`Duplicate task ID: ${task.id}`);
        ids.add(task.id);
      }
      snapshot.tasks.sort((a, b) =>
        a.id.localeCompare(b.id, undefined, { numeric: true }),
      );
      const current = snapshot.tasks.filter((task) => !task.archived);
      const customStatuses = [...new Set(current.map((task) => task.status))]
        .filter((status) => !STATUSES.includes(status))
        .sort((a, b) => a.localeCompare(b));
      snapshot.statuses = [
        "new",
        "doing",
        "blocked",
        ...customStatuses,
        "done",
        "cancelled",
      ];
      snapshot.labels = [
        ...new Set(current.flatMap((task) => task.labels)),
      ].sort((a, b) => a.localeCompare(b));
      if (project.format === "denti")
        snapshot.warnings.unshift(
          "Legacy YAML project: browse only. Upgrade to the shared TOML format to enable editing. Watching tasks appear in Blocked.",
        );
    } catch (e) {
      snapshot.warnings.push(textError(e));
    }
    return snapshot;
  }
  private async validateWrite(
    project: Project,
    file: string,
    content: string,
    old?: TaskDetail,
  ) {
    if (project.format !== "clos")
      throw Error(
        "Upgrade this legacy YAML project to the shared TOML format before editing.",
      );
    if (Buffer.byteLength(content) > MAX_BYTES)
      throw Error("Task exceeds the 1 MiB limit.");
    const task = parseTask(content, file, project.format);
    if (old && old.id !== task.id)
      throw Error(
        "task_id is stable. Changing it would break task references.",
      );
    if (old && old.added !== task.added)
      throw Error("added is the immutable capture date.");
    const snapshot = await this.snapshot(project.id);
    if (snapshot.warnings.length)
      throw Error("Fix project metadata warnings before saving tasks.");
    const others = snapshot.tasks.filter((x) => x.file !== file);
    if (others.some((x) => x.id === task.id))
      throw Error(`Duplicate task ID: ${task.id}`);
    if (
      task.status === "doing" &&
      old?.status !== "doing" &&
      others.filter((x) => x.status === "doing").length >= 3
    )
      throw Error("WIP limit: at most 3 tasks can be in progress.");
    if (
      task.status === "blocked" &&
      ID.test(task.blocked) &&
      !others.some(
        (x) =>
          x.id === task.blocked && !["done", "cancelled"].includes(x.status),
      )
    )
      throw Error(
        "blocked_by must refer to another active task, or give an external reason.",
      );
    if (
      ["done", "cancelled"].includes(task.status) &&
      old?.status !== task.status &&
      others.some((x) => x.status === "blocked" && x.blocked === task.id)
    )
      throw Error(
        "Another task still names this task as its blocker. Update that dependency before closing this task.",
      );
    return task;
  }
  async save(id: string, file: string, etag: string, content: string) {
    const project = await this.project(id);
    const directory = await this.taskDirectory(project);
    return this.lock(join(directory, ".todo-local.lock"), async () => {
      const current = await this.read(id, file);
      if (current.archived) throw Error("Archived tasks are read-only.");
      if (current.etag !== etag)
        throw Error(
          "This task changed on disk. Reload it before saving; your draft has been kept.",
        );
      const task = await this.writeTask(project, current, content);
      return {
        task,
        undoToken:
          content !== current.content
            ? this.rememberUndo(project, task, current.content)
            : undefined,
        warnings: [],
      };
    });
  }
  private async writeTask(
    project: Project,
    current: TaskDetail,
    content: string,
  ) {
    await this.validateWrite(project, current.file, content, current);
    const directory = await this.taskDirectory(project);
    const { path } = await this.resolveFile(project, current.file);
    const temp = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
    try {
      const mode = (await lstat(path)).mode & 0o777;
      await writeFile(temp, content, { flag: "wx", mode });
      if ((await this.read(project.id, current.file)).etag !== current.etag)
        throw Error(
          "This task changed while saving. Reload before trying again.",
        );
      await rename(temp, path);
    } finally {
      await unlink(temp).catch(() => {});
    }
    return this.read(project.id, current.file);
  }
  private rememberUndo(project: Project, task: TaskDetail, before?: string) {
    const token = randomUUID();
    this.undoHistory.set(token, {
      kind: "write",
      projectId: project.id,
      root: project.root,
      file: task.file,
      before,
      etag: task.etag,
    });
    if (this.undoHistory.size > 20)
      this.undoHistory.delete(this.undoHistory.keys().next().value!);
    return token;
  }
  private async archiveDirectory(project: Project) {
    await this.taskDirectory(project);
    const directory = join(project.root, projectArchiveFolder(project));
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(directory)) !== directory
    )
      throw Error(
        "Archive must be a real directory inside the project, not a symlink.",
      );
    return directory;
  }
  private async requireMissing(path: string) {
    try {
      await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    throw Error(
      `Destination already exists: ${basename(path)}. No files were overwritten.`,
    );
  }
  private async moveExact(
    project: Project,
    file: string,
    target: string,
    etag: string,
  ) {
    const current = await this.read(project.id, file);
    if (current.etag !== etag)
      throw Error(`Task changed on disk: ${file}. Refresh before moving it.`);
    const { path } = await this.resolveFile(project, file);
    const destination = resolve(project.root, target);
    // Exclusive hard-link creation prevents overwriting a concurrently created destination.
    await link(path, destination);
    try {
      if (
        (await this.read(project.id, target)).etag !== etag ||
        (await this.read(project.id, file)).etag !== etag
      )
        throw Error(
          `Task changed while moving: ${file}. Newer edits have been preserved.`,
        );
      await unlink(path);
    } catch (error) {
      if ((await this.read(project.id, target)).etag === etag)
        await unlink(destination);
      throw error;
    }
  }
  private async moveBatch(
    project: Project,
    moves: { file: string; target: string; etag: string }[],
  ) {
    const completed: typeof moves = [];
    try {
      for (const move of moves) {
        await this.moveExact(project, move.file, move.target, move.etag);
        completed.push(move);
      }
    } catch (error) {
      const remaining: string[] = [];
      for (const move of completed.reverse()) {
        try {
          await this.moveExact(project, move.target, move.file, move.etag);
        } catch {
          remaining.push(move.target);
        }
      }
      if (remaining.length)
        throw Error(
          `Move stopped: ${textError(error)} Could not restore ${remaining.join(", ")}. Refresh and reconcile these files; no destinations were overwritten.`,
        );
      throw error;
    }
  }
  async archiveDone(id: string, manifest: { file: string; etag: string }[]) {
    const project = await this.project(id);
    if (project.format !== "clos")
      throw Error("Upgrade legacy YAML before archiving tasks.");
    if (
      !manifest.length ||
      new Set(manifest.map((task) => task.file)).size !== manifest.length
    )
      throw Error("Choose a non-empty list of unique done task files.");
    const directory = await this.taskDirectory(project);
    return this.lock(join(directory, ".todo-local.lock"), async () => {
      const snapshot = await this.snapshot(id);
      if (snapshot.warnings.length)
        throw Error("Fix project metadata warnings before archiving tasks.");
      const moves: { file: string; archivedFile: string; etag: string }[] = [];
      for (const item of manifest) {
        const task = await this.read(id, item.file);
        if (task.archived || task.status !== "done" || task.etag !== item.etag)
          throw Error(
            `Archive preview is stale: ${item.file}. Refresh and review the done tasks again.`,
          );
        const { path } = await this.resolveFile(project, task.file);
        if (relative(project.root, path) !== item.file)
          throw Error("Use the canonical task file path.");
        if (
          snapshot.tasks.some(
            (other) => other.file !== task.file && other.blocked === task.id,
          )
        )
          throw Error(
            `Cannot archive ${task.id}: another task names it as a blocker.`,
          );
        const archivedFile = join(
          projectArchiveFolder(project),
          basename(item.file),
        );
        await this.requireMissing(join(project.root, archivedFile));
        moves.push({ file: item.file, archivedFile, etag: item.etag });
      }
      await this.archiveDirectory(project);
      await this.moveBatch(
        project,
        moves.map((task) => ({
          file: task.file,
          target: task.archivedFile,
          etag: task.etag,
        })),
      );
      const token = randomUUID();
      this.undoHistory.set(token, {
        kind: "archive",
        projectId: id,
        root: project.root,
        tasks: moves,
      });
      if (this.undoHistory.size > 20)
        this.undoHistory.delete(this.undoHistory.keys().next().value!);
      return {
        archivedFiles: moves.map((task) => task.archivedFile),
        undoToken: token,
        warnings: [],
      };
    });
  }
  async undo(id: string, token: string) {
    const entry = this.undoHistory.get(token);
    if (!entry || entry.projectId !== id)
      throw Error("Undo is unavailable or expired for this project session.");
    const project = await this.project(id);
    if (project.root !== entry.root || project.format !== "clos")
      throw Error("The project connection changed. Undo is unavailable.");
    const directory = await this.taskDirectory(project);
    return this.lock(join(directory, ".todo-local.lock"), async () => {
      // Check again after acquiring the lock so simultaneous requests cannot reuse a receipt.
      if (!this.undoHistory.has(token))
        throw Error("This action was already undone.");
      if (entry.kind === "archive") {
        await this.archiveDirectory(project);
        for (const item of entry.tasks) {
          const task = await this.read(id, item.archivedFile);
          if (task.etag !== item.etag)
            throw Error(
              `Cannot undo archive: ${item.archivedFile} changed on disk. Newer edits have been preserved.`,
            );
          await this.requireMissing(join(project.root, item.file));
          await this.validateWrite(project, item.file, task.content);
        }
        await this.moveBatch(
          project,
          entry.tasks.map((task) => ({
            file: task.archivedFile,
            target: task.file,
            etag: task.etag,
          })),
        );
        this.undoHistory.delete(token);
        return {
          restoredFiles: entry.tasks.map((task) => task.file),
          warnings: [],
        };
      }
      const current = await this.read(id, entry.file);
      if (current.archived) throw Error("Archived tasks are read-only.");
      if (current.etag !== entry.etag)
        throw Error(
          "Cannot undo: this task changed on disk after that action. Newer edits have been preserved.",
        );
      let task: TaskDetail | undefined;
      if (entry.before !== undefined) {
        task = await this.writeTask(project, current, entry.before);
      } else {
        const snapshot = await this.snapshot(id);
        if (snapshot.warnings.length)
          throw Error(
            "Fix project metadata warnings before undoing task creation.",
          );
        if (
          snapshot.tasks.some(
            (t) =>
              t.file !== current.file &&
              t.status === "blocked" &&
              t.blocked === current.id,
          )
        )
          throw Error(
            "Cannot undo creation: another task names this task as its blocker.",
          );
        const { path } = await this.resolveFile(project, current.file);
        if ((await this.read(id, current.file)).etag !== entry.etag)
          throw Error(
            "Cannot undo: this task changed while undoing. Newer edits have been preserved.",
          );
        await unlink(path);
      }
      this.undoHistory.delete(token);
      return {
        task,
        removedFile: task ? undefined : current.file,
        warnings: [],
      };
    });
  }
  async changeStatus(
    id: string,
    file: string,
    etag: string,
    status: string,
    blockedBy = "",
  ) {
    const current = await this.read(id, file);
    let content = replaceField(current.content, "status", status);
    if (status === "blocked" || current.blocked)
      content = replaceField(
        content,
        "blocked_by",
        status === "blocked" ? blockedBy : "",
      );
    return this.save(id, file, etag, content);
  }
  async toggle(
    id: string,
    file: string,
    etag: string,
    line: number,
    checked: boolean,
  ) {
    const current = await this.read(id, file);
    if (!current.checklist.some((x) => x.line === line))
      throw Error("This line is not a checklist item.");
    const lines = current.content.split(/\r?\n/);
    lines[line] = lines[line].replace(/\[[ xX]\]/, checked ? "[x]" : "[ ]");
    return this.save(
      id,
      file,
      etag,
      lines.join(current.content.includes("\r\n") ? "\r\n" : "\n"),
    );
  }
  async create(id: string, title: string, area: string, labels: string[]) {
    const project = await this.project(id);
    const directory = await this.taskDirectory(project);
    if (!title.trim() || title.length > 300 || /[\r\n]/.test(title))
      throw Error("Use a task title of 1–300 characters on one line.");
    if (!/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/.test(area))
      throw Error("Area must use lowercase words separated by hyphens.");
    return this.lock(join(directory, ".todo-local.lock"), async () => {
      const tasks = (await this.snapshot(id, true)).tasks;
      let number = 1000;
      while (tasks.some((t) => t.id === `${area}-${number}`)) number++;
      const taskId = `${area}-${number}`;
      const slug =
        title
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 65) || "task";
      const file = relative(
        project.root,
        join(directory, `${taskId}-${slug}.md`),
      );
      const today = new Intl.DateTimeFormat("sv-SE").format(new Date());
      const content = `+++\ntask_id = ${JSON.stringify(taskId)}\nstatus = "new"\nworth = "yes"\nadded = "${today}"\nsummary = ${JSON.stringify(title.trim())}\nlabels = ${JSON.stringify(labels.join(","))}\n+++\n\n# ${title.trim()}\n\n## Definition\n\n${title.trim()}\n\n## Plan\n\n- [ ] Define the next concrete step\n`;
      await this.validateWrite(project, file, content);
      await writeFile(join(project.root, file), content, {
        flag: "wx",
        mode: 0o644,
      });
      const task = await this.read(id, file);
      return {
        task,
        undoToken: this.rememberUndo(project, task),
        warnings: [],
      };
    });
  }
}
