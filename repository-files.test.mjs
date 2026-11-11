import test from "node:test";
import assert from "node:assert/strict";
import { createRepositoryFiles } from "./repository-files.mjs";
test("GitHub view pins commits, resolves blobs, caches reads and rejects arbitrary paths", async () => {
  const a = "a".repeat(40),
    b = "b".repeat(40);
  const calls = [];
  const view = createRepositoryFiles(async (endpoint) => {
    calls.push(endpoint);
    if (endpoint.endsWith("commits?per_page=20"))
      return [a, b].map((sha) => ({ sha, commit: { message: "change" } }));
    if (endpoint.includes("/git/trees/"))
      return {
        tree: [
          {
            path: "src/App.tsx",
            type: "blob",
            mode: "100644",
            size: 25,
            sha: endpoint.includes(a) ? "new" : "old",
          },
          { path: "link", type: "blob", mode: "120000", sha: "link" },
        ],
      };
    if (endpoint.endsWith("/new"))
      return {
        encoding: "base64",
        content: Buffer.from("new code").toString("base64"),
      };
    if (endpoint.endsWith("/old"))
      return {
        encoding: "base64",
        content: Buffer.from("old code").toString("base64"),
      };
    throw Error("unexpected endpoint");
  });
  const p = { repository: "https://github.com/staypleur/WC-OFFICE" };
  const list = await view(p);
  assert.equal(list.version, a);
  assert.equal(list.files.length, 1);
  assert.equal((await view(p, a, "src/App.tsx")).content, "new code");
  assert.equal((await view(p, b, "src/App.tsx")).content, "old code");
  await assert.rejects(view(p, a, "../.env"));
  await assert.rejects(view(p, "bad"));
  assert.equal(calls.filter((c) => c.includes("commits?")).length, 1);
  await view(p, "current", undefined, true);
  assert.equal(calls.filter((c) => c.includes("commits?")).length, 2);
});
