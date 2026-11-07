import test from "node:test";
import assert from "node:assert/strict";
import {
  createRepositorySync,
  repositorySlug,
  eligibleSource,
  redactSource,
  parseReport,
} from "./repository-sync.mjs";

const old = "a".repeat(40),
  next = "b".repeat(40);
function fixture(overrides = {}) {
  const project = {
    id: "one",
    repository: "https://github.com/user/repo",
    repositoryReport: { commit: old, summary: "Previous report" },
  };
  let calls = 0;
  const sync = createRepositorySync({
    projects: [project],
    save: async () => {},
    getHead: async () => ({ sha: next, branch: "main", message: "New code" }),
    getEvidence: async () => ({
      snapshot: "local",
      githubStatus: "CI unknown",
    }),
    generate: async () => {
      calls++;
      return {
        summary: "Updated",
        stage: "Implemented",
        implemented: [],
        remaining: [],
        validation: "Not executed",
        evidence: [],
      };
    },
    ...overrides,
  });
  return { project, sync, calls: () => calls };
}
test("only GitHub repository URLs and safe source files are accepted", () => {
  assert.equal(repositorySlug("https://github.com/user/repo.git"), "user/repo");
  assert.equal(repositorySlug("https://example.com/user/repo"), null);
  for (const file of [
    ".env",
    "serviceAccountKey.json",
    "secrets.py",
    "../server.mjs",
    "assets/vendor/a.js",
    "src/key.pem",
  ])
    assert.equal(eligibleSource(file), false, file);
  assert.equal(eligibleSource("src/Game.cs"), true);
  assert.equal(eligibleSource("docs/WORK_LOG.md"), true);
  assert.equal(
    redactSource('API_KEY = "sensitive-value"'),
    'API_KEY = "[REDACTED]"',
  );
});
test("unchanged head avoids AI calls and keeps the existing report", async () => {
  const f = fixture({ getHead: async () => ({ sha: old }) });
  await f.sync.poll();
  assert.equal(f.calls(), 0);
  assert.equal(f.project.repositoryReport.summary, "Previous report");
  assert.equal(f.project.repositorySync.state, "current");
});
test("new commit updates report once then skips the same commit", async () => {
  const f = fixture();
  await f.sync.poll();
  await f.sync.poll();
  assert.equal(f.calls(), 1);
  assert.equal(f.project.repositoryReport.commit, next);
  assert.equal(f.project.repositoryReport.summary, "Updated");
});
test("failed summarization preserves last successful report and retries", async () => {
  let fail = true;
  const f = fixture({
    generate: async () => {
      if (fail) throw Error("temporary failure");
      return { summary: "Recovered" };
    },
  });
  await f.sync.poll();
  assert.equal(f.project.repositoryReport.commit, old);
  assert.equal(f.project.repositorySync.state, "error");
  fail = false;
  await f.sync.poll();
  assert.equal(f.project.repositoryReport.commit, next);
});
test("deleted projects are skipped; held projects still receive read-only summaries", async () => {
  const f = fixture();
  f.project.deletedAt = "now";
  await f.sync.poll();
  assert.equal(f.calls(), 0);
  delete f.project.deletedAt;
  f.project.onHold = true;
  await f.sync.poll();
  assert.equal(f.calls(), 1);
  assert.equal(f.project.onHold, true);
});
test("a project deleted during analysis cannot receive a new report", async () => {
  const f = fixture({
    generate: async () => {
      f.project.deletedAt = "now";
      return { summary: "Must not apply" };
    },
  });
  await f.sync.poll();
  assert.equal(f.project.repositoryReport.commit, old);
});
test("concurrent scans do not duplicate AI calls", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const f = fixture({
    getHead: async () => {
      await gate;
      return { sha: next, branch: "main", message: "new" };
    },
  });
  const first = f.sync.poll();
  assert.equal(await f.sync.poll(), false);
  release();
  await first;
  assert.equal(f.calls(), 1);
});
test("invalid generated reports are rejected; evidence is restricted to fetched paths", () => {
  assert.throws(() => parseReport('{"stage":"missing fields"}', []));
  const r = parseReport(
    JSON.stringify({
      stage: "done",
      summary: "summary",
      validation: "Not run",
      implemented: [],
      remaining: [],
      evidence: ["invented.txt"],
    }),
    [{ path: "src/main.js" }],
  );
  assert.deepEqual(r.evidence, ["src/main.js"]);
});
