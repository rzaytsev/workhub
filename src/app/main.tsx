import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type {
  Task,
  TaskDetail,
  Snapshot,
  ChecklistItem,
  AccentColor,
  TodoCreation,
} from "../contracts.js";
import {
  ACCENT_COLORS,
  statusNames,
  statusName,
  projectArchiveFolder,
} from "../contracts.js";
import { taskChats, taskWorkPrompt, type TaskChat } from "../task-chat.js";
import { referencedTask } from "../task-reference.js";
import { shortcuts, shortcutAction, tip } from "./shortcuts.js";
import {
  call,
  initialize,
  subscribe,
  syncContext,
  openFile,
  hasInitialSnapshot,
  canCreateChat,
  createTaskChat,
  openTaskChat,
} from "./bridge.js";
import "./style.css";

type IconName =
  | "check"
  | "tree"
  | "board"
  | "search"
  | "plus"
  | "refresh"
  | "arrow"
  | "close"
  | "file"
  | "link"
  | "clock"
  | "folder"
  | "settings"
  | "chat"
  | "play"
  | "undo"
  | "help"
  | "tasks"
  | "archive"
  | "edit";
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    check: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <path d="m7 12 3 3 7-7" />
      </>
    ),
    tree: (
      <>
        <path d="M5 4v13h5M5 9h5" />
        <rect x="10" y="6" width="9" height="5" rx="1" />
        <rect x="10" y="14" width="9" height="5" rx="1" />
      </>
    ),
    board: (
      <>
        <rect x="3" y="4" width="7" height="16" rx="2" />
        <rect x="14" y="4" width="7" height="10" rx="2" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3" />
      </>
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    file: (
      <>
        <path d="M14 3H5v18h14V8Z" />
        <path d="M14 3v6h5M8 13h8M8 17h6" />
      </>
    ),
    link: (
      <>
        <path d="m10 14 4-4M9 16l-2 2a4 4 0 0 1-5-5l4-4a4 4 0 0 1 5 0M15 8l2-2a4 4 0 0 1 5 5l-4 4a4 4 0 0 1-5 0" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    folder: <path d="M3 6h6l2 3h10v11H3ZM3 6V4h6l2 2h8v3" />,
    chat: (
      <path d="M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-6 4V5a2 2 0 0 1 2-2ZM7 8h10M7 12h7" />
    ),
    play: <path d="m8 4 13 8-13 8Z" />,
    tasks: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <path d="m7 8 2 2 3-4m-5 10 2 2 3-4M16 8h2m-2 8h2" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2M12 17h.01" />
      </>
    ),
    archive: (
      <>
        <rect x="3" y="3" width="18" height="5" rx="1" />
        <path d="M5 8v13h14V8M10 12h4" />
      </>
    ),
    undo: (
      <>
        <path d="M4 4v6h6" />
        <path d="M4 10a8 8 0 1 1 1 8" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    edit: (
      <>
        <path d="m15 4 5 5M4 20l5-1L20 8l-5-5L4 14Z" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function Dot({ status }: { status: string }) {
  return (
    <span
      className={`status-dot ${Object.hasOwn(statusNames, status) ? status : "custom"}`}
      aria-label={statusName(status)}
    />
  );
}
function Progress({ task }: { task: Task }) {
  if (!task.checklist.length) return null;
  const done = task.checklist.filter((x) => x.checked).length;
  return (
    <span
      className="progress"
      title={`${done} of ${task.checklist.length} steps complete`}
    >
      <span className="progress-track">
        <span style={{ width: `${(done / task.checklist.length) * 100}%` }} />
      </span>
      {done}/{task.checklist.length}
    </span>
  );
}
function markdown(
  body: string,
  tasks: Task[] = [],
  sourceFile = "",
  root = "",
) {
  const html = DOMPurify.sanitize(marked.parse(body, { async: false }), {
    FORBID_TAGS: ["img", "style", "form", "input", "iframe"],
    FORBID_ATTR: ["style"],
  });
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("a").forEach((link) => {
    const target = referencedTask(
      link.getAttribute("href") || "",
      tasks,
      sourceFile,
      root,
    );
    if (target) {
      link.href = "#";
      link.dataset.todoFile = target.file;
      link.title = `${target.id} · ${target.title}`;
      return;
    }
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest("a, pre")) continue;
    const matches = [
      ...node.data.matchAll(
        /\b[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*-[1-9][0-9]*\b/g,
      ),
    ];
    let offset = 0;
    const fragment = doc.createDocumentFragment();
    for (const match of matches) {
      const target = referencedTask(match[0], tasks);
      if (!target) continue;
      fragment.append(node.data.slice(offset, match.index));
      const link = doc.createElement("a");
      link.href = "#";
      link.dataset.todoFile = target.file;
      link.title = `${target.id} · ${target.title}`;
      link.textContent = match[0];
      fragment.append(link);
      offset = match.index! + match[0].length;
    }
    if (offset) {
      fragment.append(node.data.slice(offset));
      node.replaceWith(fragment);
    }
  }
  return doc.body.innerHTML;
}
function taskTitle(title: string) {
  return DOMPurify.sanitize(marked.parseInline(title, { async: false }), {
    ALLOWED_TAGS: ["code", "strong", "em", "del"],
    ALLOWED_ATTR: [],
  });
}
function LabelFilter({
  labels,
  selected,
  onChange,
}: {
  labels: string[];
  selected: string[];
  onChange: (labels: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [popupLeft, setPopupLeft] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const popup = root.current!.querySelector<HTMLElement>(".label-options")!;
    const left = root.current!.getBoundingClientRect().left;
    setPopupLeft(
      Math.max(
        8 - left,
        Math.min(0, window.innerWidth - left - popup.offsetWidth - 8),
      ),
    );
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    const resize = () => setOpen(false);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
  return (
    <div
      className="label-filter"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && open) {
          e.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          if (!open) {
            setOpen(true);
            requestAnimationFrame(() =>
              root.current?.querySelector<HTMLInputElement>("input")?.focus(),
            );
            return;
          }
          const options = [
            ...root.current!.querySelectorAll<HTMLInputElement>("input"),
          ];
          const current = options.indexOf(
            document.activeElement as HTMLInputElement,
          );
          const index =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? options.length - 1
                : (current +
                    (e.key === "ArrowDown" ? 1 : -1) +
                    options.length) %
                  options.length;
          options[index]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className="label-filter-trigger"
        aria-label="Filter by labels"
        aria-expanded={open}
        aria-controls="label-options"
        title={
          selected.length
            ? `Labels: ${selected.join(", ")} (matches any)`
            : "Filter by labels"
        }
        onClick={() => setOpen(!open)}
      >
        <span>
          {selected.length === 0
            ? "All labels"
            : selected.length === 1
              ? selected[0]
              : `${selected.length} labels`}
        </span>
        <Icon name="arrow" size={14} />
      </button>
      {open && (
        <div
          id="label-options"
          className="label-options"
          style={{ left: popupLeft }}
          role="group"
          aria-label="Label options"
        >
          <label className="label-option">
            <input
              type="checkbox"
              checked={!selected.length}
              onChange={() => onChange([])}
            />
            <span>All labels</span>
          </label>
          <div className="label-option-list">
            {labels.map((label) => (
              <label className="label-option" key={label}>
                <input
                  type="checkbox"
                  checked={selected.includes(label)}
                  onChange={() =>
                    onChange(
                      selected.includes(label)
                        ? selected.filter((value) => value !== label)
                        : [...selected, label],
                    )
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <small>
            {labels.length
              ? "Matches any selected label"
              : "No labels in this workspace"}
          </small>
        </div>
      )}
    </div>
  );
}
function Workspace() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [view, setView] = useState<"tree" | "board">("tree");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [labelFilters, setLabelFilters] = useState<string[]>([]);
  const [taskProject, setTaskProject] = useState("");
  const [closed, setClosed] = useState(true);
  const [archive, setArchive] = useState(false);
  const [detail, setDetail] = useState<TaskDetail>();
  const [panelWidth, setPanelWidth] = useState(460);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef<
    { x: number; width: number; pointer: number } | undefined
  >(undefined);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<
    | "connect"
    | "new"
    | "blocked"
    | "discard"
    | "disconnect"
    | "chats"
    | "help"
    | "settings"
    | "archiveDone"
    | null
  >(null);
  const [blockTask, setBlockTask] = useState<TaskDetail>();
  const [chatChoices, setChatChoices] = useState<TaskChat[]>([]);
  const [requestedChats, setRequestedChats] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{
    projectId: string;
    task: Task;
    step?: ChecklistItem;
    x: number;
    y: number;
  }>();
  const [undoHistory, setUndoHistory] = useState<
    {
      projectId: string;
      token: string;
      label: string;
    }[]
  >([]);
  const [revealFile, setRevealFile] = useState<string>();
  const [archiveCandidates, setArchiveCandidates] = useState<TaskDetail[]>([]);
  const pending = useRef<(() => void) | undefined>(undefined);
  const snapshotSequence = useRef(0);
  const readSequence = useRef(0);
  const projectRef = useRef<string | undefined>(undefined);
  const detailFileRef = useRef<string | undefined>(undefined);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dirty = editing && detail != null && draft !== detail.content;
  const focusState = useRef({ detail, archive, dialog, menu });
  focusState.current = { detail, archive, dialog, menu };
  dirtyRef.current = dirty;
  projectRef.current = snapshot?.project?.id;
  detailFileRef.current = detail?.file;
  const project = snapshot?.project;
  const writable = project?.format === "clos";
  const undoEntry = [...undoHistory]
    .reverse()
    .find((entry) => entry.projectId === project?.id);
  const linkedChats = useMemo(
    () => (detail ? taskChats(detail.content) : []),
    [detail?.content],
  );
  const chatRequested =
    detail && requestedChats.has(`${project?.id}:${detail.file}`);
  const chatLabel =
    linkedChats.length > 1
      ? "Choose Codex chat"
      : linkedChats.length
        ? "Open Codex chat"
        : chatRequested
          ? "Work chat requested"
          : "Start working";
  const tasks = snapshot?.tasks || [];
  const taskProjects = [...new Set(tasks.map((task) => task.area))].sort();
  const scopedTasks = tasks.filter(
    (task) => !taskProject || task.area === taskProject,
  );
  const maxPanelWidth = Math.max(
    280,
    Math.min(
      900,
      viewportWidth <= 950 ? viewportWidth * 0.9 : viewportWidth - 240 - 320,
    ),
  );
  const visiblePanelWidth = Math.min(panelWidth, maxPanelWidth);
  function resizePanel(width: number) {
    setPanelWidth(Math.round(Math.max(280, Math.min(maxPanelWidth, width))));
  }
  const doneTasks = tasks.filter(
    (task) => !task.archived && task.status === "done",
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        (snapshot?.statuses || []).map((s) => [
          s,
          scopedTasks.filter((t) => !t.archived && t.status === s).length,
        ]),
      ),
    [snapshot, taskProject],
  );
  const filtered = tasks.filter((task) => {
    if (task.archived && !archive) return false;
    if (
      !closed &&
      !task.archived &&
      filter !== task.status &&
      ["done", "cancelled"].includes(task.status)
    )
      return false;
    if (filter !== null && task.status !== filter) return false;
    if (taskProject && task.area !== taskProject) return false;
    if (
      labelFilters.length &&
      !labelFilters.some((label) => task.labels.includes(label))
    )
      return false;
    return `${task.id} ${task.title} ${task.area} ${task.labels.join(" ")} ${task.blocked} ${task.next}`
      .toLowerCase()
      .includes(query.toLowerCase().trim());
  });
  const groups = [...new Set(filtered.map((x) => x.area))].sort();

  function guard(action: () => void) {
    if (busyRef.current) return;
    if (dirtyRef.current) {
      pending.current = action;
      setDialog("discard");
    } else action();
  }
  async function act(operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function refresh(
    projectId = projectRef.current,
    includeArchive = archive,
  ) {
    const sequence = ++snapshotSequence.current;
    const data = await call("todo_open", { projectId, includeArchive });
    if (sequence === snapshotSequence.current)
      setSnapshot(data.snapshot as Snapshot);
  }
  async function selectTask(task: Task, edit = false) {
    const projectId = projectRef.current;
    if (!projectId) return;
    const sequence = ++readSequence.current;
    setError("");
    try {
      const data = await call("todo_get_task", { projectId, file: task.file });
      if (sequence !== readSequence.current || projectRef.current !== projectId)
        return;
      setDetail(data.task as TaskDetail);
      setDraft((data.task as TaskDetail).content);
      setEditing(edit);
    } catch (e) {
      if (sequence === readSequence.current)
        setError(e instanceof Error ? e.message : String(e));
    }
  }
  function jumpToTask(task: Task) {
    guard(
      () =>
        void act(async () => {
          const projectId = project!.id;
          const sequence = ++readSequence.current;
          const data = await call("todo_get_task", {
            projectId,
            file: task.file,
          });
          if (
            sequence !== readSequence.current ||
            projectRef.current !== projectId
          )
            return;
          const latest = data.task as TaskDetail;
          setQuery("");
          setFilter(null);
          setLabelFilters([]);
          setTaskProject("");
          if (["done", "cancelled"].includes(latest.status)) setClosed(true);
          if (latest.archived) setArchive(true);
          await refresh(projectId, archive || latest.archived);
          setCollapsed((previous) => {
            const next = new Set(previous);
            next.delete(latest.area);
            return next;
          });
          setDetail(latest);
          setDraft(latest.content);
          setEditing(false);
          setRevealFile(latest.file);
        }),
    );
  }
  function followReference(e: React.MouseEvent<HTMLElement>) {
    const link =
      e.target instanceof Element
        ? e.target.closest<HTMLAnchorElement>("a[data-todo-file]")
        : null;
    if (!link) return;
    e.preventDefault();
    const target = tasks.find((task) => task.file === link.dataset.todoFile);
    if (target) jumpToTask(target);
  }
  function openMenu(
    task: Task,
    target: HTMLElement,
    x?: number,
    y?: number,
    step?: ChecklistItem,
  ) {
    if (!project || busyRef.current || dialog) return;
    const rect = target.getBoundingClientRect();
    setMenu({
      projectId: project.id,
      task,
      step,
      x: x ?? rect.left + 24,
      y: y ?? rect.top + Math.min(rect.height, 36),
    });
  }
  function menuKeys(
    e: React.KeyboardEvent<HTMLElement>,
    task: Task,
    step?: ChecklistItem,
  ) {
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      openMenu(task, e.currentTarget, undefined, undefined, step);
    }
  }
  function rememberUndo(data: Record<string, unknown>, label: string) {
    if (
      typeof data.undoToken !== "string" ||
      typeof data.projectId !== "string"
    )
      return;
    setUndoHistory((previous) =>
      [
        ...previous,
        {
          projectId: data.projectId as string,
          token: data.undoToken as string,
          label,
        },
      ].slice(-20),
    );
  }
  function undoLastAction() {
    if (!undoEntry || dialog || busyRef.current) return;
    guard(
      () =>
        void act(async () => {
          readSequence.current++;
          const data = await call("todo_undo_task", {
            projectId: undoEntry.projectId,
            undoToken: undoEntry.token,
          });
          setUndoHistory((previous) =>
            previous.filter((entry) => entry.token !== undoEntry.token),
          );
          if (data.restoredFiles) {
            const restored = (data.restoredFiles as string[]).find(
              (file) =>
                detail?.archived &&
                file.split("/").pop() === detail.file.split("/").pop(),
            );
            if (restored) {
              const current = await call("todo_get_task", {
                projectId: undoEntry.projectId,
                file: restored,
              });
              setDetail(current.task as TaskDetail);
              setDraft((current.task as TaskDetail).content);
            }
          } else if (data.task) {
            if (detail?.file === (data.task as TaskDetail).file) {
              setDetail(data.task as TaskDetail);
              setDraft((data.task as TaskDetail).content);
            }
          } else if (detail?.file === data.removedFile) {
            readSequence.current++;
            setDetail(undefined);
            setEditing(false);
          }
          const warnings = data.warnings as string[];
          setNotice(
            `Undid ${undoEntry.label}.${warnings?.length ? ` ${warnings.join(" ")}` : ""}`,
          );
          await refresh();
        }),
    );
  }
  function refreshFiles() {
    guard(
      () =>
        void act(async () => {
          await refresh();
          if (detail) await selectTask(detail, editing);
        }),
    );
  }
  function saveDraft() {
    if (!dirty || !writable || !detail || detail.archived) return;
    void act(async () => {
      await acceptMutation(
        await call("todo_save_task", {
          projectId: project!.id,
          file: detail.file,
          etag: detail.etag,
          content: draft,
        }),
        `content edit for ${detail.id}`,
      );
    });
  }
  function prepareArchive() {
    if (!writable || !project || !doneTasks.length) return;
    guard(
      () =>
        void act(async () => {
          const candidates = await Promise.all(
            doneTasks.map(async (task) => {
              const data = await call("todo_get_task", {
                projectId: project.id,
                file: task.file,
              });
              const latest = data.task as TaskDetail;
              if (latest.archived || latest.status !== "done")
                throw Error(
                  "Done tasks changed on disk. Refresh before reviewing the archive.",
                );
              return latest;
            }),
          );
          setArchiveCandidates(candidates);
          setDialog("archiveDone");
        }),
    );
  }
  function navigateTask(direction: number) {
    if (!filtered.length) return;
    const current = filtered.findIndex((task) => task.file === detail?.file);
    const target =
      filtered[
        current < 0
          ? direction > 0
            ? 0
            : filtered.length - 1
          : (current + direction + filtered.length) % filtered.length
      ];
    guard(() => void selectTask(target).then(() => setRevealFile(target.file)));
  }
  function switchProject(id: string) {
    guard(() => {
      readSequence.current++;
      setDetail(undefined);
      setEditing(false);
      setQuery("");
      setFilter(null);
      setLabelFilters([]);
      setTaskProject("");
      setClosed(true);
      setExpanded(new Set());
      setArchive(false);
      void act(() => refresh(id, false));
    });
  }
  async function acceptMutation(data: Record<string, unknown>, label: string) {
    rememberUndo(data, label);
    const task = data.task as TaskDetail;
    if (detail?.file === task.file) {
      setDetail(task);
      setDraft(task.content);
    }
    const warnings = data.warnings as string[];
    setNotice(
      warnings?.length ? warnings.join(" ") : "Saved to the task file.",
    );
    await refresh();
  }
  async function move(task: Task, status: string) {
    if (!writable || task.archived || task.status === status || busy) return;
    guard(
      () =>
        void act(async () => {
          const data = await call("todo_get_task", {
            projectId: project!.id,
            file: task.file,
          });
          const latest = data.task as TaskDetail;
          if (status === "blocked") {
            setBlockTask(latest);
            setDialog("blocked");
            return;
          }
          await acceptMutation(
            await call("todo_set_status", {
              projectId: project!.id,
              file: latest.file,
              etag: latest.etag,
              status,
            }),
            `status change for ${latest.id}`,
          );
        }),
    );
  }
  async function toggleStep(task: Task, item: ChecklistItem, checked: boolean) {
    if (!writable || task.archived || busyRef.current) return;
    guard(
      () =>
        void act(async () => {
          const data = await call("todo_get_task", {
            projectId: project!.id,
            file: task.file,
          });
          const latest = data.task as TaskDetail;
          const step = latest.checklist.find((step) => step.line === item.line);
          if (!step || step.text !== item.text || step.depth !== item.depth)
            throw Error(
              "The checklist changed on disk. Refresh from files before changing this step.",
            );
          await acceptMutation(
            await call("todo_toggle_checklist", {
              projectId: project!.id,
              file: latest.file,
              etag: latest.etag,
              line: step.line,
              checked,
            }),
            `checklist change for ${latest.id}`,
          );
        }),
    );
  }
  function workInChat(task: Task | undefined = detail) {
    if (!task || !project) return;
    guard(
      () =>
        void act(async () => {
          readSequence.current++;
          const data = await call("todo_get_task", {
            projectId: project.id,
            file: task.file,
          });
          const latest = data.task as TaskDetail;
          const chats = taskChats(latest.content);
          setDetail(latest);
          setDraft(latest.content);
          if (chats.length === 1) await openTaskChat(chats[0].url);
          else if (chats.length > 1) {
            setChatChoices(chats);
            setDialog("chats");
          } else {
            if (latest.archived)
              throw Error(
                "Archived tasks are read-only. Open an existing chat link instead.",
              );
            const key = `${project.id}:${latest.file}`;
            if (requestedChats.has(key)) return;
            await createTaskChat(taskWorkPrompt(project, latest));
            setRequestedChats((previous) => new Set([...previous, key]));
            setNotice(
              "New Codex chat requested. Refresh after it adds its link to the task file.",
            );
          }
        }),
    );
  }
  useEffect(() => {
    document.documentElement.dataset.accent =
      snapshot?.accentColor || "default";
  }, [snapshot?.accentColor]);
  useEffect(() => {
    let live = true;
    let initialSnapshotReloaded = false;
    const dispose = subscribe((data) => {
      if (!live) return;
      if (ACCENT_COLORS.some((color) => color === data.accentColor)) {
        const accentColor = data.accentColor as AccentColor;
        setSnapshot((previous) => previous && { ...previous, accentColor });
        return;
      }
      if (dirtyRef.current || busyRef.current) {
        setNotice(
          "Codex changed the task view. Save or discard your draft, then refresh.",
        );
        return;
      }
      if (data.snapshot) {
        const next = data.snapshot as Snapshot;
        snapshotSequence.current++;
        if (projectRef.current !== next.project?.id) {
          readSequence.current++;
          setDetail(undefined);
          setEditing(false);
          setFilter(null);
          setLabelFilters([]);
          setTaskProject("");
          setClosed(true);
        }
        setSnapshot(next);
        if (!initialSnapshotReloaded) {
          initialSnapshotReloaded = true;
          const sequence = ++snapshotSequence.current;
          void call("todo_open", {
            projectId: next.project?.id,
            includeArchive: focusState.current.archive,
          })
            .then((result) => {
              if (
                live &&
                sequence === snapshotSequence.current &&
                !dirtyRef.current &&
                !busyRef.current
              )
                setSnapshot(result.snapshot as Snapshot);
            })
            .catch(
              (e) =>
                live &&
                sequence === snapshotSequence.current &&
                setError(String(e)),
            );
        }
      } else if (
        (data.archivedFiles || data.restoredFiles) &&
        data.projectId === projectRef.current
      ) {
        const moved = (data.archivedFiles || data.restoredFiles) as string[];
        if (
          moved.some(
            (file) =>
              file.split("/").pop() === detailFileRef.current?.split("/").pop(),
          )
        ) {
          readSequence.current++;
          setDetail(undefined);
          setEditing(false);
        }
        void refresh();
      } else if (
        typeof data.removedFile === "string" &&
        data.projectId === projectRef.current
      ) {
        if (detailFileRef.current === data.removedFile) {
          readSequence.current++;
          setDetail(undefined);
          setEditing(false);
        }
        void refresh();
      } else if (data.task && (data.task as TaskDetail).file) {
        const sequence = ++readSequence.current;
        const task = data.task as TaskDetail;
        if (
          typeof data.projectId === "string" &&
          data.projectId !== projectRef.current
        ) {
          setDetail(undefined);
          setEditing(false);
          void call("todo_open", { projectId: data.projectId })
            .then((result) => {
              if (
                !live ||
                sequence !== readSequence.current ||
                dirtyRef.current ||
                busyRef.current
              )
                return;
              snapshotSequence.current++;
              setFilter(null);
              setLabelFilters([]);
              setTaskProject("");
              setClosed(true);
              setQuery("");
              setArchive(false);
              setSnapshot(result.snapshot as Snapshot);
              setDetail(task);
              setDraft(task.content);
            })
            .catch((e) => setError(String(e)));
          return;
        }
        setEditing(false);
        setDetail(task);
        setDraft(task.content);
      }
    });
    void initialize()
      .then(async () => {
        if (!live || hasInitialSnapshot()) return;
        const data = await call("todo_open", {});
        if (live) setSnapshot(data.snapshot as Snapshot);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
      dispose();
    };
  }, []);
  useEffect(() => {
    let live = true;
    let inFlight = false;
    let queued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = async () => {
      const current = focusState.current;
      const projectId = projectRef.current;
      if (!projectId || busyRef.current || current.dialog || current.menu)
        return;
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      const sequence = ++snapshotSequence.current;
      const readAtStart = readSequence.current;
      const selected = current.detail;
      const canApply = () =>
        live &&
        document.visibilityState === "visible" &&
        projectRef.current === projectId &&
        sequence === snapshotSequence.current &&
        !busyRef.current &&
        !focusState.current.dialog &&
        !focusState.current.menu;
      try {
        const data = await call("todo_open", {
          projectId,
          includeArchive: current.archive,
        });
        if (!canApply()) return;
        const next = data.snapshot as Snapshot;
        setSnapshot(next);
        if (
          !selected ||
          readAtStart !== readSequence.current ||
          detailFileRef.current !== selected.file
        )
          return;
        if (!next.tasks.some((task) => task.file === selected.file)) {
          if (dirtyRef.current) {
            setNotice(
              "This task could not be reloaded from disk. Your unsaved draft was kept.",
            );
          } else {
            readSequence.current++;
            setDetail(undefined);
            setEditing(false);
          }
          return;
        }
        const result = await call("todo_get_task", {
          projectId,
          file: selected.file,
        });
        if (
          !canApply() ||
          readAtStart !== readSequence.current ||
          detailFileRef.current !== selected.file
        )
          return;
        const latest = result.task as TaskDetail;
        if (dirtyRef.current) {
          if (latest.etag !== selected.etag)
            setNotice(
              "This file changed on disk. Your unsaved draft was kept. Save or discard it before refreshing the editor.",
            );
          return;
        }
        setDetail(latest);
        setDraft(latest.content);
      } catch (error) {
        if (canApply())
          setError(
            `Could not refresh from files: ${error instanceof Error ? error.message : String(error)}`,
          );
      } finally {
        inFlight = false;
        if (queued) {
          queued = false;
          if (live && document.visibilityState === "visible") schedule();
        }
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible")
        timer = setTimeout(() => void reload(), 100);
    };
    const blur = () => {
      clearTimeout(timer);
      queued = false;
    };
    window.addEventListener("focus", schedule);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    if (filter !== null && !snapshot.statuses.includes(filter)) setFilter(null);
    if (labelFilters.some((label) => !snapshot.labels.includes(label)))
      setLabelFilters((selected) =>
        selected.filter((label) => snapshot.labels.includes(label)),
      );
    if (
      taskProject &&
      !snapshot.tasks.some((task) => task.area === taskProject)
    )
      setTaskProject("");
  }, [snapshot, filter, labelFilters, taskProject]);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (!detail) {
      resizeStart.current = undefined;
      setResizing(false);
    }
  }, [detail?.file]);
  useEffect(() => {
    setMenu(undefined);
  }, [project?.id, view, dialog]);
  useEffect(() => {
    if (!revealFile) return;
    const frame = requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-task-file="${CSS.escape(revealFile)}"]`,
      );
      if (!element) return;
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
      (element.querySelector<HTMLButtonElement>(".task-main") || element).focus(
        { preventScroll: true },
      );
      setRevealFile(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [revealFile, snapshot, view, query, filter, labelFilters, closed]);
  useEffect(() => {
    void syncContext({
      projectId: project?.id,
      workspace: project?.name,
      taskProject: taskProject || undefined,
      view,
      query,
      filter,
      label: labelFilters.length === 1 ? labelFilters[0] : undefined,
      labels: labelFilters,
      selectedTask: detail?.id,
      file: detail?.file,
      draftUnsaved: dirty,
    });
  }, [
    project?.id,
    view,
    query,
    filter,
    labelFilters,
    taskProject,
    detail?.id,
    dirty,
  ]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        !!e.target.closest(
          "textarea, select, input:not([type='checkbox']):not([type='radio']), [contenteditable]:not([contenteditable='false'])",
        );
      const action = shortcutAction(e, typing);
      if (!action || dialog || (menu && action !== "undo")) return;
      e.preventDefault();
      e.stopPropagation();
      switch (action) {
        case "search":
          searchRef.current?.focus();
          break;
        case "undo":
          setMenu(undefined);
          undoLastAction();
          break;
        case "help":
          setDialog("help");
          break;
        case "newTask":
          if (writable) guard(() => setDialog("new"));
          break;
        case "edit":
          if (detail && writable && !detail.archived)
            guard(() => setEditing(true));
          break;
        case "work":
          workInChat();
          break;
        case "done":
          if (detail)
            void move(detail, detail.status === "done" ? "new" : "done");
          break;
        case "save":
          saveDraft();
          break;
        case "refresh":
          refreshFiles();
          break;
        case "tree":
          setView("tree");
          break;
        case "board":
          setView("board");
          break;
        case "next":
          navigateTask(1);
          break;
        case "previous":
          navigateTask(-1);
          break;
        case "archiveDone":
          prepareArchive();
          break;
        case "close":
          guard(() => {
            readSequence.current++;
            setDetail(undefined);
            setEditing(false);
          });
          break;
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    dialog,
    dirty,
    busy,
    menu,
    undoEntry,
    detail,
    archive,
    snapshot,
    filtered,
    draft,
    editing,
    writable,
  ]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement;
    const modal = document.querySelector<HTMLElement>("[role='dialog']")!;
    if (!modal.contains(document.activeElement))
      modal
        .querySelector<HTMLElement>(
          "button:not(:disabled), input:not(:disabled)",
        )
        ?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setDialog(null);
      }
      if (e.key !== "Tab") return;
      const controls = [
        ...modal.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
        ),
      ];
      const next = e.shiftKey ? controls.at(-1) : controls[0];
      if (
        (e.shiftKey && document.activeElement === controls[0]) ||
        (!e.shiftKey && document.activeElement === controls.at(-1))
      ) {
        e.preventDefault();
        next?.focus();
      }
    };
    modal.addEventListener("keydown", key);
    return () => {
      modal.removeEventListener("keydown", key);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [dialog]);

  const subtitle = filter === null ? "All tasks" : statusName(filter);
  const statusFilters: [string | null, string, IconName][] = [
    [null, "All tasks", "tree"],
    ...(snapshot?.statuses || []).map((status): [string, string, IconName] => [
      status,
      statusName(status),
      status === "doing"
        ? "clock"
        : status === "blocked"
          ? "link"
          : status === "done"
            ? "check"
            : "tree",
    ]),
  ];
  return (
    <div className={`workspace ${resizing ? "resizing" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Icon name="tasks" size={28} />
          </span>
          <div>Workhub</div>
        </div>
        <div className="project-switch">
          <div className="project-control">
            <span className="project-avatar">
              {project?.name.slice(0, 1) || "T"}
            </span>
            <select
              aria-label="Current workspace"
              value={project?.id || ""}
              disabled={busy}
              onChange={(e) => switchProject(e.target.value)}
            >
              {!snapshot?.projects.length && (
                <option value="">No workspaces</option>
              )}
              {snapshot?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <span className="project-path" title={project?.root}>
            {project?.root.replace(/^\/Users\/[^/]+/, "~") ||
              "Connect a local workspace"}
          </span>
        </div>
        <span className="eyebrow">TASKS</span>
        <nav aria-label="Task filters">
          {statusFilters.map(([status, label, icon]) => (
            <button
              key={status === null ? "all-tasks" : `status-${status}`}
              className={`nav-item ${filter === status ? "active" : ""}`}
              onClick={() => setFilter(status)}
            >
              <Icon name={icon as IconName} />
              <span>{label}</span>
              <span className="nav-count">
                {status === null
                  ? scopedTasks.filter(
                      (t) =>
                        !t.archived &&
                        (closed || !["done", "cancelled"].includes(t.status)),
                    ).length
                  : counts[status] || 0}
              </span>
            </button>
          ))}
        </nav>
        <span className="eyebrow">PROJECTS</span>
        <nav aria-label="Project filters">
          <button
            className={`nav-item ${!taskProject ? "active" : ""}`}
            aria-pressed={!taskProject}
            aria-label="All projects"
            title="All projects"
            disabled={busy}
            onClick={() => setTaskProject("")}
          >
            <Icon name="folder" />
            <span>All projects</span>
          </button>
          {taskProjects.map((name) => (
            <button
              key={name}
              aria-label={name}
              title={name}
              aria-pressed={taskProject === name}
              className={`nav-item ${taskProject === name ? "active" : ""}`}
              disabled={busy}
              onClick={() => setTaskProject(name)}
            >
              <Icon name="folder" />
              <span>{name}</span>
              <span className="nav-count">
                {
                  tasks.filter(
                    (task) =>
                      task.area === name &&
                      !task.archived &&
                      (closed || !["done", "cancelled"].includes(task.status)),
                  ).length
                }
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            onClick={() => guard(() => setDialog("connect"))}
            disabled={busy}
          >
            <Icon name="plus" />
            Connect workspace
          </button>
          {project && (
            <button
              className="subtle"
              onClick={() => guard(() => setDialog("disconnect"))}
              disabled={busy}
            >
              <Icon name="settings" />
              Workspace connection
            </button>
          )}
          <div className="local-indicator">
            <span />
            Local Markdown files
          </div>
        </div>
      </aside>
      <main className={`main ${detail ? "has-detail" : ""}`}>
        <header className="topbar">
          <nav className="breadcrumb" aria-label="Current task view">
            <span>{project?.name || "Workspace"}</span>
            <Icon name="arrow" size={12} />
            <strong>{subtitle}</strong>
            <Icon name="arrow" size={12} />
            <span>{taskProject || "All projects"}</span>
            <Icon name="arrow" size={12} />
            <span
              className="breadcrumb-count"
              title="Tasks matching the current filters"
              aria-label={`${filtered.length} visible tasks`}
            >
              {filtered.length}
            </span>
          </nav>
          <span className="topbar-actions">
            <button
              className="icon-button"
              aria-label="Undo last task action"
              title={
                undoEntry
                  ? tip(`Undo ${undoEntry.label}`, "undo")
                  : tip("No task action to undo", "undo")
              }
              disabled={!undoEntry || busy || !!dialog}
              onClick={undoLastAction}
            >
              <Icon name="undo" />
            </button>
            <button
              className="icon-button"
              title={tip("Refresh from files", "refresh")}
              aria-label="Refresh from files"
              disabled={busy}
              onClick={refreshFiles}
            >
              <Icon name="refresh" />
            </button>
            <button
              className="icon-button"
              aria-label="Settings"
              title="Settings"
              disabled={busy}
              onClick={() => setDialog("settings")}
            >
              <Icon name="settings" />
            </button>
            <button
              className="icon-button"
              aria-label="Help and shortcuts"
              title={tip("Help and shortcuts", "help")}
              disabled={busy}
              onClick={() => setDialog("help")}
            >
              <Icon name="help" />
              Help
            </button>
          </span>
        </header>
        <div className="toolbar">
          <div className="view-switch" aria-label="View">
            <button
              className={view === "tree" ? "active" : ""}
              title={tip("Tree list", "tree")}
              onClick={() => setView("tree")}
            >
              <Icon name="tree" size={16} />
              Tree
            </button>
            <button
              className={view === "board" ? "active" : ""}
              title={tip("Kanban board", "board")}
              onClick={() => setView("board")}
            >
              <Icon name="board" size={16} />
              Board
            </button>
          </div>
          <div className="search">
            <Icon name="search" size={16} />
            <input
              ref={searchRef}
              title={tip("Search tasks", "search")}
              placeholder="Search tasks…"
              aria-label="Search tasks"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>⌘ K</kbd>
          </div>
          <LabelFilter
            key={project?.id}
            labels={snapshot?.labels || []}
            selected={labelFilters}
            onChange={setLabelFilters}
          />
          <label className="filter-toggle">
            <input
              type="checkbox"
              checked={closed}
              onChange={(e) => setClosed(e.target.checked)}
            />
            Show completed
          </label>
          <label className="filter-toggle">
            <input
              type="checkbox"
              checked={archive}
              disabled={busy}
              onChange={(e) =>
                guard(() => {
                  setArchive(e.target.checked);
                  void act(() => refresh(project?.id, e.target.checked));
                })
              }
            />
            Show archive
          </label>
          <div className="page-actions">
            <button
              className="secondary"
              disabled={!writable || !doneTasks.length || busy}
              title={tip(
                "Review all done tasks in this workspace before archiving",
                "archiveDone",
              )}
              onClick={prepareArchive}
            >
              <Icon name="archive" size={17} /> Archive done
              {doneTasks.length ? ` (${doneTasks.length})` : ""}
            </button>
            <button
              className="primary"
              disabled={!writable || busy}
              title={
                !writable
                  ? "Upgrade this workspace to TOML to create tasks"
                  : tip("Create a task file", "newTask")
              }
              onClick={() => guard(() => setDialog("new"))}
            >
              <Icon name="plus" size={16} />
              New task
            </button>
          </div>
        </div>
        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
        {notice && (
          <div className="banner notice" role="status">
            <span>{notice}</span>
            <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
        {!!snapshot?.warnings.length && (
          <details className="warnings">
            <summary>
              {project?.format === "denti"
                ? "Legacy format · browse only"
                : `${snapshot.warnings.length} file warning${snapshot.warnings.length > 1 ? "s" : ""}`}
            </summary>
            {snapshot.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </details>
        )}
        <div className="content" aria-busy={busy}>
          {!snapshot ? (
            <div className="empty">
              <span className="loading-dot" />
              <h2>Opening your workspace</h2>
              <p>Reading local task files…</p>
            </div>
          ) : !project ? (
            <div className="empty onboarding">
              <Icon name="folder" size={36} />
              <h2>Your workspaces, one place</h2>
              <p>
                Connect your project folder containing Markdown tasks in{" "}
                <code>todo/</code>, or choose another task folder. Task files
                use Workhub’s TOML format.
              </p>
              <details className="onboarding-format">
                <summary>Task file format</summary>
                <p>
                  Each <code>.md</code> file starts with TOML metadata between{" "}
                  <code>+++</code> lines: <code>task_id</code>,{" "}
                  <code>status</code>, <code>worth</code>, <code>added</code>,{" "}
                  <code>summary</code>, and <code>labels</code>. The task
                  description and checklists follow as Markdown. Existing flat
                  YAML task folders can be connected for browsing.
                </p>
              </details>
              <button className="primary" onClick={() => setDialog("connect")}>
                Connect workspace
              </button>
              <div className="onboarding-init">
                <h3>No task folder yet?</h3>
                <p>
                  Ask Codex to create <code>todo/</code>, add three example
                  tasks based on your project, and connect it to Workhub.
                </p>
                <pre aria-label="Initialization prompt">
                  <code>$todo init /path/to/project</code>
                </pre>
                <p className="onboarding-hint">
                  Replace <code>/path/to/project</code> with your project folder
                  and send this prompt in a Codex chat. Examples are added only
                  when the task folder is empty.
                </p>
              </div>
            </div>
          ) : !filtered.length ? (
            <div className="empty">
              <Icon name="search" size={32} />
              <h2>{query ? "No matching tasks" : "Nothing in this view"}</h2>
              <p>
                {query
                  ? "Try another title, task ID, label, or blocker."
                  : "Change the filters or create a task to get started."}
              </p>
            </div>
          ) : view === "tree" ? (
            <div className="tree-view">
              <div className="list-columns">
                <span>Task</span>
                <span>Labels</span>
                <span>Progress</span>
              </div>
              {groups.map((group) => (
                <section className="task-group" key={group}>
                  <button
                    className="group-heading"
                    onClick={() =>
                      setCollapsed((old) => {
                        const next = new Set(old);
                        next.has(group) ? next.delete(group) : next.add(group);
                        return next;
                      })
                    }
                  >
                    <span
                      className={`chevron ${collapsed.has(group) ? "" : "open"}`}
                    >
                      <Icon name="arrow" size={12} />
                    </span>
                    <Icon name="folder" size={16} />
                    <strong>{group}</strong>
                    <span className="count-chip">
                      {filtered.filter((t) => t.area === group).length}
                    </span>
                  </button>
                  {!collapsed.has(group) &&
                    filtered
                      .filter((t) => t.area === group)
                      .map((task) => (
                        <div key={task.file} className="tree-task">
                          <div
                            className={`task-row ${detail?.file === task.file ? "selected" : ""}`}
                            data-task-file={task.file}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              openMenu(
                                task,
                                e.currentTarget,
                                e.clientX,
                                e.clientY,
                              );
                            }}
                            onKeyDown={(e) => menuKeys(e, task)}
                          >
                            <button
                              className={`expand-task ${expanded.has(task.file) ? "open" : ""}`}
                              aria-label={`Expand checklist for ${task.id}`}
                              disabled={!task.checklist.length}
                              onClick={() =>
                                setExpanded((old) => {
                                  const next = new Set(old);
                                  next.has(task.file)
                                    ? next.delete(task.file)
                                    : next.add(task.file);
                                  return next;
                                })
                              }
                            >
                              <Icon name="arrow" size={11} />
                            </button>
                            <input
                              className="task-complete"
                              type="checkbox"
                              checked={task.status === "done"}
                              disabled={!writable || task.archived || busy}
                              aria-label={
                                task.status === "done"
                                  ? `Reopen ${task.id}`
                                  : `Mark ${task.id} done`
                              }
                              title={`${statusName(task.status)} · ${task.status === "done" ? "Return to Backlog" : "Mark Done"}`}
                              onChange={(e) =>
                                void move(
                                  task,
                                  e.target.checked ? "done" : "new",
                                )
                              }
                            />
                            <button
                              className="task-main"
                              title="Select task · J / K moves between tasks · Shift+F10 opens actions"
                              onClick={() => guard(() => void selectTask(task))}
                            >
                              <span className="task-id">{task.id}</span>
                              <span className="task-title">
                                {task.title}
                                {task.archived && <small>Archived</small>}
                              </span>
                              {task.blocked && <Icon name="link" size={13} />}
                            </button>
                            <div className="row-labels">
                              {task.labels.slice(0, 2).map((l) => (
                                <span className="label" key={l}>
                                  {l}
                                </span>
                              ))}
                            </div>
                            <div className="row-progress">
                              <Progress task={task} />
                            </div>
                          </div>
                          {expanded.has(task.file) && (
                            <div className="checklist-tree">
                              {task.checklist.map((item) => (
                                <label
                                  key={item.line}
                                  className={item.checked ? "checked" : ""}
                                  style={{
                                    paddingLeft: `${58 + Math.min(item.depth, 4) * 14}px`,
                                  }}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    openMenu(
                                      task,
                                      e.currentTarget,
                                      e.clientX,
                                      e.clientY,
                                      item,
                                    );
                                  }}
                                  onKeyDown={(e) => menuKeys(e, task, item)}
                                >
                                  <span className="branch-line" />
                                  <input
                                    type="checkbox"
                                    checked={item.checked}
                                    disabled={
                                      !writable || task.archived || busy
                                    }
                                    aria-label={`${task.id}: ${item.text}`}
                                    onChange={(e) =>
                                      void toggleStep(
                                        task,
                                        item,
                                        e.target.checked,
                                      )
                                    }
                                  />
                                  <span>{item.text}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                </section>
              ))}
            </div>
          ) : (
            <div className="board">
              {snapshot.statuses
                .filter(
                  (s) =>
                    (filter === null || filter === s) &&
                    (closed ||
                      filter === s ||
                      s === "done" ||
                      !["done", "cancelled"].includes(s)),
                )
                .map((status) => (
                  <section
                    key={status}
                    className="board-column"
                    aria-label={statusName(status)}
                    onDragOver={(e) => {
                      if (writable && !busy) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      try {
                        const dragged = JSON.parse(
                          e.dataTransfer.getData("text/x-todo-task"),
                        );
                        if (dragged.projectId !== project.id) return;
                        const task = filtered.find(
                          (t) => t.file === dragged.file,
                        );
                        if (task) void move(task, status);
                      } catch {
                        /* Ignore unrelated drags. */
                      }
                    }}
                  >
                    <div className="column-heading">
                      <Dot status={status} />
                      <h2>{statusName(status)}</h2>
                      <span>
                        {filtered.filter((t) => t.status === status).length}
                      </span>
                    </div>
                    <div className="cards">
                      {filtered
                        .filter((t) => t.status === status)
                        .map((task) => (
                          <button
                            key={task.file}
                            className={`task-card ${detail?.file === task.file ? "selected" : ""}`}
                            title="Select task · J / K moves between tasks · Shift+F10 opens actions"
                            data-task-file={task.file}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              openMenu(
                                task,
                                e.currentTarget,
                                e.clientX,
                                e.clientY,
                              );
                            }}
                            onKeyDown={(e) => menuKeys(e, task)}
                            draggable={writable && !task.archived && !busy}
                            onDragStart={(e) =>
                              e.dataTransfer.setData(
                                "text/x-todo-task",
                                JSON.stringify({
                                  projectId: project.id,
                                  file: task.file,
                                }),
                              )
                            }
                            onClick={() => guard(() => void selectTask(task))}
                          >
                            <div className="card-top">
                              <span className="task-id">{task.id}</span>
                              <span className="card-area">{task.area}</span>
                            </div>
                            <h3
                              dangerouslySetInnerHTML={{
                                __html: taskTitle(task.title),
                              }}
                            />
                            {task.blocked && (
                              <div className="card-blocker">
                                <Icon name="link" size={12} />
                                <span>{task.blocked}</span>
                              </div>
                            )}
                            <div className="card-labels">
                              {task.labels.map((l) => (
                                <span className="label" key={l}>
                                  {l}
                                </span>
                              ))}
                            </div>
                            <div className="card-bottom">
                              <Progress task={task} />
                              {task.archived && <span>Archived</span>}
                            </div>
                          </button>
                        ))}
                      {!filtered.some((t) => t.status === status) && (
                        <div className="empty-column">No tasks</div>
                      )}
                    </div>
                  </section>
                ))}
            </div>
          )}
        </div>
        <footer className="workspace-footer">
          <span>
            {busy ? (
              "Working…"
            ) : snapshot ? (
              <time
                dateTime={snapshot.refreshedAt}
                title={`Last workspace read: ${new Date(snapshot.refreshedAt).toLocaleString()}. Updates after reading files; this is not a live clock.`}
              >
                Read at{" "}
                {new Date(snapshot.refreshedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </time>
            ) : (
              "Connecting…"
            )}
          </span>
        </footer>
      </main>
      {detail && (
        <aside
          className="detail-panel"
          aria-label="Task details"
          style={{ width: visiblePanelWidth }}
        >
          <div
            className="detail-resizer"
            role="separator"
            tabIndex={0}
            aria-label="Resize task details"
            aria-orientation="vertical"
            aria-valuemin={280}
            aria-valuemax={Math.round(maxPanelWidth)}
            aria-valuenow={Math.round(visiblePanelWidth)}
            title="Drag to resize. Arrow keys adjust width; double-click resets."
            onDoubleClick={() => resizePanel(460)}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              resizeStart.current = {
                x: e.clientX,
                width: visiblePanelWidth,
                pointer: e.pointerId,
              };
              setResizing(true);
            }}
            onPointerMove={(e) => {
              const start = resizeStart.current;
              if (start?.pointer === e.pointerId)
                resizePanel(start.width + start.x - e.clientX);
            }}
            onPointerUp={(e) => {
              if (resizeStart.current?.pointer !== e.pointerId) return;
              e.currentTarget.releasePointerCapture(e.pointerId);
              resizeStart.current = undefined;
              setResizing(false);
            }}
            onLostPointerCapture={() => {
              resizeStart.current = undefined;
              setResizing(false);
            }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 50 : 20;
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              e.stopPropagation();
              resizePanel(
                e.key === "Home"
                  ? 280
                  : e.key === "End"
                    ? maxPanelWidth
                    : visiblePanelWidth +
                      (e.key === "ArrowLeft" ? step : -step),
              );
            }}
          />
          <div className="detail-top">
            <span className="task-id">{detail.id}</span>
            <span className="detail-actions">
              <button
                className="icon-button"
                aria-label="Open task file"
                title="Open task file in Codex"
                onClick={() => void act(() => openFile(detail.absolutePath))}
              >
                <Icon name="file" size={17} />
              </button>
              <button
                className="icon-button"
                aria-label={chatLabel}
                title={
                  !linkedChats.length && !canCreateChat()
                    ? "Open this workspace in Codex to create a chat"
                    : tip(chatLabel, "work")
                }
                disabled={
                  busy ||
                  (!linkedChats.length &&
                    (detail.archived || chatRequested || !canCreateChat()))
                }
                onClick={() => workInChat()}
              >
                <Icon name="play" size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Close task details"
                title={tip("Close task details", "close")}
                onClick={() =>
                  guard(() => {
                    readSequence.current++;
                    setDetail(undefined);
                    setEditing(false);
                  })
                }
              >
                <Icon name="close" size={17} />
              </button>
            </span>
          </div>
          <div className="detail-content">
            <div className="detail-status">
              <Dot status={detail.status} />
              <span>{statusName(detail.status)}</span>
              {detail.archived && <span className="label">Archived</span>}
            </div>
            <h2 dangerouslySetInnerHTML={{ __html: taskTitle(detail.title) }} />
            <div className="detail-properties">
              <span>Status</span>
              <select
                aria-label="Task status"
                title={tip("Toggle Done for the selected task", "done")}
                value={detail.status}
                disabled={!writable || detail.archived || busy}
                onChange={(e) => void move(detail, e.target.value)}
              >
                {snapshot?.statuses.map((s) => (
                  <option key={s} value={s}>
                    {statusName(s)}
                  </option>
                ))}
              </select>
              <span>Project</span>
              <strong>{detail.area}</strong>
              {detail.added && (
                <>
                  <span>Added</span>
                  <span>{detail.added}</span>
                </>
              )}
              <span>Labels</span>
              <div className="card-labels">
                {detail.labels.length
                  ? detail.labels.map((l) => (
                      <span className="label" key={l}>
                        {l}
                      </span>
                    ))
                  : "—"}
              </div>
              {detail.blocked && (
                <>
                  <span>Blocker</span>
                  <div
                    className="blocker-text reference-text"
                    onClick={followReference}
                  >
                    {referencedTask(
                      detail.blocked,
                      tasks,
                      detail.file,
                      project?.root,
                    ) ? (
                      <button
                        className="task-reference"
                        onClick={() =>
                          jumpToTask(
                            referencedTask(
                              detail.blocked,
                              tasks,
                              detail.file,
                              project?.root,
                            )!,
                          )
                        }
                      >
                        {detail.blocked}
                      </button>
                    ) : (
                      <div
                        dangerouslySetInnerHTML={{
                          __html: markdown(
                            detail.blocked,
                            tasks,
                            detail.file,
                            project?.root,
                          ),
                        }}
                      />
                    )}
                  </div>
                </>
              )}
              {detail.next && (
                <>
                  <span>Next step</span>
                  <div
                    className="reference-text"
                    onClick={followReference}
                    dangerouslySetInnerHTML={{
                      __html: markdown(
                        detail.next,
                        tasks,
                        detail.file,
                        project?.root,
                      ),
                    }}
                  />
                </>
              )}
            </div>
            <div className="detail-tabs">
              <button
                className={!editing ? "active" : ""}
                onClick={() => guard(() => setEditing(false))}
              >
                Overview
              </button>
              <button
                className={editing ? "active" : ""}
                title={tip("Edit task content", "edit")}
                disabled={!writable || detail.archived}
                onClick={() => setEditing(true)}
              >
                <Icon name="edit" size={13} />
                Edit file{dirty && <span className="unsaved-dot" />}
              </button>
            </div>
            {editing ? (
              <>
                <label className="editor-label" htmlFor="task-editor">
                  Markdown with TOML frontmatter
                </label>
                <textarea
                  id="task-editor"
                  spellCheck={false}
                  value={draft}
                  disabled={busy}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="editor-footer">
                  <span>{dirty ? "Unsaved changes" : "All changes saved"}</span>
                  <button
                    className="primary"
                    disabled={!dirty || busy}
                    title={tip("Save file", "save")}
                    onClick={saveDraft}
                  >
                    Save file
                  </button>
                </div>
              </>
            ) : (
              <>
                <article
                  className="markdown"
                  onClick={followReference}
                  dangerouslySetInnerHTML={{
                    __html: markdown(
                      detail.body,
                      tasks,
                      detail.file,
                      project?.root,
                    ),
                  }}
                />
                {!!detail.checklist.length && (
                  <div className="detail-checklist">
                    <h3>
                      Checklist <Progress task={detail} />
                    </h3>
                    {detail.checklist.map((item) => (
                      <label
                        className={item.checked ? "checked" : ""}
                        key={item.line}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          openMenu(
                            detail,
                            e.currentTarget,
                            e.clientX,
                            e.clientY,
                            item,
                          );
                        }}
                        onKeyDown={(e) => menuKeys(e, detail, item)}
                      >
                        <input
                          type="checkbox"
                          checked={item.checked}
                          disabled={!writable || detail.archived || busy}
                          onChange={(e) =>
                            void toggleStep(detail, item, e.target.checked)
                          }
                        />
                        <span>{item.text}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="file-location">
              <Icon name="file" size={13} />
              <code>{detail.file}</code>
            </div>
          </div>
        </aside>
      )}
      {menu && menu.projectId === project?.id && (
        <TaskMenu
          task={menu.task}
          step={menu.step}
          x={menu.x}
          y={menu.y}
          statuses={snapshot?.statuses || []}
          writable={writable && !menu.task.archived}
          busy={busy}
          onClose={() => setMenu(undefined)}
          onWork={() => {
            setMenu(undefined);
            workInChat(menu.task);
          }}
          onEdit={() => {
            setMenu(undefined);
            guard(() => void selectTask(menu.task, true));
          }}
          onStatus={(status) => {
            setMenu(undefined);
            void move(menu.task, status);
          }}
          onToggle={() => {
            setMenu(undefined);
            if (menu.step)
              void toggleStep(menu.task, menu.step, !menu.step.checked);
          }}
        />
      )}
      {dialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setDialog(null);
          }}
        >
          <section
            className={`modal ${dialog === "help" ? "help-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <button
              className="modal-close icon-button"
              disabled={busy}
              aria-label="Close dialog"
              onClick={() => setDialog(null)}
            >
              <Icon name="close" size={18} />
            </button>
            {dialog === "settings" ? (
              <div>
                <h2 id="dialog-title">Settings</h2>
                <fieldset className="accent-picker">
                  <legend>Accent color</legend>
                  <div className="accent-options">
                    {ACCENT_COLORS.map((color) => (
                      <label
                        key={color}
                        className={`accent-option ${(snapshot?.accentColor || "default") === color ? "selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="accent-color"
                          value={color}
                          checked={
                            (snapshot?.accentColor || "default") === color
                          }
                          disabled={busy}
                          onChange={() =>
                            void act(async () => {
                              const data = await call("todo_set_accent_color", {
                                color,
                              });
                              setSnapshot(
                                (previous) =>
                                  previous && {
                                    ...previous,
                                    accentColor:
                                      data.accentColor as AccentColor,
                                  },
                              );
                            })
                          }
                        />
                        <span className="accent-swatch" data-color={color}>
                          {(snapshot?.accentColor || "default") === color && (
                            <Icon name="check" size={16} />
                          )}
                        </span>
                        <span>
                          {color === "default"
                            ? "Default (purple)"
                            : color[0].toUpperCase() + color.slice(1)}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <p className="help-note">
                  Saved automatically for all workspaces.
                </p>
              </div>
            ) : dialog === "help" ? (
              <div>
                <h2 id="dialog-title">Your work, in files</h2>
                <p>
                  Pick a workspace at the top left. Browse statuses and projects
                  in the sidebar, search by title or task ID, and switch between
                  Tree and Board. Select several labels in the dropdown to show
                  tasks matching any of them; All labels clears that filter.
                  Settings in the top header changes the accent color.
                </p>
                <p>
                  Click a task for details; right-click for actions. Use the
                  play button to work in Codex, checkboxes to complete tasks and
                  steps, or drag board cards to change status. Task references
                  jump within this view. Drag the details panel's left edge to
                  resize it.
                </p>
                <p>
                  Done is shown by default. Archive done previews completed
                  files before moving them to the task folder's{" "}
                  <code>archive/</code>. Show archive reveals those read-only
                  records. Cmd-Z reverses recent file actions.
                </p>
                <h3>Keyboard shortcuts</h3>
                <div className="shortcut-list">
                  {Object.entries(shortcuts).map(([id, shortcut]) => (
                    <div key={id}>
                      <span>{shortcut.description}</span>
                      <kbd>{shortcut.keys}</kbd>
                    </div>
                  ))}
                </div>
                <p className="help-note">
                  Single-letter shortcuts work outside text fields. Text editors
                  keep their typing undo. File undo lasts for this session and
                  preserves newer external edits. Returning to Workhub
                  refreshes files automatically and keeps unsaved drafts.
                  Refresh also reloads edits made elsewhere. Legacy YAML
                  projects support browsing until upgraded.
                </p>
              </div>
            ) : dialog === "archiveDone" ? (
              <div>
                <h2 id="dialog-title">
                  Archive {archiveCandidates.length} done task
                  {archiveCandidates.length === 1 ? "" : "s"}?
                </h2>
                <p>
                  These are all current done tasks in{" "}
                  <strong>{project?.name}</strong>, including those outside the
                  current filters. Filenames and content are preserved. Existing
                  Markdown links to the current task folder may need updating
                  after the move. Cmd-Z can restore the files during this
                  session.
                </p>
                <ul className="archive-preview">
                  {archiveCandidates.map((task) => (
                    <li key={task.file}>
                      <strong>{task.id}</strong> {task.title}
                      <small>
                        {task.file} → {projectArchiveFolder(project!)}/
                        {task.file.split("/").pop()}
                      </small>
                    </li>
                  ))}
                </ul>
                <div className="modal-buttons">
                  <button disabled={busy} onClick={() => setDialog(null)}>
                    Keep done tasks
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const data = await call("todo_archive_done", {
                          projectId: project!.id,
                          tasks: archiveCandidates.map((task) => ({
                            file: task.file,
                            etag: task.etag,
                          })),
                        });
                        rememberUndo(
                          data,
                          `archiving ${archiveCandidates.length} done tasks`,
                        );
                        if (
                          archiveCandidates.some(
                            (task) => task.file === detail?.file,
                          )
                        ) {
                          readSequence.current++;
                          setDetail(undefined);
                          setEditing(false);
                        }
                        const warnings = data.warnings as string[];
                        setNotice(
                          `Archived ${archiveCandidates.length} done tasks.${warnings?.length ? ` ${warnings.join(" ")}` : ""}`,
                        );
                        setDialog(null);
                        await refresh();
                      })
                    }
                  >
                    Archive reviewed tasks
                  </button>
                </div>
              </div>
            ) : dialog === "chats" ? (
              <div>
                <h2 id="dialog-title">Choose a Codex chat</h2>
                <p>This task links to several chats.</p>
                <div className="chat-choices">
                  {chatChoices.map((chat) => (
                    <button
                      key={chat.id}
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await openTaskChat(chat.url);
                          setDialog(null);
                        })
                      }
                    >
                      <Icon name="chat" />
                      <span>
                        {chat.label}
                        <small>{chat.id}</small>
                      </span>
                      <Icon name="arrow" size={14} />
                    </button>
                  ))}
                </div>
              </div>
            ) : dialog === "connect" ? (
              <ConnectForm
                busy={busy}
                onChooseDirectory={async () => {
                  let selected:
                    { path: string; suggestedRoot: string } | undefined;
                  await act(async () => {
                    const data = await call("todo_choose_directory", {});
                    if (data.path) selected = data as typeof selected;
                  });
                  return selected;
                }}
                onSubmit={async (values) => {
                  let creation: TodoCreation | undefined;
                  await act(async () => {
                    const data = await call("todo_connect_project", values);
                    if (data.needsTodoCreation) {
                      creation = data.needsTodoCreation as TodoCreation;
                      return;
                    }
                    readSequence.current++;
                    setSnapshot(data.snapshot as Snapshot);
                    setDetail(undefined);
                    setFilter(null);
                    setLabelFilters([]);
                    setTaskProject("");
                    setClosed(true);
                    setArchive(false);
                    setQuery("");
                    setDialog(null);
                  });
                  return creation;
                }}
              />
            ) : dialog === "new" ? (
              <NewTaskForm
                busy={busy}
                knownLabels={snapshot?.labels || []}
                projects={taskProjects}
                initialProject={
                  taskProject || detail?.area || taskProjects[0] || "infra"
                }
                onSubmit={(values) =>
                  void act(async () => {
                    const data = await call("todo_create_task", {
                      projectId: project!.id,
                      ...values,
                    });
                    rememberUndo(
                      data,
                      `creation of ${(data.task as TaskDetail).id}`,
                    );
                    await refresh();
                    setDetail(data.task as TaskDetail);
                    setDraft((data.task as TaskDetail).content);
                    setEditing(true);
                    setDialog(null);
                    const warnings = data.warnings as string[];
                    if (warnings?.length) setNotice(warnings.join(" "));
                  })
                }
              />
            ) : dialog === "blocked" ? (
              <BlockForm
                busy={busy}
                initial={blockTask?.blocked || ""}
                onSubmit={(blockedBy) =>
                  void act(async () => {
                    await acceptMutation(
                      await call("todo_set_status", {
                        projectId: project!.id,
                        file: blockTask!.file,
                        etag: blockTask!.etag,
                        status: "blocked",
                        blockedBy,
                      }),
                      `status change for ${blockTask!.id}`,
                    );
                    setDialog(null);
                  })
                }
              />
            ) : dialog === "discard" ? (
              <>
                <h2 id="dialog-title">Keep your draft?</h2>
                <p>
                  This task has unsaved changes. Discard them to continue, or
                  return to the editor.
                </p>
                <div className="modal-buttons">
                  <button onClick={() => setDialog(null)}>Keep editing</button>
                  <button
                    className="primary"
                    onClick={() => {
                      dirtyRef.current = false;
                      setDraft(detail?.content || "");
                      setEditing(false);
                      setDialog(null);
                      const action = pending.current;
                      pending.current = undefined;
                      action?.();
                    }}
                  >
                    Discard draft
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 id="dialog-title">Workspace connection</h2>
                <p>
                  <strong>{project?.name}</strong>
                </p>
                <code className="connection-path">{project?.root}</code>
                <p>
                  {writable
                    ? "Shared TOML format · editing enabled"
                    : "Legacy YAML format · browse only"}
                </p>
                <div className="modal-buttons">
                  <button onClick={() => setDialog(null)}>
                    Keep connected
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const data = await call("todo_disconnect_project", {
                          projectId: project!.id,
                        });
                        readSequence.current++;
                        setSnapshot(data.snapshot as Snapshot);
                        setDetail(undefined);
                        setFilter(null);
                        setLabelFilters([]);
                        setTaskProject("");
                        setClosed(true);
                        setArchive(false);
                        setDialog(null);
                      })
                    }
                  >
                    Disconnect workspace
                  </button>
                </div>
                <small>Task files stay in the workspace.</small>
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function TaskMenu({
  task,
  step,
  x,
  y,
  statuses,
  writable,
  busy,
  onClose,
  onWork,
  onEdit,
  onStatus,
  onToggle,
}: {
  task: Task;
  step?: ChecklistItem;
  x: number;
  y: number;
  statuses: string[];
  writable: boolean;
  busy: boolean;
  onClose: () => void;
  onWork: () => void;
  onEdit: () => void;
  onStatus: (status: string) => void;
  onToggle: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement);
  const [statusMode, setStatusMode] = useState(false);
  const [position, setPosition] = useState({ x, y });
  useEffect(() => {
    const element = root.current!;
    setPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - element.offsetWidth - 8)),
      y: Math.max(
        8,
        Math.min(y, window.innerHeight - element.offsetHeight - 8),
      ),
    });
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y, statusMode]);
  useEffect(() => {
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        onClose();
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  return (
    <div
      ref={root}
      role="menu"
      aria-label={`Actions for ${task.id}${step ? `: ${step.text}` : ""}`}
      className="task-menu"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "ArrowLeft" && !statusMode)) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          if (previousFocus.current instanceof HTMLElement)
            previousFocus.current.focus();
        } else if (e.key === "ArrowLeft" && statusMode) {
          e.preventDefault();
          setStatusMode(false);
        } else if (e.key === "Tab") onClose();
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          const buttons = [
            ...root.current!.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ];
          const current = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const index =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : (current +
                    (e.key === "ArrowDown" ? 1 : -1) +
                    buttons.length) %
                  buttons.length;
          buttons[index]?.focus();
        }
      }}
    >
      <div className="menu-caption">
        {task.id}
        {step && " · Checklist step"}
      </div>
      {statusMode ? (
        <>
          <button role="menuitem" onClick={() => setStatusMode(false)}>
            <Icon name="arrow" size={14} />
            <span>Task status</span>
          </button>
          <div className="menu-separator" />
          {statuses.map((status) => (
            <button
              key={status}
              role="menuitemradio"
              aria-label={statusName(status)}
              aria-checked={task.status === status}
              disabled={!writable || busy}
              onClick={() => onStatus(status)}
            >
              <Dot status={status} />
              <span>{statusName(status)}</span>
              {task.status === status && <Icon name="check" size={14} />}
            </button>
          ))}
        </>
      ) : (
        <>
          <button
            role="menuitem"
            disabled={busy}
            onClick={onWork}
            title={tip("Start working", "work")}
          >
            <Icon name="play" size={16} />
            <span>Start working</span>
          </button>
          <button
            role="menuitem"
            disabled={!writable || busy}
            onClick={onEdit}
            title={tip("Edit the selected task", "edit")}
          >
            <Icon name="edit" size={16} />
            <span>Edit content</span>
          </button>
          <button
            role="menuitem"
            aria-haspopup="menu"
            disabled={busy}
            onClick={() => setStatusMode(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                setStatusMode(true);
              }
            }}
          >
            <Dot status={task.status} />
            <span>Change status</span>
            <small>{statusName(task.status)}</small>
            <Icon name="arrow" size={12} />
          </button>
          {step && (
            <>
              <div className="menu-separator" />
              <button
                role="menuitemcheckbox"
                aria-checked={step.checked}
                disabled={!writable || busy}
                onClick={onToggle}
              >
                <Icon name="check" size={16} />
                <span>{step.checked ? "Reopen step" : "Complete step"}</span>
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
function ConnectForm({
  busy,
  onSubmit,
  onChooseDirectory,
}: {
  busy: boolean;
  onSubmit: (
    values: Record<string, unknown>,
  ) => Promise<TodoCreation | undefined>;
  onChooseDirectory: () => Promise<
    { path: string; suggestedRoot: string } | undefined
  >;
}) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [taskDirectory, setTaskDirectory] = useState("");
  const [creation, setCreation] = useState<TodoCreation>();
  if (creation)
    return (
      <div className="todo-create-confirmation">
        <span className="modal-symbol">
          <Icon name="folder" size={24} />
        </span>
        <h2 id="dialog-title">Create a task folder?</h2>
        <p>
          The selected task folder doesn't exist. Create an empty folder and
          connect <strong>{name}</strong>?
        </p>
        <code className="todo-create-path">{creation.taskDirectory}</code>
        <p className="format-note">
          To add a few project-specific example tasks afterward, ask Codex to
          run <code>$todo init</code> in this workspace.
        </p>
        <div className="modal-buttons">
          <button
            autoFocus
            disabled={busy}
            onClick={() => setCreation(undefined)}
          >
            Back
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void onSubmit({
                path: creation.root,
                taskDirectory: creation.taskDirectory,
                name,
                createTodo: true,
              })
            }
          >
            Create and connect
          </button>
        </div>
      </div>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          path,
          name,
          ...(taskDirectory ? { taskDirectory } : {}),
        }).then((needed) => {
          if (needed) setCreation(needed);
        });
      }}
    >
      <span className="modal-symbol">
        <Icon name="folder" size={24} />
      </span>
      <h2 id="dialog-title">Connect a workspace</h2>
      <p>
        Choose your workspace and the folder containing its task Markdown files.
      </p>
      <label>
        Workspace name
        <input
          autoFocus
          required
          disabled={busy}
          value={name}
          placeholder="My workspace"
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Local workspace path
        <input
          required
          disabled={busy}
          value={path}
          placeholder="~/projects/my-project"
          onChange={(e) => setPath(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="browse-folder"
        disabled={busy}
        onClick={() =>
          void onChooseDirectory().then((selected) => {
            if (selected) setPath(selected.path);
          })
        }
      >
        <Icon name="folder" size={16} /> Browse workspace
      </button>
      <label>
        Task folder
        <input
          disabled={busy}
          value={taskDirectory}
          placeholder="todo (default)"
          onChange={(e) => setTaskDirectory(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="browse-folder"
        disabled={busy}
        onClick={() =>
          void onChooseDirectory().then((selected) => {
            if (!selected) return;
            setTaskDirectory(selected.path);
            if (!path) setPath(selected.suggestedRoot);
          })
        }
      >
        <Icon name="folder" size={16} /> Browse task folder
      </button>
      <div className="format-note">
        Use <code>todo/</code> or another folder inside your workspace. Existing
        <code> todo/tasks/</code> layouts still work. TOML tasks are editable;
        legacy YAML opens in browse mode. A missing folder asks for approval to
        create it. <code>archive/</code> is created when you first archive a
        task.
      </div>
      <button className="primary full-width" disabled={busy}>
        Connect workspace
      </button>
    </form>
  );
}
function NewTaskForm({
  busy,
  knownLabels,
  projects,
  initialProject,
  onSubmit,
}: {
  busy: boolean;
  knownLabels: string[];
  projects: string[];
  initialProject: string;
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState("");
  const [area, setArea] = useState(initialProject);
  const [labels, setLabels] = useState(knownLabels[0] || "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          title,
          area,
          labels: labels.split(",").map((label) => label.trim()),
        });
      }}
    >
      <h2 id="dialog-title">New task</h2>
      <p>Create a Markdown file in the workspace's backlog.</p>
      <label>
        Title
        <input
          autoFocus
          required
          value={title}
          maxLength={300}
          placeholder="What needs to happen?"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        Project
        <input
          required
          value={area}
          list="task-projects"
          pattern="[a-z][a-z0-9-]*"
          onChange={(e) => setArea(e.target.value)}
        />
        <datalist id="task-projects">
          {projects.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      <label>
        Labels
        <input
          required
          list="project-labels"
          aria-label="Labels"
          aria-describedby="new-task-labels-hint"
          value={labels}
          placeholder="qa, regression"
          onChange={(e) => setLabels(e.target.value)}
        />
        <datalist id="project-labels">
          {knownLabels.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
      </label>
      <small id="new-task-labels-hint">
        Use 1–3 labels, separated by commas. Type a new label or choose an
        existing one.
      </small>
      <button className="primary full-width" disabled={busy}>
        Create task
      </button>
    </form>
  );
}
function BlockForm({
  busy,
  initial,
  onSubmit,
}: {
  busy: boolean;
  initial: string;
  onSubmit: (value: string) => void;
}) {
  const [blocker, setBlocker] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(blocker);
      }}
    >
      <h2 id="dialog-title">What blocks this task?</h2>
      <p>Name an active task ID, a decision, or an external dependency.</p>
      <label>
        Blocked by
        <input
          autoFocus
          required
          value={blocker}
          placeholder="infra-162 or waiting for approval"
          onChange={(e) => setBlocker(e.target.value)}
        />
      </label>
      <button className="primary full-width" disabled={busy}>
        Move to Blocked
      </button>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(<Workspace />);
