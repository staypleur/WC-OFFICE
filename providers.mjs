import { spawn } from "node:child_process";

export const roles = [
  {
    id: "claude",
    name: "Claude",
    role: "개발 · 코드 수정",
    key: "ANTHROPIC_API_KEY",
  },
  { id: "v0", name: "v0", role: "UI 디자인 · 화면 초안", key: "V0_API_KEY" },
  { id: "codex", name: "Codex", role: "기획 · 요구사항 · 일정" },
  {
    id: "gemini",
    name: "Gemini",
    role: "별도 품질 검토",
    key: "GEMINI_API_KEY",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    role: "출처 기반 조사",
    key: "PERPLEXITY_API_KEY",
  },
];

export function codex(prompt, timeout = 300000, options = {}) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/(API_KEY|TOKEN|SECRET|PASSWORD)$/i.test(key),
      ),
    );
    const child = spawn(
      process.env.CODEX_BIN || "codex",
      [
        "exec",
        "--ignore-user-config",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--json",
        "-",
      ],
      { windowsHide: true, shell: false, env, cwd: options.cwd },
    );
    let output = "";
    let exceeded = false;
    const timer = setTimeout(() => {
      exceeded = true;
      child.kill();
    }, timeout);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 2000000) {
        exceeded = true;
        child.kill();
      }
    });
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timer);
      reject(
        new Error(
          "Codex 실행 파일을 찾을 수 없습니다. CODEX_BIN을 확인해주세요.",
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (exceeded || code !== 0)
        return reject(
          new Error(
            exceeded
              ? "Codex 실행 제한을 초과했습니다."
              : "Codex 실행 실패. 로그인과 사용 한도를 확인해주세요.",
          ),
        );
      const messages = output.split("\n").flatMap((line) => {
        try {
          const event = JSON.parse(line);
          return event.type === "item.completed" &&
            event.item?.type === "agent_message"
            ? [event.item.text]
            : [];
        } catch {
          return [];
        }
      });
      if (!messages.length)
        return reject(new Error("Codex 결과가 비어 있습니다."));
      resolve(messages.join("\n"));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

async function request(url, headers, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok)
    throw new Error(
      `AI 요청 실패 (${response.status}). 키·잔액·모델 접근 권한을 확인해주세요.`,
    );
  return response.json();
}

export async function runProvider(id, prompt) {
  if (id === "codex") return codex(prompt);
  const role = roles.find((role) => role.id === id);
  if (!role) throw new Error("지원하지 않는 AI입니다.");
  const key = process.env[role.key];
  if (!key) throw new Error(`${role.name} API 키가 필요합니다 (${role.key}).`);
  let text;
  if (id === "claude") {
    const data = await request(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": key, "anthropic-version": "2023-06-01" },
      {
        model: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
        max_tokens: 6000,
        messages: [{ role: "user", content: prompt }],
      },
    );
    text = data.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  } else if (id === "v0") {
    const data = await request(
      "https://api.v0.dev/v1/chats",
      { Authorization: `Bearer ${key}` },
      { message: prompt, chatPrivacy: "private", responseMode: "sync" },
    );
    text = JSON.stringify({
      text: data.text,
      files: data.latestVersion?.files || data.files,
      messages: data.messages?.filter(
        (message) => message.role === "assistant",
      ),
    });
  } else if (id === "gemini") {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-pro";
    const data = await request(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { "x-goog-api-key": key },
      { contents: [{ parts: [{ text: prompt }] }] },
    );
    text = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n");
  } else {
    const data = await request(
      "https://api.perplexity.ai/chat/completions",
      { Authorization: `Bearer ${key}` },
      { model: "sonar", messages: [{ role: "user", content: prompt }] },
    );
    text =
      data.choices?.[0]?.message?.content +
      "\n" +
      (data.citations || []).join("\n");
  }
  if (!text || text === "{}") throw new Error("AI 결과가 비어 있습니다.");
  return text.slice(0, 150000);
}
