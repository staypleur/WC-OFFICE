import test from "node:test";
import assert from "node:assert/strict";
import { projectSummary } from "./project-summary.mjs";
test("held projects cannot be approved and keep their repository summary", () => {
  const result = projectSummary({
    onHold: true,
    tasks: [{ title: "Web 제작", status: "완료" }],
    repositoryReport: { summary: "코드 분석 결과" },
  });
  assert.equal(result.ready, false);
  assert.equal(result.progress, "보류 중");
  assert.equal(result.result, "코드 분석 결과");
});
test("successful chat cannot hide a failed build or request approval", () => {
  const s = projectSummary({
    tasks: [
      { title: "Web 제작", status: "오류" },
      { title: "기획 대화", status: "완료", output: "계획" },
    ],
  });
  assert.equal(s.ready, false);
  assert.match(s.approval, /재검증/);
});
test("approval requires a completed build and an idle project", () => {
  const p = { tasks: [{ title: "Web 제작", status: "완료" }] };
  assert.equal(projectSummary(p).ready, true);
  assert.equal(projectSummary({ ...p, status: "작업 중" }).ready, false);
  assert.equal(projectSummary({ ...p, approved: true }).ready, false);
});
