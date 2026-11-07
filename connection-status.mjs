import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
let cachedLogin;
let checkedAt = 0;
let pending;
export async function codexLoginStatus() {
  if (Date.now() - checkedAt < 20000) return cachedLogin;
  if (pending) return pending;
  pending = (async () => {
    try {
      const { stdout, stderr } = await execute(
        process.env.CODEX_BIN || "codex",
        ["login", "status"],
        { windowsHide: true, timeout: 5000, maxBuffer: 16000 },
      );
      cachedLogin = /logged in/i.test(stdout + stderr);
    } catch {
      cachedLogin = false;
    }
    checkedAt = Date.now();
    pending = null;
    return cachedLogin;
  })();
  return pending;
}
export function connectionState(id, status) {
  if (["midjourney", "copilot", "tripo"].includes(id)) return "manual";
  if (["응답 확인됨", "로그인 확인됨"].includes(status)) return "connected";
  return "disconnected";
}

const checks = {
  claude: [
    "ANTHROPIC_API_KEY",
    "https://api.anthropic.com/v1/models?limit=1",
    (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  ],
  gemini: [
    "GEMINI_API_KEY",
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    (key) => ({ "x-goog-api-key": key }),
  ],
  v0: ["V0_API_KEY", "https://api.v0.dev/v1/user"],
  notion: [
    "NOTION_TOKEN",
    "https://api.notion.com/v1/users/me",
    (key) => ({
      Authorization: "Bearer " + key,
      "Notion-Version": "2022-06-28",
    }),
  ],
  cursor: [
    "CURSOR_API_KEY",
    "https://api.cursor.com/v0/me",
    (key) => ({
      Authorization: "Basic " + Buffer.from(key + ":").toString("base64"),
    }),
  ],
  stability: ["STABILITY_API_KEY", "https://api.stability.ai/v1/user/balance"],
  meshy: ["MESHY_API_KEY", "https://api.meshy.ai/openapi/v1/balance"],
};
export function createConnectionMonitor({
  env = process.env,
  fetcher = fetch,
  login = codexLoginStatus,
  now = Date.now,
  ttl = 25000,
} = {}) {
  let cached,
    expires = 0,
    inFlight;
  async function check() {
    const results = await Promise.all(
      Object.entries(checks).map(async ([id, [keyName, url, headers]]) => {
        const key = env[keyName];
        if (!key) return [id, "disconnected", "연결 필요"];
        try {
          const response = await fetcher(url, {
            headers: headers
              ? headers(key)
              : { Authorization: "Bearer " + key },
            signal: AbortSignal.timeout(8000),
            redirect: "error",
          });
          await response.body?.cancel();
          return response.ok
            ? [id, "connected", "응답 확인됨"]
            : [
                id,
                "disconnected",
                response.status === 401 || response.status === 403
                  ? "인증 확인 필요"
                  : "연결 오류 · " + response.status,
              ];
        } catch {
          return [id, "disconnected", "연결 실패 · 재확인 예정"];
        }
      }),
    );
    let local = false;
    try {
      local = await login();
    } catch {}
    results.push([
      "codex",
      local ? "connected" : "disconnected",
      local ? "로그인 확인됨" : "로그인 필요",
    ]);
    results.push([
      "perplexity",
      env.PERPLEXITY_API_KEY ? "manual" : "disconnected",
      env.PERPLEXITY_API_KEY ? "자동 상태 확인 미지원" : "연결 필요",
    ]);
    for (const id of ["midjourney", "copilot", "tripo"])
      results.push([
        id,
        "manual",
        id === "tripo" ? "자동 연결 미지원" : "수동 사용",
      ]);
    return {
      checkedAt: new Date(now()).toISOString(),
      connections: Object.fromEntries(
        results.map(([id, , label]) => [id, label]),
      ),
      connectionStates: Object.fromEntries(
        results.map(([id, state]) => [id, state]),
      ),
    };
  }
  return {
    invalidate() {
      expires = 0;
    },
    async snapshot() {
      if (cached && now() < expires) return cached;
      if (inFlight) return inFlight;
      inFlight = check()
        .then((result) => {
          cached = result;
          expires = now() + ttl;
          return result;
        })
        .finally(() => (inFlight = null));
      return inFlight;
    },
  };
}
