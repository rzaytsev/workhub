import type { Task } from "./contracts.js";

function normalize(path: string) {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

export function referencedTask(
  reference: string,
  tasks: Task[],
  sourceFile = "",
  root = "",
) {
  let value = reference.trim();
  if (value.startsWith("todo:")) value = value.slice(5);
  else if (/^[a-z][\w+.-]*:/i.test(value)) return undefined;
  try {
    value = decodeURIComponent(value.split(/[?#]/)[0]);
  } catch {
    return undefined;
  }
  if (!value || value.includes("\\")) return undefined;
  const byId = tasks.filter((task) => task.id === value);
  if (byId.length === 1) return byId[0];
  if (value.startsWith("/")) {
    if (!root || !value.startsWith(`${root}/`)) return undefined;
    value = value.slice(root.length + 1);
  }
  const files = [
    normalize(value),
    normalize(
      `${sourceFile.slice(0, sourceFile.lastIndexOf("/") + 1)}${value}`,
    ),
  ];
  const byFile = tasks.filter((task) => files.includes(task.file));
  if (byFile.length === 1) return byFile[0];
  const byTitle = tasks.filter(
    (task) => task.title.trim().toLowerCase() === value.toLowerCase(),
  );
  return byTitle.length === 1 ? byTitle[0] : undefined;
}
