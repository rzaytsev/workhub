import { test } from "node:test";
import assert from "node:assert/strict";
import { shortcutAction, shortcuts, tip } from "../src/app/shortcuts.js";
const event = (key: string, overrides = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  ...overrides,
});
test("quick actions stay out of typing, modifier chords and repeated key events", () => {
  for (const [key, action] of Object.entries({
    n: "newTask",
    e: "edit",
    w: "work",
    d: "done",
    r: "refresh",
    t: "tree",
    b: "board",
    j: "next",
    k: "previous",
    "?": "help",
  })) {
    assert.equal(shortcutAction(event(key), false), action);
    assert.equal(shortcutAction(event(key), true), undefined);
    assert.equal(
      shortcutAction(event(key, { altKey: true }), false),
      undefined,
    );
    assert.equal(
      shortcutAction(event(key, { repeat: true }), false),
      undefined,
    );
  }
  assert.equal(
    shortcutAction(event("A", { shiftKey: true }), false),
    "archiveDone",
  );
  assert.equal(shortcutAction(event("a"), false), undefined);
});
test("search and save work in the editor, typing undo stays native, and tooltips share shortcut labels", () => {
  for (const modifier of ["metaKey", "ctrlKey"]) {
    assert.equal(
      shortcutAction(event("k", { [modifier]: true }), true),
      "search",
    );
    assert.equal(
      shortcutAction(event("Enter", { [modifier]: true }), true),
      "save",
    );
    assert.equal(
      shortcutAction(event("z", { [modifier]: true }), false),
      "undo",
    );
    assert.equal(
      shortcutAction(event("z", { [modifier]: true }), true),
      undefined,
    );
    assert.equal(
      shortcutAction(event("z", { [modifier]: true, shiftKey: true }), false),
      undefined,
    );
  }
  assert.equal(
    tip("Show guide", "help"),
    `Show guide (${shortcuts.help.keys})`,
  );
});
