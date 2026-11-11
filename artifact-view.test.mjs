import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { artifactView } from "./artifact-view.mjs";
import { checkpoint } from "./project-tools.mjs";
import { diffLines } from "./file-diff.mjs";
test("only registered output files are readable; web filenames align across versions", async () => {
  const folder = await mkdtemp(path.resolve("data/view-test-"));
  const file = path.join(folder, "web-123.html");
  await writeFile(file, "before");
  await writeFile(path.join(folder, "private.txt"), "secret");
  const p = { folder, artifact: { type: "web", path: file } };
  const cp = await checkpoint(p);
  await writeFile(file, "after");
  assert.deepEqual(
    (await artifactView(p)).files.map((f) => f.name),
    ["index.html"],
  );
  assert.equal(
    (await artifactView(p, "current", "index.html")).content,
    "after",
  );
  assert.equal((await artifactView(p, cp.id, "index.html")).content, "before");
  await assert.rejects(artifactView(p, "current", "../private.txt"));
  await assert.rejects(artifactView(p, "unknown", "index.html"));
});
test("line diff preserves context and distinguishes additions deletions and no change", () => {
  const d = diffLines("a\nb\nc", "a\nx\nc");
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
  assert.deepEqual(
    d.rows.map((r) => r.kind),
    ["same", "remove", "add", "same"],
  );
  assert.equal(diffLines("same", "same").rows.length, 0);
  assert.equal(diffLines("", "new").added, 1);
  assert.equal(diffLines("old", "").removed, 1);
  const huge = diffLines(
    Array(1000).fill("a").join("\n"),
    Array(1000).fill("b").join("\n"),
  );
  assert.equal(huge.coarse, true);
  assert.equal(huge.rows.length, 1500);
});
