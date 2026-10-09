export type Format = "clos" | "denti";
export const ACCENT_COLORS = [
  "default",
  "blue",
  "green",
  "orange",
  "pink",
  "red",
] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];
export type Project = {
  id: string;
  name: string;
  root: string;
  format: Format;
  taskDirectory?: string;
};
export function projectArchiveFolder(project: Project) {
  return !project.taskDirectory || project.taskDirectory === "todo/tasks"
    ? "todo/archive"
    : `${project.taskDirectory}/archive`;
}
export type TodoCreation = {
  root: string;
  taskDirectory: string;
};
export type ChecklistItem = {
  line: number;
  text: string;
  checked: boolean;
  depth: number;
};
export type Task = {
  id: string;
  file: string;
  title: string;
  status: string;
  area: string;
  labels: string[];
  blocked: string;
  added: string;
  updated: string;
  next: string;
  checklist: ChecklistItem[];
  archived: boolean;
};
export type TaskDetail = Task & {
  content: string;
  body: string;
  etag: string;
  absolutePath: string;
};
export type Snapshot = {
  accentColor?: AccentColor;
  projects: Project[];
  project?: Project;
  tasks: Task[];
  statuses: string[];
  labels: string[];
  warnings: string[];
  refreshedAt: string;
};
export const statusNames: Record<string, string> = {
  new: "Backlog",
  doing: "In progress",
  blocked: "Blocked",
  watch: "Watching",
  done: "Done",
  cancelled: "Cancelled",
};
export function statusName(status: string) {
  return Object.hasOwn(statusNames, status) ? statusNames[status] : status;
}
export function validTaskValue(value: string) {
  return (
    !!value.trim() && value.length <= 100 && !/[\x00-\x1f\x7f]/.test(value)
  );
}
