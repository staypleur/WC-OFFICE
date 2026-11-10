import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import {
  checkpoint,
  restoreCheckpoint,
  checkWeb,
  testArtifact,
} from "./project-tools.mjs";
test("web checks syntax without executing generated code", () => {
  assert.equal(
    checkWeb(
      '<!doctype html><html><script>throw Error("must not execute")</script></html>',
    ).passed,
    true,
  );
  assert.equal(
    checkWeb("<!doctype html><html><script>const = ;</script></html>").passed,
    false,
  );
  assert.equal(checkWeb("not html").passed, false);
  assert.match(
    checkWeb(
      '<!doctype html><html><script type="module">import x from "x"</script></html>',
    ).note,
    /검사 제외/,
  );
});
test("checkpoint restores old contents into a new folder and preserves current files", async () => {
  const folder = await mkdtemp(path.resolve("data", "checkpoint-test-"));
  const file = path.join(folder, "result.html");
  await writeFile(file, "before");
  const p = { folder, artifact: { type: "web", path: file }, tasks: [] };
  const root = path.join(folder, "snapshots");
  const entry = await checkpoint(p, root);
  await writeFile(file, "after");
  const restored = await restoreCheckpoint(p, entry.id, root);
  assert.equal(await readFile(restored.path, "utf8"), "before");
  assert.equal(await readFile(file, "utf8"), "after");
  await assert.rejects(restoreCheckpoint(p, "../../other", root));
});
test("Unity failure is recorded and Roblox is never reported as tested", async () => {
  const result = await testArtifact(
    { type: "unity", path: "fixture" },
    async () => {
      throw new Error("license missing");
    },
  );
  assert.equal(result.passed, false);
  assert.match(result.checks[0].detail, /license/);
  assert.equal((await testArtifact({ type: "roblox" })).passed, null);
});
