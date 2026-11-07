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
