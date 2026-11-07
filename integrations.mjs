import { execFile } from "node:child_process";
import { promisify } from "node:util";
export const exec = promisify(execFile);

export const settingsFields = [
  "ANTHROPIC_API_KEY",
  "V0_API_KEY",
  "GEMINI_API_KEY",
  "PERPLEXITY_API_KEY",
  "CURSOR_API_KEY",
  "NOTION_TOKEN",
  "NOTION_PARENT_PAGE_ID",
  "STABILITY_API_KEY",
  "MESHY_API_KEY",
];
export async function api(url, key, body, headers = {}) {
  if (!key) throw new Error("연결 설정에서 API 키를 입력해주세요.");
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok)
    throw new Error(
      `서비스 요청 실패 (${response.status}). 키·권한·잔액을 확인해주세요.`,
    );
  return response.json();
}
export async function syncNotion(project) {
  const text = `${project.goal}\n\n${project.tasks.map((t) => `${t.title}\n${t.output || t.status}`).join("\n\n")}`;
  const children = [];
  for (let i = 0; i < Math.min(text.length, 150000); i += 1800)
    children.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          { type: "text", text: { content: text.slice(i, i + 1800) } },
        ],
      },
    });
  const headers = { "Notion-Version": "2022-06-28" };
  const result = await api(
    "https://api.notion.com/v1/pages",
    process.env.NOTION_TOKEN,
    {
      parent: { page_id: process.env.NOTION_PARENT_PAGE_ID },
      properties: {
        title: {
          type: "title",
          title: [
            {
              type: "text",
              text: { content: project.name || project.goal.slice(0, 80) },
            },
          ],
        },
      },
      children,
    },
    headers,
  );
  return { id: result.id, url: result.url };
}
export async function launchCursor(project, prompt) {
  if (
    !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(
      project.repository || "",
    )
  )
    throw new Error("프로젝트 설정에 GitHub 저장소 URL이 필요합니다.");
  return api("https://api.cursor.com/v1/agents", process.env.CURSOR_API_KEY, {
    prompt: { text: prompt },
    repos: [{ url: project.repository }],
    autoCreatePR: true,
    workOnCurrentBranch: false,
  });
}
export async function cursorStatus(job) {
  return api(
    `https://api.cursor.com/v1/agents/${encodeURIComponent(job.agent.id)}/runs/${encodeURIComponent(job.run.id)}`,
    process.env.CURSOR_API_KEY,
  );
}
export async function generateImage(prompt) {
  if (!process.env.STABILITY_API_KEY)
    throw new Error("Stable Diffusion API 키가 필요합니다.");
  const form = new FormData();
  form.set("prompt", prompt);
  form.set("model", "sd3.5-large");
  form.set("output_format", "png");
  const response = await fetch(
    "https://api.stability.ai/v2beta/stable-image/generate/sd3",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
        Accept: "image/*",
      },
      body: form,
      signal: AbortSignal.timeout(180000),
    },
  );
  if (!response.ok) throw new Error(`이미지 생성 실패 (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}
export const createMesh = (prompt) =>
  api("https://api.meshy.ai/openapi/v2/text-to-3d", process.env.MESHY_API_KEY, {
    mode: "preview",
    prompt,
  });
export const meshStatus = (id) =>
  api(
    `https://api.meshy.ai/openapi/v2/text-to-3d/${encodeURIComponent(id)}`,
    process.env.MESHY_API_KEY,
  );
export async function copilotReview(prompt) {
  const result = await exec(
    process.env.COPILOT_BIN || "copilot",
    ["-p", prompt, "-s", "--deny-tool", "*", "--no-ask-user"],
    { windowsHide: true, timeout: 180000, maxBuffer: 2000000 },
  );
  if (!result.stdout.trim())
    throw new Error(
      "Copilot 응답이 없습니다. CLI 설치와 로그인을 확인해주세요.",
    );
  return result.stdout;
}
