import test from "node:test";
import assert from "node:assert/strict";
import { workflow, validateDecision } from "./workflow.mjs";
const build = { id: "b1", title: "Web 제작", status: "완료" };
test("approval binds to the reviewed result and requires explicit review", () => {
  const p = { tasks: [build] };
  assert.equal(workflow(p).stage, 3);
  assert.equal(validateDecision(p, "b1", true), build);
  assert.throws(() => validateDecision(p, "old", true));
  assert.throws(() => validateDecision(p, "b1", false));
  for (const patch of [
    { onHold: true },
    { status: "작업 중" },
    { approved: true },
    { revisionRequest: { taskId: "b1" } },
  ]) {
    assert.throws(() => validateDecision({ ...p, ...patch }, "b1", true));
  }
});
test("a newer failed build blocks old approval; a new successful build resolves revision", () => {
  assert.equal(
    workflow({ tasks: [build, { ...build, id: "b2", status: "오류" }] }).ready,
    false,
  );
  const p = {
    tasks: [build, { ...build, id: "b2" }],
    revisionRequest: { taskId: "b1" },
  };
  assert.equal(workflow(p).ready, true);
  assert.equal(workflow(p).previous, build);
});
test("imported repositories do not pretend to have passed development or validation", () => {
  assert.equal(workflow({ repositoryImported: true, tasks: [] }).stage, 0);
  assert.equal(
    workflow({ tasks: [], phase: { title: "컴파일 검증" }, status: "작업 중" })
      .stage,
    2,
  );
});
