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
