export function projectSummary(p) {
  const tasks = p.tasks || [];
  const builds = tasks.filter((t) =>
    [
      "게임 제작 · Unity 컴파일",
      "Web 제작",
      "Roblox 제작",
      "랜딩페이지 제작",
    ].includes(t.title),
  );
  const build = builds.at(-1);
  const last = tasks.at(-1);
  const busy = p.status === "작업 중";
  const ready = !busy && build?.status === "완료" && !p.approved;
  return {
    progress: p.phase
      ? `${p.phase.agent} · ${p.phase.title}`
      : p.approved
        ? "최종 승인 완료"
        : build?.status === "오류"
          ? "제작 확인 필요"
          : ready
            ? "제작 완료 · 결과 확인 대기"
            : last
              ? `${last.title} · ${last.status}`
              : "목표 설정 완료 · 대화 대기",
    approval: p.approved
      ? "승인 완료"
      : ready
        ? "제작 결과 확인 후 최종 승인"
        : busy
          ? "작업 완료 후 확인"
          : build?.status === "오류"
            ? "오류 해결 후 재검증 필요"
            : "현재 승인 요청 없음",
    result: (
      (build?.status === "오류" ? build.output : last?.output) ||
      "아직 결과 보고서가 없습니다."
    )
      .replace(/\s+/g, " ")
      .slice(0, 220),
    completed: tasks.filter((t) => t.status === "완료").length,
    total: tasks.length,
    ready,
  };
}
