export const shortcuts = {
  search: { keys: "⌘K / Ctrl+K", description: "Focus task search" },
  newTask: { keys: "N", description: "Create a task" },
  edit: { keys: "E", description: "Edit the selected task" },
  work: { keys: "W", description: "Start work or open its work chat" },
  done: { keys: "D", description: "Mark the selected task done or reopen it" },
  save: { keys: "⌘Enter / Ctrl+Enter", description: "Save the Markdown draft" },
  refresh: { keys: "R", description: "Refresh from local files" },
  tree: { keys: "T", description: "Switch to the tree list" },
  board: { keys: "B", description: "Switch to the board" },
  next: { keys: "J", description: "Select the next visible task" },
  previous: { keys: "K", description: "Select the previous visible task" },
  archiveDone: { keys: "Shift+A", description: "Review done tasks to archive" },
  undo: { keys: "⌘Z / Ctrl+Z", description: "Undo the last task-file action" },
  menu: { keys: "Shift+F10", description: "Open the focused item's actions" },
  help: { keys: "?", description: "Show this guide and shortcuts" },
  close: { keys: "Esc", description: "Close a menu, popup, or task details" },
} as const;
export type Shortcut = keyof typeof shortcuts;
export function tip(label: string, shortcut: Shortcut) {
  return `${label} (${shortcuts[shortcut].keys})`;
}
export function shortcutAction(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat"
  >,
  typing: boolean,
): Shortcut | undefined {
  if (event.repeat || event.altKey) return;
  const key = event.key.toLowerCase();
  if (event.metaKey || event.ctrlKey) {
    if (event.shiftKey) return;
    if (key === "k") return "search";
    if (key === "enter") return "save";
    if (key === "z" && !typing) return "undo";
    return;
  }
  if (key === "escape") return "close";
  if (typing) return;
  if (event.key === "?") return "help";
  if (event.shiftKey) return key === "a" ? "archiveDone" : undefined;
  return (
    {
      n: "newTask",
      e: "edit",
      w: "work",
      d: "done",
      r: "refresh",
      t: "tree",
      b: "board",
      j: "next",
      k: "previous",
    } as Record<string, Shortcut>
  )[key];
}
