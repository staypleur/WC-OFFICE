export const buildTitles = [
  "게임 제작 · Unity 컴파일",
  "Web 제작",
  "Roblox 제작",
  "랜딩페이지 제작",
];
export function workflow(p) {
  const tasks = p.tasks || [];
  const builds = tasks.filter((t) => buildTitles.includes(t.title));
  const build = builds.at(-1);
  const busy = p.status === "작업 중";
  const pipelinePending = ["running", "paused", "failed"].includes(
    p.pipeline?.state,
  );
  const revision =
    p.revisionRequest?.taskId === build?.id && !!p.revisionRequest;
  const ready =
    !!build &&
    build.status === "완료" &&
    !busy &&
    !pipelinePending &&
    !p.onHold &&
    !p.approved &&
    !revision;
  const phase = p.phase?.title || "";
  const stage = p.approved
    ? 4
    : pipelinePending
      ? ({ plan: 0, design: 0, build: 1, test: 2, review: 2 }[
          p.pipeline.steps.find((s) => s.state !== "done")?.id
        ] ?? 3)
      : busy
        ? /검토|검증|컴파일/.test(phase)
          ? 2
          : /코드|저장|제작/.test(phase)
            ? 1
            : 0
        : build?.status === "완료"
          ? 3
          : build
            ? 1
            : 0;
  const blocker = p.onHold
    ? "보류 중 · 보류를 해제하면 작업을 이어갈 수 있습니다."
    : p.pipeline?.state === "paused"
      ? "자동 작업 일시정지 · 재개하면 다음 미완료 단계부터 이어갑니다."
      : p.pipeline?.state === "failed"
        ? p.pipeline.steps.find((s) => s.state === "failed")?.error ||
          p.pipeline.error ||
          "자동 작업 확인 필요"
        : revision
          ? "수정 요청됨 · 요청 내용을 반영해 다시 제작해주세요."
          : build?.status === "오류"
            ? build.output || "제작 중 오류가 발생했습니다."
            : "";
  return {
    build,
    previous: builds
      .slice(0, -1)
      .reverse()
      .find((t) => t.status === "완료"),
    ready,
    stage,
    blocker,
    current: p.phase
      ? `${p.phase.agent} · ${phase}`
      : p.approved
        ? "최종 승인 완료"
        : ready
          ? "결과 검토 및 승인 대기"
          : blocker
            ? "확인 필요"
            : "다음 작업 대기",
  };
}
export function validateDecision(p, taskId, reviewed = true) {
  const state = workflow(p);
  if (!state.ready || !taskId || state.build.id !== taskId)
    throw new Error(
      "결과가 변경되었거나 승인할 수 없는 상태입니다. 최신 결과를 다시 확인해주세요.",
    );
  if (!reviewed) throw new Error("결과와 미검증 항목을 확인해주세요.");
  return state.build;
}
