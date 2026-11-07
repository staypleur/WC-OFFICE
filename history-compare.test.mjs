import test from "node:test";
import assert from "node:assert/strict";
import { compareHistory, historyKey } from "./history-compare.mjs";
const a = "a".repeat(40),
  b = "b".repeat(40),
  c = "c".repeat(40);
const entries = [
  {
    repository: "owner/repo",
    commit: a,
    checkedAt: "2026-11-07T15:00:00Z",
    stage: "시작",
  },
  {
    repository: "owner/repo",
    commit: b,
    checkedAt: "2026-11-08T15:00:00Z",
    changeReport: { state: "changed", from: a, to: b, items: ["버튼 추가"] },
  },
  {
    repository: "owner/repo",
    commit: c,
    checkedAt: "2026-11-09T15:00:00Z",
    changeReport: {
      state: "changed",
      from: b,
      to: c,
      items: ["버튼 추가", "색상 수정"],
    },
  },
];
test("compares the selected interval excluding its start and preserves endpoints", () => {
  const r = compareHistory(
    [...entries].reverse(),
    historyKey(entries[0]),
    historyKey(entries[2]),
  );
  assert.deepEqual(r.changes, ["버튼 추가", "색상 수정"]);
  assert.equal(r.count, 2);
  assert.equal(r.before.commit, a);
  assert.equal(r.after.commit, c);
  assert.equal(r.incomplete, false);
  assert.equal(
    r.compareUrl,
    `https://github.com/owner/repo/compare/${a}...${c}`,
  );
  assert.equal(
    compareHistory(entries, historyKey(entries[1]), historyKey(entries[2]))
      .count,
    1,
  );
});
test("rejects missing, equal, reversed and cross-repository selections", () => {
  assert.ok(compareHistory(entries, "missing", historyKey(entries[2])).error);
  assert.ok(
    compareHistory(entries, historyKey(entries[0]), historyKey(entries[0]))
      .error,
  );
  assert.ok(
    compareHistory(entries, historyKey(entries[2]), historyKey(entries[0]))
      .error,
  );
  const mixed = structuredClone(entries);
  mixed[1].repository = "other/repo";
  assert.ok(
    compareHistory(mixed, historyKey(mixed[0]), historyKey(mixed[2])).error,
  );
});
test("marks missing comparisons and broken commit chains as incomplete", () => {
  const missing = structuredClone(entries);
  delete missing[1].changeReport;
  assert.equal(
    compareHistory(missing, historyKey(missing[0]), historyKey(missing[2]))
      .incomplete,
    true,
  );
  const broken = structuredClone(entries);
  broken[2].changeReport.from = a;
  assert.equal(
    compareHistory(broken, historyKey(broken[0]), historyKey(broken[2]))
      .incomplete,
    true,
  );
});
