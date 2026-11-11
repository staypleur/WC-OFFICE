import { randomUUID } from "node:crypto";
export const unfinishedPipeline = (p) =>
  ["running", "paused", "failed"].includes(p.pipeline?.state);
export function recoverPipeline(p) {
  if (p.pipeline?.state !== "running") return;
  p.pipeline.state = "paused";
  p.pipeline.pauseRequested = false;
  for (const step of p.pipeline.steps)
    if (step.state === "running") {
      step.state = "pending";
      step.error =
        "서버 재시작으로 중단됨 · 재개 시 이 단계부터 다시 실행합니다.";
    }
}
export function createPipeline({ active, persist, actions }) {
  function event(p, text, from = "시스템") {
    (p.activity ||= []).push({
      id: randomUUID(),
      at: new Date().toISOString(),
      from,
      kind: "handoff",
      text,
    });
  }
  async function run(p) {
    const flow = p.pipeline;
    try {
      await persist();
      for (const step of flow.steps) {
        if (step.state === "done") continue;
        if (flow.pauseRequested) {
          flow.state = "paused";
          p.status = "자동 작업 일시정지";
          break;
        }
        if (
          step.dependsOn.some(
            (id) => flow.steps.find((s) => s.id === id)?.state !== "done",
          )
        )
          throw new Error("선행 작업이 완료되지 않았습니다.");
        step.state = "running";
        step.error = "";
        step.attempts = (step.attempts || 0) + 1;
        p.phase = { agent: step.agent, title: step.title };
        p.status = "작업 중";
        const task = {
          id: randomUUID(),
          title: step.title,
          agent: step.agent,
          status: "진행 중",
          startedAt: new Date().toISOString(),
          pipelineId: flow.id,
        };
        (p.tasks ||= []).push(task);
        step.taskId = task.id;
        event(p, `${step.title} 시작 · 선행 결과를 전달했습니다.`, step.agent);
        try {
          await persist();
          task.output = String(await actions[step.id](p, step));
          step.state = "done";
          task.status = "완료";
          step.output = task.output;
          (p.messages ||= []).push({ role: step.agent, text: task.output });
          event(p, `${step.title} 완료`, step.agent);
        } catch (error) {
          step.state = "failed";
          step.error = error.message;
          task.status = "오류";
          task.output = error.message;
          flow.state = "failed";
          p.status = "확인 필요";
          event(p, `${step.title} 실패: ${error.message}`);
        } finally {
          task.finishedAt = new Date().toISOString();
          await persist();
        }
        if (flow.state === "failed") break;
      }
      if (flow.steps.every((s) => s.state === "done")) {
        flow.state = "review";
        p.status = "승인 대기";
        const build = p.tasks.find(
          (t) => t.id === flow.steps.find((s) => s.id === "build").taskId,
        );
        build.validation = flow.validation;
        build.artifact = { ...p.artifact };
        event(
          p,
          "모든 자동 작업이 완료됐습니다. 우찬님의 최종 승인을 기다립니다.",
        );
      }
    } catch (error) {
      flow.state = "failed";
      flow.error = error.message;
      p.status = "확인 필요";
    } finally {
      p.phase = null;
      active.delete(p.id);
      await persist();
    }
  }
  function launch(p) {
    if (active.has(p.id) || p.onHold)
      throw new Error("현재 작업을 마치거나 보류를 해제해주세요.");
    active.add(p.id);
    p.pipeline.state = "running";
    p.pipeline.pauseRequested = false;
    p.approved = false;
    p.status = "작업 중";
    const completion = run(p);
    completion.catch((e) => console.error("자동 작업 저장 실패", e.message));
    return completion;
  }
  return {
    start(p, agents) {
      if (active.has(p.id) || unfinishedPipeline(p) || p.onHold)
        throw new Error("진행 중인 자동 작업을 재개하거나 완료해주세요.");
      const titles = [
        "목표 분석 · 작업 분배",
        "UI·구현 설계",
        p.type === "unity"
          ? "게임 제작 · Unity 컴파일"
          : p.type === "roblox"
            ? "Roblox 제작"
            : "Web 제작",
        "자동 검증",
        "결과 검토",
      ];
      p.pipeline = {
        id: randomUUID(),
        state: "paused",
        createdAt: new Date().toISOString(),
        steps: ["plan", "design", "build", "test", "review"].map(
          (id, i, all) => ({
            id,
            title: titles[i],
            agent: agents[i],
            dependsOn: i ? [all[i - 1]] : [],
            state: "pending",
          }),
        ),
      };
      return launch(p);
    },
    async pause(p) {
      if (p.pipeline?.state !== "running")
        throw new Error("실행 중인 자동 작업이 없습니다.");
      p.pipeline.pauseRequested = true;
      event(p, "일시정지 요청 · 현재 요청 완료 후 다음 단계부터 멈춥니다.");
      await persist();
    },
    resume(p) {
      if (!["paused", "failed"].includes(p.pipeline?.state))
        throw new Error("재개할 작업이 없습니다.");
      return launch(p);
    },
  };
}
