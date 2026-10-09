import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import {
  readFile,
  writeFile,
  mkdtemp,
  mkdir,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoStore, replaceField } from "../src/store.js";
import { execute } from "../src/operations.js";

const temporary = await realpath(await mkdtemp(join(tmpdir(), "todo-ui-")));
const screenshots =
  process.env.WORKHUB_SCREENSHOTS || join(temporary, "screenshots");
await mkdir(screenshots, { recursive: true });
const roots = [join(temporary, "alpha"), join(temporary, "beta")];
const doc = (id: string, title: string, status = "new") =>
  `+++\ntask_id = "${id}"\nstatus = "${status}"\nworth = "yes"\nadded = "2026-10-09"\nsummary = "${title}"\nlabels = "automation"\n${status === "blocked" ? 'blocked_by = "Owner decision"\n' : ""}+++\n\n# ${title}\n\n- [ ] First step\n`;
for (const root of roots)
  await mkdir(join(root, "todo/tasks"), { recursive: true });
await writeFile(
  join(roots[0], "todo/tasks/a.md"),
  doc("infra-1", "Build reliable runners").replace(
    "- [ ] First step",
    "- [ ] First step\n  - [ ] Nested step",
  ),
);
await writeFile(
  join(roots[0], "todo/tasks/b.md"),
  doc("infra-2", "Wait for owner decision", "blocked"),
);
await writeFile(
  join(roots[1], "todo/tasks/a.md"),
  doc("api-1", "Verify API response"),
);
const store = new TodoStore(
  join(temporary, "projects.json"),
  roots.map((root, i) => ({
    id: i ? "beta" : "alpha",
    name: i ? "Beta" : "Alpha",
    root,
    format: "clos" as const,
  })),
);
const appHtml = await readFile(
  new URL("../dist/app/index.html", import.meta.url),
  "utf8",
);
const initial = {
  content: [],
  structuredContent: { snapshot: await store.snapshot("alpha") },
};
initial.structuredContent.snapshot.refreshedAt = "2000-01-01T00:00:00.000Z";
initial.structuredContent.snapshot.tasks[0].title = "Outdated cached title";
const host = await build({
  stdin: {
    contents: `
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
window.startTodoHost = async (html, initial) => {
  const frame = document.getElementById("app");
  const fontVariables = { "--font-sans": "Arial, sans-serif", "--font-mono": "Courier New, monospace", "--font-text-md-size": "16px", "--font-text-sm-size": "14px", "--font-text-xs-size": "12px" };
  const hostContext = { theme: "light", displayMode: "fullscreen", availableDisplayModes: ["fullscreen", "inline"], styles: { variables: fontVariables, css: { fonts: '@font-face { font-family: "Workhub Host Test"; src: local("Arial"); }' } } };
  const bridge = new AppBridge(null, { name: "todo-test-host", version: "1" }, { serverTools: {}, updateModelContext: {}, openLinks: {}, experimental: { "openai/message": {} } }, { hostContext });
  window.todoHostFonts = variables => bridge.setHostContext({ ...hostContext, styles: { variables: { ...fontVariables, ...variables } } });
  window.todoHostTheme = theme => bridge.setHostContext({ ...hostContext, theme });
  window.todoMessages = [];
  window.todoOpenedLinks = [];
  bridge.onmessage = async (params, extra) => { window.todoMessages.push({ ...params, _meta: extra._meta }); return { isError: !!window.failTodoMessage }; };
  bridge.onopenlink = async params => { window.todoOpenedLinks.push(params.url); return { isError: !!window.failTodoOpen }; };
  bridge.oncalltool = params => window.runTodoTool(params.name, params.arguments || {});
  bridge.onupdatemodelcontext = async params => { window.todoContext = params.structuredContent; return {}; };
  bridge.oninitialized = async () => { await bridge.sendToolInput({ arguments: {} }); await bridge.sendToolResult(initial); };
  window.sendTodoResult = result => bridge.sendToolResult(result);
  await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
  frame.srcdoc = html;
};`,
    resolveDir: process.cwd(),
    loader: "js",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
});
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {},
);
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let pauseTaskRead: (() => Promise<void>) | undefined;
  await page.exposeFunction(
    "runTodoTool",
    async (name: string, args: Record<string, unknown>) => {
      try {
        const data = await execute(store, name, args);
        if (name === "todo_get_task" && pauseTaskRead) {
          const pause = pauseTaskRead;
          pauseTaskRead = undefined;
          await pause();
        }
        return { content: [], structuredContent: data };
      } catch (e) {
        return {
          isError: true,
          content: [
            { type: "text", text: e instanceof Error ? e.message : String(e) },
          ],
        };
      }
    },
  );
  await page.setContent(
    '<button id="outside-app" style="position:fixed;left:-1000px">Outside Workhub</button><iframe id="app" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>',
  );
  await page.addScriptTag({ content: host.outputFiles[0].text });
  await page.evaluate(
    ({ html, data }) =>
      (
        window as unknown as {
          startTodoHost: (html: string, data: unknown) => Promise<void>;
        }
      ).startTodoHost(html, data),
    { html: appHtml, data: initial },
  );
  const ui = page.frameLocator("#app");
  const readTime = ui.locator(".workspace-footer time");
  await expect(readTime).not.toHaveAttribute(
    "datetime",
    initial.structuredContent.snapshot.refreshedAt,
  );
  await expect(ui.locator(".task-row").first()).toContainText(
    "Build reliable runners",
  );
  await expect(ui.locator(".breadcrumb")).toHaveText(
    "AlphaAll tasksAll projects2",
  );
  await expect(ui.locator(".page-heading")).toHaveCount(0);
  await expect(ui.locator(".workspace-footer")).not.toContainText(
    "Files are the source of truth",
  );
  await expect(readTime).toContainText(/Read at \d{2}:\d{2}:\d{2}/);
  await expect(readTime).toHaveAttribute("title", /not a live clock/);
  await expect(ui.locator(".brand")).toBeHidden();
  await expect(ui.locator("#__mcp-host-fonts")).toHaveCount(1);
  expect(await ui.locator("#__mcp-host-fonts").textContent()).toContain(
    "Workhub Host Test",
  );
  await expect(
    ui.getByRole("checkbox", { name: "Show completed", exact: true }),
  ).toBeChecked();
  await expect(
    ui.getByRole("button", { name: "Connect workspace", exact: true }),
  ).toBeVisible();
  const settings = ui.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  await expect(
    ui.getByRole("radio", { name: "Default (purple)" }),
  ).toBeChecked();
  await ui.getByRole("radio", { name: "Default (purple)" }).focus();
  await ui.getByRole("radio", { name: "Default (purple)" }).press("ArrowRight");
  await expect(
    ui.getByRole("radio", { name: "Blue", exact: true }),
  ).toBeChecked();
  await expect
    .poll(async () => (await store.snapshot()).accentColor)
    .toBe("blue");
  await ui.getByRole("dialog").getByText("Green", { exact: true }).click();
  await expect(
    ui.getByRole("radio", { name: "Green", exact: true }),
  ).toBeChecked();
  await expect
    .poll(
      async () => (await new TodoStore(store.config).snapshot()).accentColor,
    )
    .toBe("green");
  await expect
    .poll(() =>
      ui
        .locator("html")
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--accent").trim(),
        ),
    )
    .toBe("#17804b");
  await page.evaluate(() =>
    (
      window as unknown as { todoHostTheme: (theme: string) => void }
    ).todoHostTheme("dark"),
  );
  await expect
    .poll(() =>
      ui
        .locator("html")
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--accent").trim(),
        ),
    )
    .toBe("#71d6a0");
  await page.screenshot({
    path: join(screenshots, "settings-dark-preview.png"),
  });
  await page.evaluate(() =>
    (
      window as unknown as { todoHostTheme: (theme: string) => void }
    ).todoHostTheme("light"),
  );
  await page.screenshot({ path: join(screenshots, "settings-preview.png") });
  await ui.getByRole("button", { name: "Close dialog" }).click();
  await ui
    .getByRole("combobox", { name: "Current workspace" })
    .selectOption("beta");
  await expect(ui.locator("html")).toHaveAttribute("data-accent", "green");
  await expect(ui.locator(".breadcrumb")).toHaveText(
    "BetaAll tasksAll projects1",
  );
  await ui
    .getByRole("combobox", { name: "Current workspace" })
    .selectOption("alpha");
  await settings.click();
  await expect(
    ui.getByRole("radio", { name: "Green", exact: true }),
  ).toBeChecked();
  await ui
    .getByRole("dialog")
    .getByText("Default (purple)", { exact: true })
    .click();
  await expect(
    ui.getByRole("radio", { name: "Default (purple)" }),
  ).toBeChecked();
  await expect
    .poll(async () => (await store.snapshot()).accentColor)
    .toBe("default");
  await ui.getByRole("button", { name: "Close dialog" }).click();
  await expect
    .poll(() =>
      ui.locator("body").evaluate((el) => getComputedStyle(el).fontFamily),
    )
    .toContain("Arial");
  await page.evaluate(() =>
    (
      window as unknown as { todoHostFonts: (variables: unknown) => void }
    ).todoHostFonts({
      "--font-sans": "Georgia, serif",
      "--font-text-md-size": "18px",
    }),
  );
  await expect
    .poll(() =>
      ui.locator("body").evaluate((el) => getComputedStyle(el).fontFamily),
    )
    .toContain("Georgia");
  await expect
    .poll(() =>
      ui.locator("body").evaluate((el) => getComputedStyle(el).fontSize),
    )
    .toBe("18px");
  await page.evaluate(() =>
    (
      window as unknown as { todoHostFonts: (variables: unknown) => void }
    ).todoHostFonts({}),
  );
  await expect
    .poll(() =>
      ui.locator("body").evaluate((el) => getComputedStyle(el).fontSize),
    )
    .toBe("16px");
  await expect(ui.locator(".task-row")).toHaveCount(2);
  await expect(
    ui.getByRole("button", { name: "Undo last task action" }),
  ).toBeDisabled();
  const firstRow = ui
    .locator(".task-row")
    .filter({ hasText: "Build reliable runners" });
  await expect(
    ui.getByRole("navigation", { name: "Label filters" }),
  ).toHaveCount(0);
  const help = ui.getByRole("button", { name: "Help and shortcuts" });
  await expect(help).toHaveAttribute("title", /\?/);
  await help.press("?");
  await expect(ui.getByRole("dialog")).toContainText("Keyboard shortcuts");
  await expect(ui.getByRole("dialog")).toContainText("Shift+A");
  await page.screenshot({ path: join(screenshots, "help-preview.png") });
  await ui.getByRole("button", { name: "Close dialog" }).press("Tab");
  await expect(ui.getByRole("button", { name: "Close dialog" })).toBeFocused();
  await ui.getByRole("button", { name: "Close dialog" }).press("Escape");
  expect(
    await firstRow
      .locator(".task-main")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(14);
  await firstRow.locator(".task-main").press("b");
  await expect(ui.locator('.board-column[aria-label="Done"]')).toBeVisible();
  await ui.locator(".task-card").first().press("t");
  await firstRow.locator(".task-main").press("j");
  await expect(ui.locator(".detail-top")).toContainText("infra-1");
  await firstRow.locator(".task-main").press("k");
  await expect(ui.locator(".detail-top")).toContainText("infra-2");
  await expect(ui.locator(".task-row.selected .task-main")).toBeFocused();
  await ui.locator(".task-row.selected").screenshot({
    path: join(screenshots, "workhub-keyboard-selection-preview.png"),
  });
  await firstRow.locator(".task-main").press("Escape");
  await help.press("n");
  await ui.getByRole("textbox", { name: "Title", exact: true }).fill("nrb");
  await expect(
    ui.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("nrb");
  await ui.getByRole("textbox", { name: "Title", exact: true }).press("Escape");
  await firstRow.locator(".task-main").press("ControlOrMeta+k");
  await expect(ui.getByRole("textbox", { name: "Search tasks" })).toBeFocused();
  await ui.getByRole("textbox", { name: "Search tasks" }).fill("r");
  await expect(ui.getByRole("textbox", { name: "Search tasks" })).toHaveValue(
    "r",
  );
  await ui.getByRole("textbox", { name: "Search tasks" }).fill("");
  await firstRow.locator(".task-main").click();
  await expect(ui.locator(".detail-top")).toContainText("infra-1");
  await firstRow.locator(".task-main").press("e");
  await expect(
    ui.getByRole("textbox", { name: "Markdown with TOML frontmatter" }),
  ).toBeVisible();
  const divider = ui.getByRole("separator", { name: "Resize task details" });
  const initialWidth = await divider.getAttribute("aria-valuenow");
  const handle = (await divider.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 80);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 120, handle.y + 80);
  await page.mouse.up();
  await expect(divider).toHaveAttribute(
    "aria-valuenow",
    String(Number(initialWidth) + 120),
  );
  await divider.press("ArrowRight");
  await expect(divider).toHaveAttribute(
    "aria-valuenow",
    String(Number(initialWidth) + 100),
  );
  await divider.press("Home");
  await expect(divider).toHaveAttribute("aria-valuenow", "280");
  await divider.press("End");
  expect(await divider.getAttribute("aria-valuenow")).toBe(
    await divider.getAttribute("aria-valuemax"),
  );
  await divider.dblclick();
  await expect(divider).toHaveAttribute("aria-valuenow", "460");
  await ui.getByRole("button", { name: "Close task details" }).click();
  await firstRow.click({ button: "right" });
  await expect(ui.getByRole("menu").getByRole("menuitem").first()).toHaveText(
    "Start working",
  );
  await ui.getByRole("menuitem", { name: /Change status/ }).click();
  await expect(
    ui.getByRole("menuitemradio", { name: "Backlog", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await ui
    .getByRole("menuitemradio", { name: "In progress", exact: true })
    .click();
  await expect
    .poll(async () => (await store.read("alpha", "todo/tasks/a.md")).status)
    .toBe("doing");
  await ui
    .getByRole("button", { name: "Undo last task action" })
    .press("ControlOrMeta+z");
  await expect
    .poll(async () => (await store.read("alpha", "todo/tasks/a.md")).status)
    .toBe("new");
  await firstRow.locator(".task-main").click();
  await ui
    .getByRole("checkbox", { name: "Mark infra-1 done", exact: true })
    .click();
  await expect(ui.locator(".task-row")).toHaveCount(2);
  await expect
    .poll(async () => (await store.read("alpha", "todo/tasks/a.md")).status)
    .toBe("done");
  await ui
    .getByRole("checkbox", { name: "Show completed", exact: true })
    .check();
  await expect(
    ui.getByRole("checkbox", { name: "Reopen infra-1", exact: true }),
  ).toBeChecked();
  await expect(
    ui.getByRole("button", { name: "Undo last task action" }),
  ).toBeEnabled();
  await firstRow.locator(".task-main").press("d");
  await expect(
    ui.getByRole("checkbox", { name: "Mark infra-1 done", exact: true }),
  ).not.toBeChecked();
  await expect
    .poll(async () => (await store.read("alpha", "todo/tasks/a.md")).status)
    .toBe("new");
  await ui
    .getByRole("checkbox", { name: "Show completed", exact: true })
    .uncheck();
  await ui
    .getByRole("button", { name: "Expand checklist for infra-1" })
    .click();
  await expect(ui.locator(".checklist-tree")).toContainText("First step");
  const nested = ui.getByRole("checkbox", {
    name: "infra-1: Nested step",
    exact: true,
  });
  await nested.click();
  await expect(nested).toBeChecked();
  await nested.click({ button: "right" });
  await ui.getByRole("menuitemcheckbox", { name: "Reopen step" }).click();
  await expect(nested).not.toBeChecked();
  await nested.focus();
  await nested.press("Shift+F10");
  await ui.getByRole("menuitemcheckbox", { name: "Complete step" }).click();
  await expect(nested).toBeChecked();
  await nested.press("ControlOrMeta+z");
  await expect(nested).not.toBeChecked();
  await nested.click();
  await expect(nested).toBeChecked();
  const firstStep = ui.getByRole("checkbox", {
    name: "infra-1: First step",
    exact: true,
  });
  await firstStep.click();
  await expect(firstStep).toBeChecked();
  const completedSteps = await store.read("alpha", "todo/tasks/a.md");
  expect(completedSteps.checklist.every((item) => item.checked)).toBe(true);
  expect(completedSteps.status).toBe("new");
  await firstStep.click();
  await expect(firstStep).not.toBeChecked();
  await writeFile(
    join(roots[0], "todo/tasks/a.md"),
    (await store.read("alpha", "todo/tasks/a.md")).content.replace(
      "- [ ] First step",
      "\n- [ ] First step",
    ),
  );
  await firstStep.click();
  await expect(ui.getByRole("alert")).toContainText(
    "checklist changed on disk",
  );
  expect(
    (await store.read("alpha", "todo/tasks/a.md")).checklist[0].checked,
  ).toBe(false);
  await ui.getByRole("button", { name: "Refresh from files" }).click();
  await ui.getByRole("textbox", { name: "Search tasks" }).fill("no matches");
  await expect(
    ui.getByRole("heading", { name: "No matching tasks" }),
  ).toBeVisible();
  await ui.getByRole("textbox", { name: "Search tasks" }).fill("");
  await ui
    .getByRole("combobox", { name: "Current workspace" })
    .selectOption("beta");
  await expect(ui.locator(".task-row")).toHaveCount(1);
  await expect(ui.locator(".task-row")).toContainText("Verify API response");
  await ui
    .getByRole("combobox", { name: "Current workspace" })
    .selectOption("alpha");
  await ui
    .getByRole("button", { name: /infra-1 Build reliable runners/ })
    .click();
  await page.evaluate(() => {
    (window as unknown as { failTodoMessage: boolean }).failTodoMessage = true;
  });
  await ui
    .locator(".task-row")
    .filter({ hasText: "Build reliable runners" })
    .click({ button: "right" });
  await ui
    .getByRole("menuitem", { name: "Start working", exact: true })
    .click();
  await expect(ui.getByRole("alert")).toContainText("declined to create");
  await expect(
    ui.getByRole("button", { name: "Start working", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    (window as unknown as { failTodoMessage: boolean }).failTodoMessage = false;
  });
  await ui
    .getByRole("button", { name: "Start working", exact: true })
    .press("w");
  await expect(
    ui.getByRole("button", { name: "Work chat requested", exact: true }),
  ).toBeDisabled();
  const messages = await page.evaluate(
    () =>
      (
        window as unknown as {
          todoMessages: {
            content: { text: string }[];
            _meta: Record<string, unknown>;
          }[];
        }
      ).todoMessages,
  );
  expect(messages).toHaveLength(2);
  expect(messages[1]._meta["openai/message"]).toEqual({
    target: "new",
    send: true,
  });
  expect(messages[1].content[0].text).toContain(roots[0]);
  expect(messages[1].content[0].text).toContain("todo/tasks/a.md");
  expect(messages[1].content[0].text).toContain("CODEX_THREAD_ID");
  const chatId = "00000000-0000-4000-8000-000000000001";
  const laterChatId = "00000000-0000-4000-8000-000000000002";
  await writeFile(
    join(roots[0], "todo/tasks/a.md"),
    (await store.read("alpha", "todo/tasks/a.md")).content +
      `\n## Agent Sessions\n\n- [Work chat](codex://threads/${chatId})\n`,
  );
  await ui.getByRole("button", { name: "Refresh from files" }).click();
  await expect(
    ui.getByRole("button", { name: "Open Codex chat", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    (window as unknown as { failTodoOpen: boolean }).failTodoOpen = true;
  });
  await ui
    .getByRole("button", { name: "Open Codex chat", exact: true })
    .click();
  await expect(ui.getByRole("alert")).toContainText("declined to open");
  await page.evaluate(() => {
    (window as unknown as { failTodoOpen: boolean }).failTodoOpen = false;
  });
  await ui
    .getByRole("button", { name: "Open Codex chat", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      (window as unknown as { todoOpenedLinks: string[] }).todoOpenedLinks.at(
        -1,
      ),
    ),
  ).toBe(`codex://threads/${chatId}`);
  await expect(
    ui.getByRole("button", { name: "Refresh from files" }),
  ).toBeEnabled();
  await writeFile(
    join(roots[0], "todo/tasks/a.md"),
    (await store.read("alpha", "todo/tasks/a.md")).content +
      `\n- [Later work chat](codex://threads/${laterChatId})\n`,
  );
  await expect(ui.getByRole("dialog")).toHaveCount(0);
  await ui.getByRole("button", { name: "Refresh from files" }).click();
  await ui
    .getByRole("button", { name: "Choose Codex chat", exact: true })
    .click();
  await ui
    .getByRole("dialog")
    .getByRole("button", { name: /Later work chat/ })
    .click();
  await expect(ui.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as unknown as { todoOpenedLinks: string[] }).todoOpenedLinks.at(
        -1,
      ),
    ),
  ).toBe(`codex://threads/${laterChatId}`);
  await ui
    .getByRole("button", { name: "Expand checklist for infra-1" })
    .click();
  await page.screenshot({
    path: join(screenshots, "list-controls-preview.png"),
  });
  await firstRow.click({ button: "right" });
  await page.screenshot({
    path: join(screenshots, "context-menu-preview.png"),
  });
  await ui.getByRole("menuitem", { name: "Edit content", exact: true }).click();
  const editor = ui.getByRole("textbox", {
    name: "Markdown with TOML frontmatter",
  });
  await editor.fill(
    (await editor.inputValue()).replace("First step", "Updated step"),
  );
  await expect(
    ui.getByRole("button", { name: "Save file", exact: true }),
  ).toHaveAttribute("title", /Enter/);
  await editor.press("ControlOrMeta+Enter");
  await expect(
    ui.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  expect(await readFile(join(roots[0], "todo/tasks/a.md"), "utf8")).toContain(
    "Updated step",
  );
  // Text editing retains native undo instead of reverting a saved task action.
  await editor.press("End");
  await editor.press("Enter");
  await editor.pressSequentially("Typing draft");
  await editor.press("ControlOrMeta+z");
  expect(await editor.inputValue()).not.toContain("Typing draft");
  expect(await readFile(join(roots[0], "todo/tasks/a.md"), "utf8")).toContain(
    "Updated step",
  );
  await editor.fill((await store.read("alpha", "todo/tasks/a.md")).content);
  await ui.getByRole("button", { name: "Undo last task action" }).click();
  await expect(editor).toHaveValue(/First step/);
  expect((await store.read("alpha", "todo/tasks/a.md")).content).not.toContain(
    "Updated step",
  );
  await editor.fill(
    (await editor.inputValue()).replace("First step", "Updated step"),
  );
  await ui.getByRole("button", { name: "Save file", exact: true }).click();
  await ui.getByRole("button", { name: "Overview", exact: true }).click();
  await ui.locator(".detail-checklist").getByRole("checkbox").first().click();
  await expect(
    ui.locator(".detail-checklist").getByRole("checkbox").first(),
  ).toBeChecked();
  expect(
    (await store.read("alpha", "todo/tasks/a.md")).checklist[0].checked,
  ).toBe(true);
  await ui.getByRole("button", { name: "Edit file", exact: true }).click();
  await editor.fill((await editor.inputValue()) + "\nUnsaved draft\n");
  await ui
    .getByRole("combobox", { name: "Current workspace" })
    .selectOption("beta");
  await expect(ui.getByRole("dialog")).toContainText("Keep your draft?");
  await ui.getByRole("button", { name: "Keep editing" }).click();
  await expect(editor).toHaveValue(/Unsaved draft/);
  const external =
    (await readFile(join(roots[0], "todo/tasks/a.md"), "utf8")) +
    "\nExternal edit\n";
  await writeFile(join(roots[0], "todo/tasks/a.md"), external);
  await ui.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(ui.getByRole("alert")).toContainText("changed on disk");
  await expect(editor).toHaveValue(/Unsaved draft/);
  expect(await readFile(join(roots[0], "todo/tasks/a.md"), "utf8")).toBe(
    external,
  );
  await ui.getByRole("button", { name: "Close task details" }).click();
  await ui.getByRole("button", { name: "Discard draft" }).click();
  await ui.getByRole("button", { name: "Undo last task action" }).click();
  await expect(ui.getByRole("alert")).toContainText("Cannot undo");
  expect(await readFile(join(roots[0], "todo/tasks/a.md"), "utf8")).toBe(
    external,
  );
  // A blocker task ID opens the target and reveals it through active filters, without changing views.
  await writeFile(
    join(roots[0], "todo/tasks/b.md"),
    doc("infra-2", "Wait for owner decision", "blocked").replace(
      "Owner decision",
      "infra-1",
    ) + "\n[Runner task](./a.md)\n\nDepends on `infra-1`.\n",
  );
  await ui.getByRole("button", { name: "Refresh from files" }).click();
  await ui.getByRole("button", { name: /^Blocked/ }).click();
  await ui
    .getByRole("button", { name: /infra-2 Wait for owner decision/ })
    .click();
  await ui
    .locator(".blocker-text")
    .getByRole("button", { name: "infra-1", exact: true })
    .click();
  await expect(ui.locator(".detail-top")).toContainText("infra-1");
  await expect(
    ui.getByRole("button", { name: "Tree", exact: true }),
  ).toHaveClass("active");
  await expect(ui.locator(".task-row.selected")).toContainText("infra-1");
  await ui
    .getByRole("button", { name: /infra-2 Wait for owner decision/ })
    .click();
  await ui
    .locator(".markdown")
    .getByRole("link", { name: "Runner task", exact: true })
    .click();
  await expect(ui.locator(".detail-top")).toContainText("infra-1");
  await ui.getByRole("button", { name: "Close task details" }).click();
  // A Markdown edit outside the app becomes a workflow column and label options on refresh.
  let custom = replaceField(
    doc("infra-2", "Wait for owner decision"),
    "status",
    "ready for testing",
  );
  custom = replaceField(custom, "labels", "qa,regression");
  custom += "\n[Runner task](./a.md)\n\nDepends on `infra-1`.\n";
  await writeFile(join(roots[0], "todo/tasks/b.md"), custom);
  await ui.getByRole("button", { name: "Refresh from files" }).press("r");
  await expect(
    ui
      .getByRole("navigation", { name: "Task filters" })
      .getByRole("button", { name: /^ready for testing/ }),
  ).toBeVisible();
  await ui
    .getByRole("navigation", { name: "Task filters" })
    .getByRole("button", { name: /^ready for testing/ })
    .click();
  await expect(ui.locator(".task-row")).toHaveCount(1);
  await expect(ui.locator(".task-row")).toContainText("infra-2");
  await ui.getByRole("button", { name: /^All tasks/ }).click();
  const labels = ui.getByRole("button", {
    name: "Filter by labels",
    exact: true,
  });
  const labelOptions = ui.getByRole("group", {
    name: "Label options",
    exact: true,
  });
  const allLabels = labelOptions.getByRole("checkbox", {
    name: "All labels",
    exact: true,
  });
  const regressionLabel = labelOptions.getByRole("checkbox", {
    name: "regression",
    exact: true,
  });
  await labels.click();
  await regressionLabel.check();
  await regressionLabel.press("Escape");
  await expect(labels).toHaveText("regression");
  await expect(ui.locator(".task-row")).toHaveCount(1);
  await labels.click();
  await expect(regressionLabel).toBeChecked();
  await expect(allLabels).not.toBeChecked();
  await labelOptions.getByRole("checkbox", { name: "qa", exact: true }).check();
  await expect(labels).toHaveText("2 labels");
  await expect(ui.locator(".task-row")).toHaveCount(1);
  await labelOptions
    .getByRole("checkbox", { name: "automation", exact: true })
    .check();
  await expect(labels).toHaveText("3 labels");
  await expect(ui.locator(".task-row")).toHaveCount(2);
  await expect(
    labelOptions.getByRole("checkbox", { name: "automation", exact: true }),
  ).toBeChecked();
  await page.screenshot({
    path: join(screenshots, "workhub-labels-preview.png"),
  });
  await regressionLabel.press("b");
  await expect(
    ui.getByRole("button", { name: "Tree", exact: true }),
  ).toHaveClass("active");
  await regressionLabel.press("Escape");
  await expect(labelOptions).toHaveCount(0);
  await expect(labels).toBeFocused();
  await ui.getByRole("button", { name: "Board", exact: true }).click();
  await expect(ui.locator(".task-card")).toHaveCount(2);
  await labels.click();
  await labelOptions
    .getByRole("checkbox", { name: "automation", exact: true })
    .uncheck();
  await expect(ui.locator(".task-card")).toHaveCount(1);
  await expect(ui.locator(".task-card")).toContainText("infra-2");
  // Clicking outside dismisses the popup without clearing the filter.
  await ui.getByRole("button", { name: "Tree", exact: true }).click();
  await expect(labelOptions).toHaveCount(0);
  await expect(labels).toHaveText("2 labels");
  await labels.click();
  await allLabels.check();
  await allLabels.press("Escape");
  await expect(labels).toHaveText("All labels");
  await labels.press("ArrowDown");
  await expect(allLabels).toBeChecked();
  await expect(allLabels).toBeFocused();
  await allLabels.press("End");
  await expect(regressionLabel).toBeFocused();
  await regressionLabel.press("Space");
  await expect(regressionLabel).toBeChecked();
  await expect(ui.locator(".task-row")).toHaveCount(1);
  await regressionLabel.press("Home");
  await allLabels.press("Space");
  await expect(labels).toHaveText("All labels");
  await expect(ui.locator(".task-row")).toHaveCount(2);
  await regressionLabel.check();
  await regressionLabel.press("Escape");
  await ui
    .getByRole("combobox", { name: "Current workspace" })
    .selectOption("beta");
  await expect(labels).toHaveText("All labels");
  await labels.click();
  await expect(labelOptions.getByRole("checkbox")).toHaveCount(2);
  await expect(allLabels).toBeChecked();
  await allLabels.press("Escape");
  await expect(
    ui.getByRole("button", { name: "Undo last task action" }),
  ).toBeDisabled();
  await expect(
    ui
      .getByRole("navigation", { name: "Task filters" })
      .getByRole("button", { name: /^ready for testing/ }),
  ).toHaveCount(0);
  await ui
    .getByRole("combobox", { name: "Current workspace" })
    .selectOption("alpha");
  await ui.getByRole("button", { name: "Board", exact: true }).click();
  await expect(ui.locator(".task-card")).toHaveCount(2);
  await expect(
    ui.locator('.board-column[aria-label="ready for testing"] .task-card'),
  ).toHaveCount(1);
  await ui
    .locator(".task-card")
    .filter({ hasText: "Wait for owner decision" })
    .click();
  await ui
    .getByRole("textbox", { name: "Search tasks" })
    .fill("owner decision");
  await ui
    .locator(".markdown")
    .getByRole("link", { name: "infra-1", exact: true })
    .click();
  await expect(ui.locator(".detail-top")).toContainText("infra-1");
  await expect(
    ui.getByRole("button", { name: "Board", exact: true }),
  ).toHaveClass("active");
  await expect(ui.locator(".task-card.selected")).toContainText("infra-1");
  const appFrame = page.frames().find((f) => f.parentFrame())!;
  const transfer = await appFrame.evaluateHandle(() => new DataTransfer());
  await ui
    .locator(".task-card")
    .filter({ hasText: "Build reliable runners" })
    .dispatchEvent("dragstart", { dataTransfer: transfer });
  await ui
    .locator('.board-column[aria-label="In progress"]')
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    ui.locator('.board-column[aria-label="In progress"] .task-card'),
  ).toHaveCount(1);
  await ui
    .getByRole("button", { name: "Undo last task action" })
    .press("ControlOrMeta+z");
  await expect(
    ui.locator('.board-column[aria-label="Backlog"] .task-card'),
  ).toHaveCount(1);
  await ui
    .locator(".task-card")
    .filter({ hasText: "Build reliable runners" })
    .click({ button: "right" });
  await ui.getByRole("menuitem", { name: /Change status/ }).click();
  await ui
    .getByRole("menuitemradio", { name: "In progress", exact: true })
    .click();
  await expect(
    ui.locator('.board-column[aria-label="In progress"] .task-card'),
  ).toHaveCount(1);
  expect((await store.read("alpha", "todo/tasks/a.md")).status).toBe("doing");
  await ui
    .locator(".task-card")
    .filter({ hasText: "Build reliable runners" })
    .dispatchEvent("dragstart", { dataTransfer: transfer });
  await ui
    .locator('.board-column[aria-label="ready for testing"]')
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    ui.locator('.board-column[aria-label="ready for testing"] .task-card'),
  ).toHaveCount(2);
  expect((await store.read("alpha", "todo/tasks/a.md")).status).toBe(
    "ready for testing",
  );
  await ui
    .locator(".task-card")
    .filter({ hasText: "Build reliable runners" })
    .click();
  await expect(ui.getByRole("combobox", { name: "Task status" })).toHaveValue(
    "ready for testing",
  );
  await ui.getByRole("button", { name: "Edit file", exact: true }).click();
  await editor.fill(
    replaceField(await editor.inputValue(), "status", "awaiting acceptance"),
  );
  await ui.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(
    ui.locator('.board-column[aria-label="awaiting acceptance"] .task-card'),
  ).toHaveCount(1);
  await expect(ui.getByRole("combobox", { name: "Task status" })).toHaveValue(
    "awaiting acceptance",
  );
  await ui.getByRole("button", { name: "Close task details" }).click();
  await ui.getByRole("button", { name: "New task", exact: true }).click();
  await ui
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("A task from the interface");
  await expect(ui.locator("#project-labels option[value='qa']")).toHaveCount(1);
  await ui.getByLabel("Labels", { exact: true }).fill("qa,release candidate");
  await ui.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(ui.locator(".detail-panel")).toContainText("infra-1000");
  await labels.click();
  await expect(
    labelOptions.getByRole("checkbox", {
      name: "release candidate",
      exact: true,
    }),
  ).toHaveCount(1);
  await labelOptions
    .getByRole("checkbox", { name: "release candidate", exact: true })
    .press("Escape");
  expect(
    (await store.snapshot("alpha")).tasks.find(
      (task) => task.id === "infra-1000",
    )?.labels,
  ).toEqual(["qa", "release candidate"]);
  const createdFile = (await store.snapshot("alpha")).tasks.find(
    (task) => task.id === "infra-1000",
  )!.file;
  await ui.getByRole("button", { name: "Undo last task action" }).click();
  await expect(ui.locator(".detail-panel")).toHaveCount(0);
  expect(
    (await store.snapshot("alpha")).tasks.some(
      (task) => task.id === "infra-1000",
    ),
  ).toBe(false);
  await expect
    .poll(async () => {
      try {
        await readFile(join(roots[0], createdFile));
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
  await ui.getByRole("button", { name: "New task", exact: true }).click();
  await ui
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("A task from the interface");
  await ui.getByLabel("Labels", { exact: true }).fill("qa,release candidate");
  await ui.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(ui.locator(".detail-panel")).toContainText("infra-1000");
  await ui.getByRole("button", { name: "Close task details" }).click();
  await ui.locator(".task-card").filter({ hasText: "infra-1000" }).click();
  await ui.getByRole("combobox", { name: "Task status" }).selectOption("done");
  await expect
    .poll(async () => (await store.read("alpha", createdFile)).status)
    .toBe("done");
  await expect(
    ui.getByRole("button", { name: "Undo last task action" }),
  ).toBeEnabled();
  await ui
    .getByRole("button", { name: "Undo last task action" })
    .press("Shift+A");
  await expect(ui.getByRole("dialog")).toContainText("Archive 1 done task?");
  await expect(ui.getByRole("dialog")).toContainText(createdFile);
  const archiveFile = `todo/archive/${createdFile.split("/").pop()}`;
  const archiveContent =
    (await store.read("alpha", createdFile)).content +
    "\nExternal archive preview edit\n";
  await writeFile(join(roots[0], createdFile), archiveContent);
  await ui.getByRole("button", { name: "Archive reviewed tasks" }).click();
  await expect(ui.getByRole("dialog").getByRole("alert")).toContainText(
    "stale",
  );
  expect(await readFile(join(roots[0], createdFile), "utf8")).toBe(
    archiveContent,
  );
  await ui.getByRole("button", { name: "Keep done tasks" }).click();
  await ui.getByRole("button", { name: /^Archive done/ }).click();
  await expect(ui.getByRole("dialog")).toContainText("Archive 1 done task?");
  await page.screenshot({ path: join(screenshots, "archive-preview.png") });
  await ui.getByRole("button", { name: "Archive reviewed tasks" }).click();
  await expect(ui.getByRole("dialog")).toHaveCount(0);
  expect(await readFile(join(roots[0], archiveFile), "utf8")).toBe(
    archiveContent,
  );
  await expect(
    ui.locator(".task-card").filter({ hasText: "infra-1000" }),
  ).toHaveCount(0);
  await ui.getByRole("checkbox", { name: "Show archive", exact: true }).check();
  await ui.locator(".task-card").filter({ hasText: "infra-1000" }).click();
  await expect(
    ui.getByRole("combobox", { name: "Task status" }),
  ).toBeDisabled();
  await expect(
    ui.getByRole("button", { name: "Edit file", exact: true }),
  ).toBeDisabled();
  await expect(ui.locator(".detail-panel")).toContainText("release candidate");
  await ui
    .getByRole("button", { name: "Undo last task action" })
    .press("ControlOrMeta+z");
  await expect(ui.getByRole("combobox", { name: "Task status" })).toBeEnabled();
  expect(await readFile(join(roots[0], createdFile), "utf8")).toBe(
    archiveContent,
  );
  await ui.getByRole("combobox", { name: "Task status" }).selectOption("new");
  await expect
    .poll(async () => (await store.read("alpha", createdFile)).status)
    .toBe("new");
  await ui
    .getByRole("checkbox", { name: "Show archive", exact: true })
    .uncheck();
  await ui.getByRole("button", { name: "Close task details" }).click();
  await ui.getByRole("button", { name: /^Done/ }).click();
  await expect(ui.locator(".content")).toContainText("Nothing in this view");
  await ui.getByRole("button", { name: /^All tasks/ }).click();
  const gamma = join(temporary, "gamma");
  await mkdir(join(gamma, "todo/tasks"), { recursive: true });
  await ui
    .getByRole("button", { name: "Connect workspace", exact: true })
    .click();
  await ui.getByRole("textbox", { name: "Workspace name" }).fill("Gamma");
  await ui.getByRole("textbox", { name: "Local workspace path" }).fill(gamma);
  await ui
    .getByRole("dialog")
    .getByRole("button", { name: "Connect workspace", exact: true })
    .click();
  await expect(ui.locator(".breadcrumb")).toContainText("Gamma");
  await expect(
    ui.getByRole("combobox", { name: "Current workspace" }),
  ).toHaveValue((await store.projects()).find((p) => p.name === "Gamma")!.id);
  await ui
    .getByRole("combobox", { name: "Current workspace" })
    .selectOption("alpha");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { todoContext?: { projectId?: string } })
            .todoContext?.projectId,
      ),
    )
    .toBe("alpha");
  const modelTask = await execute(store, "todo_get_task", {
    projectId: "beta",
    file: "todo/tasks/a.md",
  });
  await page.evaluate(
    (data) =>
      (
        window as unknown as {
          sendTodoResult: (data: unknown) => Promise<void>;
        }
      ).sendTodoResult({ content: [], structuredContent: data }),
    modelTask,
  );
  await expect(
    ui.getByRole("combobox", { name: "Current workspace" }),
  ).toHaveValue("beta");
  await expect(ui.locator(".detail-panel")).toContainText("api-1");
  // A card dragged from another project cannot alter this project's same-named file.
  await ui
    .locator('.board-column[aria-label="In progress"]')
    .dispatchEvent("drop", { dataTransfer: transfer });
  expect((await store.read("beta", "todo/tasks/a.md")).status).toBe("new");
  await ui
    .getByRole("combobox", { name: "Current workspace" })
    .selectOption("alpha");
  await expect(
    ui.getByRole("combobox", { name: "Current workspace" }),
  ).toHaveValue("alpha");
  await expect(
    ui.getByRole("button", { name: "Refresh from files" }),
  ).toBeEnabled();
  const longPath =
    "code/example-api/cmd/adminapi/a-very-long-module-name-that-must-wrap-within-a-board-card";
  await writeFile(
    join(roots[0], "todo/tasks/api.md"),
    doc(
      "api-8",
      `Understand how \`${longPath}\` works end-to-end and add a reproducible test harness`,
    ) + "\n[Runner task](./a.md)\n",
  );
  await writeFile(
    join(roots[0], "todo/tasks/admin.md"),
    doc("admin-4", "Completed administration step", "done").replace(
      "- [ ] First step\n",
      "",
    ),
  );
  await ui.getByRole("button", { name: "Refresh from files" }).click();
  const projectFilters = ui.getByRole("navigation", {
    name: "Project filters",
  });
  await expect(projectFilters.getByRole("button")).toHaveCount(4);
  await expect(ui.locator(".project-switch .eyebrow")).toHaveCount(0);
  const tasksBox = (await ui
    .getByRole("navigation", { name: "Task filters" })
    .boundingBox())!;
  const projectsBox = (await projectFilters.boundingBox())!;
  expect(projectsBox.y).toBeGreaterThanOrEqual(tasksBox.y + tasksBox.height);
  await expect(
    ui.getByRole("checkbox", { name: "Show completed", exact: true }),
  ).toBeChecked();
  await projectFilters
    .getByRole("button", { name: "api", exact: true })
    .click();
  await expect(ui.locator(".task-card")).toHaveCount(1);
  const apiCard = ui.locator(".task-card").filter({ hasText: "api-8" });
  await expect(ui.locator(".breadcrumb")).toHaveText("AlphaAll tasksapi1");
  await expect(apiCard.locator("h3 code")).toHaveText(longPath);
  expect(
    await apiCard
      .locator("h3")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  expect(
    await apiCard
      .locator("h3 code")
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain("Courier New");
  await apiCard.screenshot({
    path: join(screenshots, "workhub-card-preview.png"),
  });
  await ui.getByRole("button", { name: "Tree", exact: true }).click();
  await expect(ui.locator(".task-row")).toHaveCount(1);
  await expect(ui.locator(".task-row")).toContainText("api-8");
  await projectFilters
    .getByRole("button", { name: "admin", exact: true })
    .click();
  await expect(ui.locator(".task-row")).toHaveCount(1);
  await expect(
    ui.getByRole("checkbox", { name: "Reopen admin-4", exact: true }),
  ).toBeChecked();
  await ui
    .getByRole("checkbox", { name: "Show completed", exact: true })
    .uncheck();
  await expect(ui.locator(".task-row")).toHaveCount(0);
  await ui
    .getByRole("checkbox", { name: "Show completed", exact: true })
    .check();
  await projectFilters
    .getByRole("button", { name: "api", exact: true })
    .click();
  await ui.getByRole("button", { name: "New task", exact: true }).click();
  await expect(
    ui.getByRole("dialog").getByLabel("Project", { exact: true }),
  ).toHaveValue("api");
  await ui.getByRole("button", { name: "Close dialog" }).click();
  await ui.locator(".task-main").filter({ hasText: "api-8" }).click();
  await ui.getByRole("link", { name: "Runner task", exact: true }).click();
  await expect(
    projectFilters.getByRole("button", { name: "All projects", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(ui.locator(".detail-top")).toContainText("infra-1");
  await ui.getByRole("button", { name: "Close task details" }).click();
  // Labels stay aligned to their heading even when a task has no checklist.
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 960 });
    const labelHeading = (await ui
      .locator(".list-columns > span")
      .nth(1)
      .boundingBox())!;
    for (const row of await ui.locator(".task-row").all()) {
      const chip = (await row
        .locator(".row-labels > .label")
        .first()
        .boundingBox())!;
      expect(Math.abs(chip.x - labelHeading.x)).toBeLessThanOrEqual(1);
    }
    await page.screenshot({
      path: join(screenshots, `workhub-label-alignment-${width}.png`),
    });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await ui.getByRole("button", { name: "Board", exact: true }).click();
  await page.screenshot({
    path: join(screenshots, "workhub-board-preview.png"),
  });
  await page.screenshot({ path: join(screenshots, "mcp-ui-preview.png") });
  await page.setViewportSize({ width: 640, height: 800 });
  await expect(
    ui.getByRole("button", { name: "Board", exact: true }),
  ).toBeVisible();
  if (await ui.locator(".detail-panel").count())
    await ui.getByRole("button", { name: "Close task details" }).click();
  await labels.click();
  await expect(labelOptions).toBeVisible();
  const labelBox = (await labelOptions.boundingBox())!;
  expect(labelBox.x).toBeGreaterThanOrEqual(0);
  expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(640);
  await page.screenshot({
    path: join(screenshots, "workhub-labels-narrow-preview.png"),
  });
  await allLabels.press("Escape");
  const narrowCard = ui.locator(".task-card").first();
  await narrowCard.focus();
  await narrowCard.press("Shift+F10");
  const menuBox = await ui.getByRole("menu").boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(640);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(800);
  await ui
    .getByRole("menuitem", { name: "Start working", exact: true })
    .press("Escape");
  await expect(ui.getByRole("menu")).toHaveCount(0);
  await help.click();
  await expect(ui.getByRole("dialog").locator("kbd").first()).toBeVisible();
  await page.screenshot({ path: join(screenshots, "help-narrow-preview.png") });
  await ui.getByRole("button", { name: "Close dialog" }).press("Escape");
  await apiCard.click();
  await divider.press("End");
  await expect(divider).toHaveAttribute("aria-valuenow", "576");
  await page.setViewportSize({ width: 480, height: 800 });
  await expect(divider).toHaveAttribute("aria-valuenow", "432");
  const narrowPanel = (await ui.locator(".detail-panel").boundingBox())!;
  expect(narrowPanel.x).toBeGreaterThanOrEqual(0);
  expect(narrowPanel.x + narrowPanel.width).toBeLessThanOrEqual(480);
  await page.screenshot({
    path: join(screenshots, "workhub-detail-narrow-preview.png"),
  });
  // Returning to the iframe refreshes files without changing the selected filters.
  await page.setViewportSize({ width: 1440, height: 960 });
  await ui.getByRole("button", { name: "Close task details" }).click();
  await ui.getByRole("button", { name: "Tree", exact: true }).click();
  await projectFilters
    .getByRole("button", { name: "infra", exact: true })
    .click();
  const backlogFilter = ui
    .getByRole("navigation", { name: "Task filters" })
    .getByRole("button", { name: /^Backlog/ });
  await backlogFilter.click();
  await labels.click();
  await labelOptions
    .getByRole("checkbox", { name: "automation", exact: true })
    .check();
  await allLabels.press("Escape");
  const search = ui.getByRole("textbox", { name: "Search tasks" });
  await search.fill("Focus");
  await expect(ui.locator(".task-row")).toHaveCount(0);
  await expect(ui.locator(".breadcrumb")).toHaveText("AlphaBackloginfra0");
  const focusFile = join(roots[0], "todo/tasks/focus.md");
  const focusContent =
    doc("infra-99", "Focus refresh initial") +
    "\n" +
    "Paragraph for scroll retention.\n\n".repeat(45);
  await page.locator("#outside-app").focus();
  await writeFile(focusFile, focusContent);
  const readBeforeFocus = await readTime.getAttribute("datetime");
  await search.focus();
  const focusRow = ui.locator(".task-row").filter({ hasText: "infra-99" });
  await expect(focusRow).toContainText("Focus refresh initial");
  await expect(readTime).not.toHaveAttribute("datetime", readBeforeFocus!);
  await expect(ui.locator(".breadcrumb")).toHaveText("AlphaBackloginfra1");
  await expect(search).toHaveValue("Focus");
  await expect(labels).toHaveText("automation");
  await expect(backlogFilter).toHaveClass(/active/);
  await expect(
    projectFilters.getByRole("button", { name: "infra", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await focusRow.locator(".task-main").click();
  await expect(ui.locator(".detail-top")).toContainText("infra-99");
  await ui.locator(".detail-content").evaluate((el) => (el.scrollTop = 180));
  const scrollBefore = await ui
    .locator(".detail-content")
    .evaluate((el) => el.scrollTop);
  await page.locator("#outside-app").focus();
  const focusUpdated =
    replaceField(focusContent, "summary", "Focus refresh updated") +
    "\nSaved externally\n";
  await writeFile(focusFile, focusUpdated);
  await search.focus();
  await expect(focusRow).toContainText("Focus refresh updated");
  await expect(ui.locator(".markdown")).toContainText("Saved externally");
  await expect(ui.locator(".detail-top")).toContainText("infra-99");
  expect(
    await ui.locator(".detail-content").evaluate((el) => el.scrollTop),
  ).toBe(scrollBefore);
  await expect(search).toBeFocused();
  // A hidden view also reloads when made visible, without needing a focus event.
  await ui.locator("body").evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const visibleUpdated = focusUpdated + "\nVisible again edit\n";
  await writeFile(focusFile, visibleUpdated);
  await ui.locator("body").evaluate(() => {
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(ui.locator(".markdown")).toContainText("Visible again edit");
  // A draft started while a focus reload is awaiting its response must survive.
  await ui.getByRole("button", { name: "Edit file", exact: true }).click();
  const focusEditor = ui.getByRole("textbox", {
    name: "Markdown with TOML frontmatter",
  });
  await page.locator("#outside-app").focus();
  const diskEdit =
    replaceField(visibleUpdated, "labels", "automation,focus-check") +
    "\nAnother disk edit\n";
  await writeFile(focusFile, diskEdit);
  let readPaused = false;
  let releaseRead: (() => void) | undefined;
  pauseTaskRead = () =>
    new Promise<void>((resolve) => {
      readPaused = true;
      releaseRead = resolve;
    });
  await focusEditor.focus();
  await expect.poll(() => readPaused).toBe(true);
  const localDraft = (await focusEditor.inputValue()) + "\nLocal draft\n";
  await focusEditor.fill(localDraft);
  releaseRead!();
  await expect(ui.getByRole("status")).toContainText(
    "This file changed on disk",
  );
  await expect(focusEditor).toHaveValue(localDraft);
  await expect(ui.getByRole("dialog")).toHaveCount(0);
  expect(await readFile(focusFile, "utf8")).toBe(diskEdit);
  // Returning with an already dirty draft also refreshes the list but preserves the editor.
  await page.locator("#outside-app").focus();
  const newStatus = replaceField(diskEdit, "status", "ready after focus");
  await writeFile(focusFile, newStatus);
  await focusEditor.focus();
  await expect(
    ui
      .getByRole("navigation", { name: "Task filters" })
      .getByRole("button", { name: /^ready after focus/ }),
  ).toBeVisible();
  await expect(focusEditor).toHaveValue(localDraft);
  await ui.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(ui.getByRole("alert")).toContainText("changed on disk");
  expect(await readFile(focusFile, "utf8")).toBe(newStatus);
  await ui.getByRole("button", { name: "Close task details" }).click();
  await ui.getByRole("button", { name: "Discard draft", exact: true }).click();
  await ui.getByRole("button", { name: /^All tasks/ }).click();
  await focusRow.locator(".task-main").click();
  await expect(ui.locator(".detail-top")).toContainText("infra-99");
  await page.locator("#outside-app").focus();
  await rm(focusFile);
  await search.focus();
  await expect(ui.locator(".task-row")).toHaveCount(0);
  await expect(ui.locator(".detail-panel")).toHaveCount(0);
  await search.fill("");
  await labels.click();
  await allLabels.check();
  await allLabels.press("Escape");
  await projectFilters
    .getByRole("button", { name: "All projects", exact: true })
    .click();
  await page.screenshot({
    path: join(screenshots, "workhub-sidebar-focus-preview.png"),
  });
  // First-run guidance works with an empty registry and connects an existing task folder.
  const onboardingStore = new TodoStore(join(temporary, "onboarding.json"));
  const onboardingPage = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  onboardingPage.on("pageerror", (e) => errors.push(e.message));
  let pickedFolder: { path?: string; suggestedRoot?: string } = {};
  let pickerResponse = async () => pickedFolder;
  await onboardingPage.exposeFunction(
    "runTodoTool",
    async (name: string, args: Record<string, unknown>) => {
      try {
        const data =
          name === "todo_choose_directory"
            ? await pickerResponse()
            : await execute(onboardingStore, name, args);
        return { content: [], structuredContent: data };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: String(error) }],
        };
      }
    },
  );
  await onboardingPage.setContent(
    '<iframe id="app" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>',
  );
  await onboardingPage.addScriptTag({ content: host.outputFiles[0].text });
  await onboardingPage.evaluate(
    ({ html, data }) =>
      (
        window as unknown as {
          startTodoHost: (html: string, data: unknown) => Promise<void>;
        }
      ).startTodoHost(html, data),
    {
      html: appHtml,
      data: {
        content: [],
        structuredContent: { snapshot: await onboardingStore.snapshot() },
      },
    },
  );
  const firstRunUi = onboardingPage.frameLocator("#app");
  const startPage = firstRunUi.locator(".onboarding");
  await expect(startPage).toContainText("todo/");
  await expect(startPage).toContainText("TOML format");
  await expect(startPage.getByLabel("Initialization prompt")).toHaveText(
    "$todo init /path/to/project",
  );
  await startPage.getByText("Task file format", { exact: true }).click();
  await expect(startPage.locator(".onboarding-format p")).toBeVisible();
  await expect(startPage.locator(".onboarding-format p")).toContainText(
    "task_id",
  );
  await startPage.getByText("Task file format", { exact: true }).click();
  await onboardingPage.screenshot({
    path: join(screenshots, "onboarding-preview.png"),
  });
  for (const width of [640, 480]) {
    await onboardingPage.setViewportSize({ width, height: 800 });
    await startPage
      .getByLabel("Initialization prompt")
      .scrollIntoViewIfNeeded();
    expect(
      await startPage
        .getByLabel("Initialization prompt")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await onboardingPage.screenshot({
      path: join(screenshots, `onboarding-${width}-preview.png`),
    });
  }
  await onboardingPage.setViewportSize({ width: 1440, height: 960 });
  const emptyWorkspace = join(temporary, "starter project");
  await mkdir(emptyWorkspace);
  await startPage.getByRole("button", { name: "Connect workspace" }).click();
  await firstRunUi
    .getByLabel("Workspace name", { exact: true })
    .fill("Starter project");
  await firstRunUi
    .getByLabel("Local workspace path", { exact: true })
    .fill(emptyWorkspace);
  await firstRunUi
    .getByRole("button", { name: "Browse workspace", exact: true })
    .click();
  await expect(
    firstRunUi.getByLabel("Local workspace path", { exact: true }),
  ).toHaveValue(emptyWorkspace);
  // A missing host dialog must never lock the form, and late replies must not
  // replace manual input or a newly opened connection form.
  let finishPick: (result: typeof pickedFolder) => void = () => {};
  function stallPicker() {
    const response = new Promise<typeof pickedFolder>((resolve) => {
      finishPick = resolve;
    });
    pickerResponse = () => response;
  }
  const browseWorkspace = firstRunUi.getByRole("button", {
    name: "Browse workspace",
    exact: true,
  });
  const workspacePath = firstRunUi.getByLabel("Local workspace path", {
    exact: true,
  });
  const pendingPicker = firstRunUi.locator(".folder-picker-pending");
  stallPicker();
  await browseWorkspace.click();
  await expect(pendingPicker).toBeVisible();
  await expect(workspacePath).toBeEnabled();
  await expect(
    firstRunUi.getByLabel("Workspace name", { exact: true }),
  ).toBeEnabled();
  await expect(
    firstRunUi.getByLabel("Task folder", { exact: true }),
  ).toBeEnabled();
  await expect(
    firstRunUi.getByRole("button", { name: "Close dialog" }),
  ).toBeEnabled();
  await expect(
    firstRunUi
      .getByRole("dialog")
      .getByRole("button", { name: "Connect workspace" }),
  ).toBeEnabled();
  await onboardingPage.screenshot({
    path: join(screenshots, "picker-pending-preview.png"),
  });
  await firstRunUi.getByRole("button", { name: "Cancel browse" }).click();
  finishPick({ path: roots[0], suggestedRoot: temporary });
  await expect(browseWorkspace).toBeEnabled();
  await expect(workspacePath).toHaveValue(emptyWorkspace);
  pickerResponse = async () => {
    throw Error(
      "The folder picker could not open. Enter the folder path manually.",
    );
  };
  await browseWorkspace.click();
  await expect(firstRunUi.getByRole("dialog").getByRole("alert")).toContainText(
    "manually",
  );
  await expect(browseWorkspace).toBeEnabled();
  stallPicker();
  await browseWorkspace.click();
  await expect(pendingPicker).toBeVisible();
  await workspacePath.fill(roots[1]);
  finishPick({ path: roots[0], suggestedRoot: temporary });
  await expect(browseWorkspace).toBeEnabled();
  await expect(workspacePath).toHaveValue(roots[1]);
  stallPicker();
  await browseWorkspace.click();
  await expect(pendingPicker).toBeVisible();
  await workspacePath.press("Escape");
  await expect(firstRunUi.getByRole("dialog")).toHaveCount(0);
  await startPage.getByRole("button", { name: "Connect workspace" }).click();
  finishPick({ path: roots[0], suggestedRoot: temporary });
  await expect(workspacePath).toHaveValue("");
  await onboardingPage.clock.install();
  stallPicker();
  await browseWorkspace.click();
  await expect(pendingPicker).toBeVisible();
  await onboardingPage.clock.fastForward(120_100);
  await expect(firstRunUi.getByRole("dialog").getByRole("alert")).toContainText(
    "timed out",
  );
  await expect(browseWorkspace).toBeEnabled();
  finishPick({ path: roots[0], suggestedRoot: temporary });
  await expect(workspacePath).toHaveValue("");
  await onboardingPage.clock.resume();
  pickerResponse = async () => pickedFolder;
  await firstRunUi
    .getByLabel("Workspace name", { exact: true })
    .fill("Starter project");
  await workspacePath.fill(emptyWorkspace);
  await onboardingPage.screenshot({
    path: join(screenshots, "connect-folders-preview.png"),
  });
  await firstRunUi
    .getByRole("dialog")
    .getByRole("button", { name: "Connect workspace" })
    .click();
  const confirmation = firstRunUi.getByRole("dialog", {
    name: "Create a task folder?",
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.locator(".todo-create-path")).toHaveText(
    join(emptyWorkspace, "todo"),
  );
  expect(await readdir(emptyWorkspace)).toEqual([]);
  expect(await onboardingStore.projects()).toEqual([]);
  await onboardingPage.screenshot({
    path: join(screenshots, "create-todo-confirmation-preview.png"),
  });
  await confirmation.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    firstRunUi.getByLabel("Workspace name", { exact: true }),
  ).toHaveValue("Starter project");
  await expect(
    firstRunUi.getByLabel("Local workspace path", { exact: true }),
  ).toHaveValue(emptyWorkspace);
  const secondWorkspace = join(temporary, "second project");
  await mkdir(secondWorkspace);
  pickedFolder = { path: secondWorkspace, suggestedRoot: temporary };
  await firstRunUi
    .getByRole("button", { name: "Browse workspace", exact: true })
    .click();
  await expect(
    firstRunUi.getByLabel("Local workspace path", { exact: true }),
  ).toHaveValue(secondWorkspace);
  await firstRunUi
    .getByLabel("Task folder", { exact: true })
    .fill("work-items");
  await firstRunUi
    .getByRole("dialog")
    .getByRole("button", { name: "Connect workspace" })
    .click();
  await expect(confirmation.locator(".todo-create-path")).toHaveText(
    join(secondWorkspace, "work-items"),
  );
  await onboardingPage.setViewportSize({ width: 480, height: 800 });
  expect(
    await confirmation
      .locator(".todo-create-path")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await onboardingPage.screenshot({
    path: join(screenshots, "create-todo-confirmation-480-preview.png"),
  });
  await confirmation
    .getByRole("button", { name: "Create and connect", exact: true })
    .click();
  await expect(startPage).toHaveCount(0);
  await expect(firstRunUi.locator(".breadcrumb")).toContainText(
    "Starter project",
  );
  const projects = await onboardingStore.projects();
  expect(projects.length).toBe(1);
  expect(projects[0].root).toBe(secondWorkspace);
  expect(projects[0].taskDirectory).toBe("work-items");
  expect(await readdir(join(secondWorkspace, "work-items"))).toEqual([]);
  expect(await readdir(emptyWorkspace)).toEqual([]);
  await expect(firstRunUi.getByRole("alert")).toHaveCount(0);
  // Existing folders can also be selected, with the root inferred when blank.
  await onboardingPage.setViewportSize({ width: 1440, height: 960 });
  await firstRunUi
    .getByRole("button", { name: "Connect workspace", exact: true })
    .click();
  pickedFolder = {
    path: join(roots[0], "todo/tasks"),
    suggestedRoot: roots[0],
  };
  await firstRunUi
    .getByRole("button", { name: "Browse task folder", exact: true })
    .click();
  await expect(
    firstRunUi.getByLabel("Local workspace path", { exact: true }),
  ).toHaveValue(roots[0]);
  await expect(
    firstRunUi.getByLabel("Task folder", { exact: true }),
  ).toHaveValue(pickedFolder.path!);
  await firstRunUi
    .getByLabel("Workspace name", { exact: true })
    .fill("Existing project");
  await firstRunUi
    .getByRole("dialog")
    .getByRole("button", { name: "Connect workspace" })
    .click();
  await expect(firstRunUi.locator(".breadcrumb")).toContainText(
    "Existing project",
  );
  expect((await onboardingStore.projects()).length).toBe(2);
  await onboardingPage.close();
  expect(errors).toEqual([]);
  process.stdout.write(
    "MCP App host: first-run guidance, stalled/failed/cancelled/timed-out folder pickers with late-reply protection, folder selection and confirmed flat/custom-folder creation, Workhub branding, compact filter header, fresh initial/read timestamps, persistent accent colors with keyboard and dark theme, initial/live host fonts, safe card titles, left-aligned list labels, multi-label checkbox filters, sidebar project lists, focus refresh with draft race protection, draggable/keyboard panel resizing, completed defaults, Help, archive/undo, menus, task references, workspace isolation, chat requests, draft protection and narrow layout passed\n",
  );
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
