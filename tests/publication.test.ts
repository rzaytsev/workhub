import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const run = promisify(execFile);
const png = await readFile(
  new URL("../docs/screenshots/tree.png", import.meta.url),
);
const checker = await readFile(
  new URL("../scripts/check-publication.py", import.meta.url),
);
const image = "docs/screenshots/tree.png";
const digest = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");

async function fixture(operation: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "publication-check-"));
  try {
    await mkdir(join(root, "scripts"));
    await mkdir(join(root, "docs/screenshots"), { recursive: true });
    await writeFile(join(root, "scripts/check-publication.py"), checker);
    await writeFile(join(root, image), png);
    await approve(root, png);
    await operation(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function approve(root: string, data: Buffer) {
  await writeFile(
    join(root, "docs/screenshots/reviewed.json"),
    JSON.stringify({ [image]: digest(data) }),
  );
}

async function check(root: string, staged = false) {
  return run(
    "python3",
    ["scripts/check-publication.py", ...(staged ? ["--staged"] : [])],
    { cwd: root },
  );
}

async function rejects(root: string, pattern: RegExp, staged = false) {
  await assert.rejects(check(root, staged), (error: unknown) => {
    const result = error as { code?: number; stdout?: string };
    assert.equal(result.code, 1);
    assert.match(result.stdout || "", pattern);
    return true;
  });
}

test("publication accepts only exact reviewed PNGs and keeps other binaries blocked", async () => {
  await fixture(async (root) => {
    assert.match((await check(root)).stdout, /1 reviewed screenshots/);
    const changed = Buffer.from(png);
    changed[changed.length - 1] ^= 1;
    await writeFile(join(root, image), changed);
    await rejects(root, /review again/);
    await writeFile(join(root, image), png);
    await writeFile(join(root, "docs/screenshots/unreviewed.png"), png);
    await rejects(root, /unreviewed.png: binary file requires manual review/);
  });
});

test("review hashes cannot approve embedded metadata, bad checksums, or truncated PNGs", async () => {
  await fixture(async (root) => {
    const metadata = Buffer.concat([
      png.subarray(0, 8),
      Buffer.from([0, 0, 0, 3]),
      Buffer.from("tEXt"),
      Buffer.from("x\0y"),
      Buffer.alloc(4),
      png.subarray(8),
    ]);
    const badChecksum = Buffer.from(png);
    badChecksum[badChecksum.length - 1] ^= 1;
    for (const invalid of [
      metadata,
      badChecksum,
      png.subarray(0, png.length - 1),
    ]) {
      await writeFile(join(root, image), invalid);
      await approve(root, invalid);
      await rejects(root, /review again/);
    }
  });
});

test("publication preserves task-directory and private-path rejection", async () => {
  await fixture(async (root) => {
    await mkdir(join(root, "todo"));
    await writeFile(join(root, "todo/example.md"), "# Fictional example\n");
    await writeFile(
      join(root, "note.md"),
      ["", "Users", "example", "private"].join("/"),
    );
    await rejects(root, /private\/generated directory/);
    await rejects(root, /machine-specific path/);
  });
});

test("staged image validation uses both the indexed image and indexed approval", async () => {
  await fixture(async (root) => {
    await run("git", ["init", "--quiet"], { cwd: root });
    await run("git", ["add", "scripts", "docs"], { cwd: root });
    const changed = Buffer.from(png);
    changed[changed.length - 1] ^= 1;
    await writeFile(join(root, image), changed);
    await approve(root, changed);
    await rejects(root, /review again/);
    assert.match((await check(root, true)).stdout, /1 reviewed screenshots/);
    await run("git", ["add", image], { cwd: root });
    await rejects(root, /review again/, true);
  });
});

test("publication rejects malformed or out-of-scope screenshot approvals", async () => {
  await fixture(async (root) => {
    for (const approval of [
      [],
      { "example.png": digest(png) },
      { [image]: "not a digest" },
    ]) {
      await writeFile(
        join(root, "docs/screenshots/reviewed.json"),
        JSON.stringify(approval),
      );
      await rejects(root, /invalid screenshot approval manifest/);
    }
  });
});
