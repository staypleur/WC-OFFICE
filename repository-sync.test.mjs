import test from "node:test";
import assert from "node:assert/strict";
import {
  createRepositorySync,
  repositorySlug,
  eligibleSource,
  redactSource,
  parseReport,
  changeReport,
  archiveRepositoryReport,
} from "./repository-sync.mjs";

const old = "a".repeat(40),
  next = "b".repeat(40);

test("history preserves dated snapshots and deduplicates a commit across reloads", () => {
  const project = {
    repository: "https://github.com/user/repo.git",
    repositoryReport: {
      commit: old,
      checkedAt: "2026-11-07T17:00:00Z",
      summary: "Original",
      changeReport: { state: "changed", items: ["First change"] },
    },
  };
  archiveRepositoryReport(project);
  project.repositoryReport.summary = "Modified";
  project.repositoryReport.changeReport.items[0] = "Mutated";
  archiveRepositoryReport(project);
  assert.equal(project.repositoryHistory.length, 1);
  assert.equal(project.repositoryHistory[0].summary, "Original");
  assert.deepEqual(project.repositoryHistory[0].changeReport.items, [
    "First change",
  ]);
  const reloaded = JSON.parse(JSON.stringify(project));
  archiveRepositoryReport(reloaded);
  assert.equal(reloaded.repositoryHistory.length, 1);
  reloaded.repositoryReport.commit = next;
  reloaded.repositoryReport.checkedAt = "2026-11-08T17:00:00Z";
  archiveRepositoryReport(reloaded);
  assert.equal(reloaded.repositoryHistory.length, 2);
  assert.equal(reloaded.repositoryHistory[0].checkedAt, "2026-11-07T17:00:00Z");
});

test("refresh archives existing and new reports; unchanged and failed refreshes add no duplicates", async () => {
  let fail = false;
  const f = fixture({
    getHead: async () => {
      if (fail) throw Error("offline");
      return { sha: next, branch: "main", message: "new" };
    },
  });
  f.project.repositoryReport.checkedAt = "2026-11-07T17:00:00Z";
  await f.sync.refresh("one");
  assert.deepEqual(
    f.project.repositoryHistory.map((entry) => entry.commit),
    [old, next],
  );
  await f.sync.refresh("one");
  fail = true;
  await f.sync.refresh("one");
  assert.equal(f.project.repositoryHistory.length, 2);
});

test("change summaries distinguish compared commits, first reports and unavailable history", () => {
  const latest = { sha: next, message: "Added refresh" };
  const summary = { changes: ["프로젝트별 새로고침 버튼 추가"] };
  const delta = changeReport(
    { commit: old },
    latest,
    { compared: true },
    summary,
    "now",
  );
  assert.equal(delta.from, old);
  assert.equal(delta.to, next);
  assert.deepEqual(delta.items, summary.changes);
  assert.equal(delta.state, "changed");
  assert.equal(
    changeReport(null, latest, {}, summary, "now").state,
    "baseline",
  );
  const missing = changeReport(
    { commit: old },
    latest,
    { compared: false },
    summary,
    "now",
  );
  assert.equal(missing.state, "unavailable");
  assert.deepEqual(missing.items, []);
});

test("unchanged checks preserve the last actual change summary", async () => {
  const f = fixture({
    getEvidence: async () => ({ compared: true }),
    generate: async () => ({ changes: ["새 버튼 추가"], summary: "Updated" }),
  });
  await f.sync.refresh("one");
  const delta = f.project.repositoryReport.changeReport;
  assert.deepEqual(delta.items, ["새 버튼 추가"]);
  assert.equal(f.project.repositorySync.noChanges, false);
  await f.sync.refresh("one");
  assert.equal(f.project.repositorySync.noChanges, true);
  assert.deepEqual(f.project.repositoryReport.changeReport, delta);
});

test("invalid change summary is rejected", () => {
  const report = {
    stage: "done",
    summary: "summary",
    validation: "not run",
    implemented: [],
    remaining: [],
    changes: [42],
  };
  assert.throws(() => parseReport(JSON.stringify(report), []));
});

test("batch refresh counts success, failures and skips and ignores duplicate starts", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const projects = [
    { id: "ok", onHold: true },
    { id: "fail" },
    { id: "busy" },
    { id: "unlinked", repository: "" },
    { id: "deleted", deletedAt: "today" },
  ].map((p) => ({
    repository: "https://github.com/user/repo",
    repositoryReport: { commit: old },
    ...p,
  }));
  const sync = createRepositorySync({
    projects,
    save: async () => {},
    isActive: (id) => id === "busy",
    getHead: async (p) => {
      calls++;
      await gate;
      if (p.id === "fail") throw Error("offline");
      return { sha: old };
    },
  });
  assert.equal(sync.refreshAll().state, "running");
  assert.equal(sync.refreshAll().total, 4);
  release();
  for (let i = 0; i < 20 && sync.batchStatus.state === "running"; i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sync.batchStatus.state, "partial");
  assert.equal(sync.batchStatus.completed, 1);
  assert.equal(sync.batchStatus.failed, 1);
  assert.equal(sync.batchStatus.skipped, 2);
  assert.equal(calls, 2);
  assert.ok(sync.batchStatus.finishedAt);
});

test("empty batch finishes without leaving a running state", () => {
  const sync = createRepositorySync({ projects: [], save: async () => {} });
  assert.equal(sync.refreshAll().state, "complete");
  assert.equal(sync.batchStatus.total, 0);
});

test("manual refresh targets one project and coalesces repeated clicks", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let heads = 0;
  const f = fixture({
    getHead: async () => {
      heads++;
      await gate;
      return { sha: next, branch: "main", message: "New code" };
    },
  });
  const first = f.sync.refresh("one");
  const second = f.sync.refresh("one");
  assert.equal(first, second);
  release();
  await Promise.all([first, second]);
  assert.equal(heads, 1);
  assert.equal(f.calls(), 1);
  assert.equal(f.project.repositorySync.state, "current");
});

test("manual refresh rejects missing, deleted and actively running projects", async () => {
  const f = fixture();
  await assert.rejects(f.sync.refresh("missing"));
  f.project.deletedAt = "today";
  await assert.rejects(f.sync.refresh("one"));
  const busy = fixture({ isActive: () => true });
  await assert.rejects(busy.sync.refresh("one"));
});

test("manual refresh works for held projects while another project is being checked", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const one = {
    id: "one",
    repository: "https://github.com/user/one",
    repositoryReport: { commit: old },
  };
  const two = {
    id: "two",
    repository: "https://github.com/user/two",
    onHold: true,
    repositoryReport: { commit: old },
  };
  const sync = createRepositorySync({
    projects: [one, two],
    save: async () => {},
    getHead: async (p) => {
      if (p.id === "one") await gate;
      return { sha: old };
    },
  });
  const polling = sync.poll();
  await sync.refresh("two");
  assert.equal(two.repositorySync.state, "current");
  release();
  await polling;
});
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
