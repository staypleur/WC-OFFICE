import test from "node:test";
import assert from "node:assert/strict";
import { createPipeline, recoverPipeline } from "./pipeline.mjs";
import { workflow } from "./workflow.mjs";
const agents = ["Codex", "Codex", "Claude", "시스템", "Gemini"];
function fixture(overrides = {}) {
  const calls = [];
  const active = new Set();
  const p = {
    id: "p",
    type: "web",
    tasks: [],
    messages: [],
    activity: [],
    artifact: { type: "web", path: "test" },
  };
  const actions = Object.fromEntries(
    ["plan", "design", "build", "test", "review"].map((id) => [
      id,
      async () => {
        calls.push(id);
        return id;
      },
    ]),
  );
  const runner = createPipeline({
    active,
    persist: async () => {},
    actions: { ...actions, ...overrides },
  });
  return { p, calls, active, runner };
}
test("dependencies run in order and block approval until the final review", async () => {
  const { p, calls, runner, active } = fixture();
  const completion = runner.start(p, agents);
  assert.equal(workflow(p).ready, false);
  assert.throws(() => runner.start(p, agents));
  await completion;
  assert.deepEqual(calls, ["plan", "design", "build", "test", "review"]);
  assert.equal(p.pipeline.state, "review");
  assert.equal(active.size, 0);
  assert.equal(workflow(p).ready, true);
});
test("pause waits for an in-flight step and resume skips completed stages", async () => {
  let finish;
  const started = new Promise((resolve) => {
    finish = resolve;
  });
  const f = fixture({
    plan: async () => {
      await started;
      return "plan";
    },
  });
  const run = f.runner.start(f.p, agents);
  await Promise.resolve();
  await f.runner.pause(f.p);
  finish();
  await run;
  assert.equal(f.p.pipeline.state, "paused");
  assert.equal(workflow(f.p).ready, false);
  await f.runner.resume(f.p);
  assert.deepEqual(f.calls, ["design", "build", "test", "review"]);
  assert.equal(f.p.pipeline.steps[0].attempts, 1);
});
test("failed test blocks review; retry reruns only the failed step and its dependents", async () => {
  let tries = 0;
  const f = fixture({
    test: async () => {
      if (++tries === 1) throw Error("syntax");
      return "passed";
    },
  });
  await f.runner.start(f.p, agents);
  assert.equal(f.p.pipeline.state, "failed");
  assert.equal(workflow(f.p).ready, false);
  assert.equal(f.calls.includes("review"), false);
  await f.runner.resume(f.p);
  assert.equal(f.p.pipeline.state, "review");
  assert.equal(tries, 2);
  assert.equal(f.calls.filter((x) => x === "build").length, 1);
});
test("restart recovery retains completed stages and pauses interrupted work", () => {
  const p = {
    pipeline: {
      state: "running",
      steps: [{ state: "done" }, { state: "running" }, { state: "pending" }],
    },
  };
  recoverPipeline(p);
  assert.equal(p.pipeline.state, "paused");
  assert.deepEqual(
    p.pipeline.steps.map((s) => s.state),
    ["done", "pending", "pending"],
  );
});
