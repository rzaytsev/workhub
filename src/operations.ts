import { z } from "zod";
import { TodoStore, MissingTodoDirectoryError } from "./store.js";
import { ACCENT_COLORS, validTaskValue } from "./contracts.js";

const task = { projectId: z.string(), file: z.string() };
const revision = { ...task, etag: z.string().length(64) };
const workflowValue = z
  .string()
  .trim()
  .refine(
    validTaskValue,
    "Use a non-empty single-line value of at most 100 characters.",
  );
export const schemas = {
  todo_choose_directory: z.object({}),
  todo_set_accent_color: z.object({ color: z.enum(ACCENT_COLORS) }),
  todo_open: z.object({
    projectId: z.string().optional(),
    includeArchive: z.boolean().default(false),
  }),
  todo_connect_project: z.object({
    path: z.string(),
    name: z.string(),
    format: z.enum(["clos", "denti"]).optional(),
    createTodo: z.boolean().default(false),
    taskDirectory: z.string().min(1).optional(),
  }),
  todo_disconnect_project: z.object({ projectId: z.string() }),
  todo_get_task: z.object(task),
  todo_undo_task: z.object({
    projectId: z.string(),
    undoToken: z.string().uuid(),
  }),
  todo_archive_done: z.object({
    projectId: z.string(),
    tasks: z
      .array(z.object({ file: z.string(), etag: z.string().length(64) }))
      .min(1)
      .max(1000),
  }),
  todo_save_task: z.object({ ...revision, content: z.string() }),
  todo_set_status: z.object({
    ...revision,
    status: workflowValue,
    blockedBy: z.string().default(""),
  }),
  todo_toggle_checklist: z.object({
    ...revision,
    line: z.number().int().nonnegative(),
    checked: z.boolean(),
  }),
  todo_create_task: z.object({
    projectId: z.string(),
    title: z.string(),
    area: z.string().default("infra"),
    labels: z
      .array(
        workflowValue.refine(
          (label) => !label.includes(","),
          "A label cannot contain a comma.",
        ),
      )
      .min(1)
      .max(3),
  }),
};
export type ToolName = keyof typeof schemas;
export async function execute(
  store: TodoStore,
  name: string,
  input: unknown,
  chooseDirectory?: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case "todo_choose_directory": {
      schemas.todo_choose_directory.parse(input);
      if (!chooseDirectory)
        throw Error(
          "The folder picker needs a compatible Codex host. Enter the folder path manually.",
        );
      return chooseDirectory();
    }
    case "todo_set_accent_color": {
      const a = schemas.todo_set_accent_color.parse(input);
      return { accentColor: await store.setAccentColor(a.color) };
    }
    case "todo_open": {
      const a = schemas.todo_open.parse(input);
      return { snapshot: await store.snapshot(a.projectId, a.includeArchive) };
    }
    case "todo_connect_project": {
      const a = schemas.todo_connect_project.parse(input);
      try {
        const project = await store.connect(
          a.path,
          a.name,
          a.format,
          a.createTodo,
          a.taskDirectory,
        );
        return { snapshot: await store.snapshot(project.id) };
      } catch (e) {
        if (e instanceof MissingTodoDirectoryError)
          return { needsTodoCreation: e.creation };
        throw e;
      }
    }
    case "todo_disconnect_project": {
      const a = schemas.todo_disconnect_project.parse(input);
      await store.disconnect(a.projectId);
      return { snapshot: await store.snapshot() };
    }
    case "todo_get_task": {
      const a = schemas.todo_get_task.parse(input);
      return {
        projectId: a.projectId,
        task: await store.read(a.projectId, a.file),
      };
    }
    case "todo_save_task": {
      const a = schemas.todo_save_task.parse(input);
      return {
        projectId: a.projectId,
        ...(await store.save(a.projectId, a.file, a.etag, a.content)),
      };
    }
    case "todo_undo_task": {
      const a = schemas.todo_undo_task.parse(input);
      return {
        projectId: a.projectId,
        ...(await store.undo(a.projectId, a.undoToken)),
      };
    }
    case "todo_archive_done": {
      const a = schemas.todo_archive_done.parse(input);
      return {
        projectId: a.projectId,
        ...(await store.archiveDone(a.projectId, a.tasks)),
      };
    }
    case "todo_set_status": {
      const a = schemas.todo_set_status.parse(input);
      return {
        projectId: a.projectId,
        ...(await store.changeStatus(
          a.projectId,
          a.file,
          a.etag,
          a.status,
          a.blockedBy,
        )),
      };
    }
    case "todo_toggle_checklist": {
      const a = schemas.todo_toggle_checklist.parse(input);
      return {
        projectId: a.projectId,
        ...(await store.toggle(a.projectId, a.file, a.etag, a.line, a.checked)),
      };
    }
    case "todo_create_task": {
      const a = schemas.todo_create_task.parse(input);
      return {
        projectId: a.projectId,
        ...(await store.create(a.projectId, a.title, a.area, a.labels)),
      };
    }
    default:
      throw Error("Unknown todo tool.");
  }
}
