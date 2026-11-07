import test from "node:test";
import assert from "node:assert/strict";
import { createMarketing } from "./marketing.mjs";
import { cpuUsage, systemSnapshot } from "./system-monitor.mjs";
test("CPU counters produce bounded percentage and handle missing sample", () => {
  assert.equal(
    cpuUsage({ idle: 100, total: 200 }, { idle: 150, total: 400 }),
    75,
  );
  assert.equal(
    cpuUsage({ idle: 100, total: 200 }, { idle: 100, total: 200 }),
    null,
  );
  const snapshot = systemSnapshot();
  assert(snapshot.memory.total > 0);
  assert(snapshot.memory.percent >= 0 && snapshot.memory.percent <= 100);
});
test("marketing persists separately without altering development state and blocks duplicate work", async () => {
  const p = {
    id: "test",
    name: "Project",
    goal: "Goal",
    messages: [{ role: "우찬", text: "dev-only" }],
    approved: true,
    status: "대화 준비",
  };
  const before = JSON.stringify(p),
    conversations = {};
  let done, prompt;
  const marketing = createMarketing({
    projects: [p],
    conversations,
    persist: async () => {},
    runProvider: async (_provider, p) => {
      prompt = p;
      return new Promise((resolve) => (done = resolve));
    },
  });
  const result = await marketing.send("test", "marketing-only");
  assert.equal(marketing.snapshot("test").busy, true);
  await assert.rejects(marketing.send("test", "duplicate"), /작성 중/);
  assert(!prompt.includes("dev-only"));
  assert(prompt.includes("marketing-only"));
  done("marketing answer");
  await result.completion;
  assert.equal(JSON.stringify(p), before);
  assert.equal(marketing.snapshot("test").messages.length, 2);
  assert.equal(marketing.snapshot("test").busy, false);
  const reopened = createMarketing({
    projects: [p],
    conversations: JSON.parse(JSON.stringify(conversations)),
    persist: async () => {},
    runProvider: async () => "",
  });
  assert.equal(reopened.snapshot("test").messages[1].text, "marketing answer");
});

test("connection colors require verified responses or a confirmed login", async () => {
  const { connectionState } = await import("./connection-status.mjs");
  assert.equal(connectionState("codex", "로그인 확인됨"), "connected");
  assert.equal(
    connectionState("claude", "키 설정됨 · 연결 확인 필요"),
    "disconnected",
  );
  assert.equal(connectionState("claude", "응답 확인됨"), "connected");
  assert.equal(connectionState("midjourney", "수동 사용"), "manual");
  assert.equal(connectionState("tripo", "자동 연결 미지원"), "manual");
});

test("automatic connection checks transition through success, failure and recovery without generation", async () => {
  const { createConnectionMonitor } = await import("./connection-status.mjs");
  let ok = true,
    calls = 0,
    time = 1000;
  const env = { ANTHROPIC_API_KEY: "fake-key" };
  const monitor = createConnectionMonitor({
    env,
    now: () => time,
    ttl: 100,
    login: async () => ok,
    fetcher: async (url, options) => {
      calls++;
      assert(url.includes("/models"));
      assert.equal(options.method, undefined);
      return { ok, status: ok ? 200 : 401 };
    },
  });
  const [a, b] = await Promise.all([monitor.snapshot(), monitor.snapshot()]);
  assert.equal(calls, 1);
  assert.equal(a.connectionStates.claude, "connected");
  assert.equal(b.connectionStates.midjourney, "manual");
  ok = false;
  time += 101;
  assert.equal(
    (await monitor.snapshot()).connectionStates.claude,
    "disconnected",
  );
  ok = true;
  time += 101;
  assert.equal((await monitor.snapshot()).connectionStates.claude, "connected");
  env.ANTHROPIC_API_KEY = "";
  monitor.invalidate();
  assert.equal(
    (await monitor.snapshot()).connectionStates.claude,
    "disconnected",
  );
});
test("process ranking uses interval CPU time and sorts memory independently", async () => {
  const { rankProcesses } = await import("./system-monitor.mjs");
  const previous = new Map([
    [1, { id: 1, name: "A", cpu: 10 }],
    [2, { id: 2, name: "B", cpu: 4 }],
  ]);
  const rows = [
    { id: 1, name: "A", cpu: 14, memory: 100 },
    { id: 2, name: "B", cpu: 5, memory: 300 },
    { id: 3, name: "C", cpu: 100, memory: 10 },
  ];
  const ranked = rankProcesses(rows, previous, 2, 4);
  assert.equal(ranked.cpu[0].name, "A");
  assert.equal(ranked.cpu[0].cpu, 50);
  assert.equal(ranked.memory[0].name, "B");
  assert.equal(ranked.cpu.length, 2);
});
