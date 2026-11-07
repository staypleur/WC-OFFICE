import http from "node:http";
import path from "node:path";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { roles, runProvider } from "./providers.mjs";
import { createRepositorySync, SYNC_INTERVAL } from "./repository-sync.mjs";
import {
  settingsFields,
  api,
  syncNotion,
  launchCursor,
  cursorStatus,
  generateImage,
  createMesh,
  meshStatus,
  copilotReview,
} from "./integrations.mjs";
import {
  findUnity,
  chooseFolder,
  projectFolder,
  parseUnityFiles,
  writeUnity,
  compileUnity,
  openUnity,
} from "./unity.mjs";
try {
  process.loadEnvFile(".env");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await mkdir("data", { recursive: true });
async function load(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
const settings = await load("data/settings.json", {});
Object.assign(process.env, settings);
const projects = await load("data/projects.json", []);
const active = new Set();
const verified = new Set();
const subscribers = new Map();
let writes = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(projects, null, 2);
  writes = writes
    .catch(() => {})
    .then(async () => {
      await writeFile("data/projects.tmp", snapshot);
      await rename("data/projects.tmp", "data/projects.json");
      for (const project of JSON.parse(snapshot)) {
        for (const response of subscribers.get(project.id) || []) {
          if (response.destroyed) continue;
          if (response.writableLength > 2 * 1024 * 1024) {
            response.destroy();
            continue;
          }
          response.write(
            `event: project\ndata: ${JSON.stringify(project)}\n\n`,
          );
        }
      }
    });
  return writes;
}
for (const p of projects) {
  if (p.type === "landing" || !p.type) p.type = "web";
  p.messages ||= [];
  p.events ||= [];
  p.tasks ||= [];
  p.activity ||= [];
  p.pendingInstructions ||= [];
  for (const record of [...p.messages, ...p.tasks]) {
    const key = record.role ? "text" : "output";
    if (
      record[key]?.startsWith("Unity 컴파일 실패") &&
      /entitlement|Access token is unavailable/i.test(record[key])
    )
      record[key] =
        "Unity 라이선스 활성화 필요. Unity Hub에서 활성화한 뒤 저장한 코드를 재컴파일하세요.";
  }
  if (p.status === "작업 중") {
    p.status = "중단됨";
    for (const t of p.tasks) if (t.status === "진행 중") t.status = "중단됨";
    p.phase = null;
    p.activity.push({
      id: randomUUID(),
      at: new Date().toISOString(),
      from: "시스템",
      kind: "interrupted",
      text: "서버가 다시 시작되어 작업이 중단됐습니다. 작업 기록을 확인하고 다시 요청해주세요.",
    });
  }
}
await save();
function requireText(value, max = 4000) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("필수 입력과 길이를 확인해주세요.");
  return value.trim();
}
function context(p) {
  return `프로젝트: ${p.name || p.goal}\n유형: ${p.type || "web"}\n목표: ${p.goal}\nGitHub 분석(실행 검증과 구분): ${p.repositoryReport ? JSON.stringify(p.repositoryReport) : "미확인"}\n기획 인수인계:\n${p.brief || ""}\n대화:\n${p.messages
    .filter((m) => m.role !== "시스템")
    .slice(-12)
    .map((m) => m.role + ": " + m.text)
    .join("\n")
    .slice(-40000)}`;
}
function job(p, title, provider, work) {
  if (p.onHold) throw new Error("보류를 해제한 뒤 작업을 요청해주세요.");
  if (active.has(p.id)) throw new Error("현재 작업이 끝난 뒤 요청해주세요.");
  active.add(p.id);
  p.status = "작업 중";
  p.phase = { agent: provider, title };
  p.activity ||= [];
  p.activity.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    from: provider,
    kind: "started",
    text: `${title} 시작`,
  });
  const task = { id: randomUUID(), title, agent: provider, status: "진행 중" };
  p.tasks.push(task);
  const promise = (async () => {
    try {
      await save();
      task.output = await work();
      task.status = "완료";
      p.messages.push({ role: provider, text: task.output });
      p.status = "대화 가능";
      p.activity.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        from: provider,
        kind: "completed",
        text: `${title} 완료`,
        detail: task.output,
      });
    } catch (e) {
      task.status = "오류";
      task.output = e.message;
      p.status = "확인 필요";
      p.messages.push({ role: "시스템", text: e.message });
      p.activity.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        from: "시스템",
        kind: "error",
        text: e.message,
      });
    } finally {
      p.events.push(`${title} · ${task.status}`);
      p.phase = null;
      if (p.folder)
        try {
          await writeFile(
            path.join(p.folder, "office-project.json"),
            JSON.stringify(p, null, 2),
          );
        } catch {
          p.events.push("프로젝트 폴더 기록 실패. 서버에는 기록이 보관됩니다.");
        }
      p.phase = null;
      await save();
      active.delete(p.id);
      if (p.pendingInstructions?.length) {
        const pending = p.pendingInstructions.splice(0);
        job(p, "추가 지시 검토", "Codex", async () => {
          await teamEvent(
            p,
            "Codex",
            "팀 전체",
            "작업 중 받은 추가 지시를 검토합니다.",
            pending.join("\n"),
          );
          return runProvider(
            "codex",
            "추가 지시를 반영해 다음 작업 계획을 간결하게 답하라. 이미 생성한 파일이 수정됐다고 주장하지 마라. 코드 반영은 사용자가 제작 버튼을 눌러야 한다고 안내하라. 도구 실행 금지.\n" +
              context(p),
          );
        });
      }
    }
  })();
  promise.catch((error) => console.error("작업 저장 실패", error.message));
}
async function teamEvent(p, from, to, text, detail = "") {
  p.activity.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    from,
    to,
    kind: "handoff",
    text,
    detail,
  });
  await save();
}
async function teamBuild(p, work) {
  const developer = p.developer === "codex" ? "Codex" : "Claude";
  p.phase = { agent: "Codex", title: "구현 계획 작성" };
  await teamEvent(
    p,
    "시스템",
    "Codex",
    "목표와 대화를 전달했습니다. 구현 계획을 작성합니다.",
  );
  p.brief = await runProvider(
    "codex",
    "총괄 기획자로서 개발 담당에게 전달할 구현 계획을 한국어로 작성하라. 기능 목록, 작업 순서, 파일 구성, 완료 기준을 포함. 도구 실행 금지.\n" +
      context(p),
  );
  p.phase = { agent: developer, title: "코드 작성 · 결과 저장" };
  await teamEvent(p, "Codex", developer, "구현 계획을 전달했습니다.", p.brief);
  const result = await work();
  if (process.env.GEMINI_API_KEY) {
    p.phase = { agent: "Gemini", title: "결과 검토" };
    await teamEvent(
      p,
      developer,
      "Gemini",
      "기획과 작업 결과를 전달해 검토를 요청했습니다.",
      result,
    );
    const review = await runProvider(
      "gemini",
      "제공된 기획과 작업 결과를 검토하고 확인된 내용과 미검증 항목을 구분해 한국어로 보고하라. 실행 테스트를 했다고 주장하지 마라.\n" +
        context(p) +
        "\n작업 결과:\n" +
        result.slice(-90000),
    );
    await teamEvent(p, "Gemini", "우찬", "검토 보고서를 전달했습니다.", review);
  } else {
    await teamEvent(
      p,
      "시스템",
      "우찬",
      "Gemini API 키가 없어 별도 검토를 건너뛰었습니다. 결과를 직접 확인해주세요.",
    );
  }
  return result;
}
async function makeGame(p) {
  if (!p.folder) throw new Error("새 프로젝트에서 작업 폴더를 선택해주세요.");
  const prompt = `Unity 6000.6의 실행 가능한 소규모 게임을 만들어라. 외부 패키지·에셋 없이 기본 도형과 OnGUI만 사용. legacy Input API 사용. 빈 씬에서 Play만 눌러도 실행되도록 RuntimeInitializeOnLoadMethod로 카메라·오브젝트와 게임 로직을 구성하라. 이동, 목표, 승패, 재시작 포함. 도구 실행 금지. JSON만 출력: {"files":[{"path":"Assets/Scripts/GameBootstrap.cs","content":"전체 C# 코드"}]}. Scripts 바로 아래 영문 파일명의 C# 파일만 허용.\n${context(p)}`;
  const files = parseUnityFiles(
    await runProvider(p.developer || "claude", prompt),
  );
  const folder = path.join(
    p.folder,
    `Unity-${Date.now()}-${randomUUID().slice(0, 6)}`,
  );
  await mkdir(folder);
  await writeUnity(folder, files);
  p.unityFolder = folder;
  p.approved = false;
  p.phase = { agent: "Unity", title: "컴파일 검증" };
  await teamEvent(
    p,
    p.developer || "claude",
    "Unity",
    "생성한 C# 파일을 저장하고 컴파일을 시작합니다.",
    folder,
  );
  return `${files.length}개 C# 파일 저장\n${folder}\n${await compileUnity(folder)}`;
}
function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
const server = http.createServer(async (req, res) => {
  try {
    if (!["127.0.0.1:4310", "localhost:4310"].includes(req.headers.host))
      return send(res, 403, { error: "허용되지 않은 주소입니다." });
    const streamMatch = /^\/api\/projects\/([a-f0-9-]+)\/events$/.exec(req.url);
    if (req.method === "GET" && streamMatch) {
      const p = projects.find((project) => project.id === streamMatch[1]);
      if (!p || p.deletedAt)
        return send(res, 404, { error: "프로젝트를 찾지 못했습니다." });
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`event: project\ndata: ${JSON.stringify(p)}\n\n`);
      const clients = subscribers.get(p.id) || new Set();
      subscribers.set(p.id, clients);
      clients.add(res);
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
      res.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(res);
        if (!clients.size) subscribers.delete(p.id);
      });
      return;
    }
    if (
      req.method === "GET" &&
      /^\/assets\/ai\/[a-z0-9-]+\.svg$/.test(req.url)
    ) {
      const svg = await readFile("." + req.url);
      res.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      });
      return res.end(svg);
    }
    const projectPage =
      /^\/projects\/[a-f0-9-]+$/.test(req.url) ||
      [
        "/new",
        "/projects",
        "/projects/active",
        "/projects/held",
        "/projects/deleted",
        "/team",
        "/settings",
        "/marketing",
      ].includes(req.url);
    if (
      req.method === "GET" &&
      (projectPage ||
        [
          "/",
          "/app.js",
          "/motion.js",
          "/design.css",
          "/project-summary.mjs",
        ].includes(req.url))
    ) {
      res.writeHead(200, {
        "Content-Type":
          req.url === "/design.css"
            ? "text/css; charset=utf-8"
            : req.url === "/" || projectPage
              ? "text/html; charset=utf-8"
              : "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return res.end(
        await readFile(
          req.url === "/" || projectPage ? "index.html" : req.url.slice(1),
        ),
      );
    }
    if (req.method === "GET" && req.url === "/api/projects")
      return send(
        res,
        200,
        projects.filter((p) => !p.deletedAt),
      );
    if (req.method === "GET" && req.url === "/api/projects/deleted")
      return send(
        res,
        200,
        projects
          .filter((p) => p.deletedAt)
          .map((p) => ({ id: p.id, name: p.name, deletedAt: p.deletedAt })),
      );
    if (req.method === "GET" && req.url === "/api/config")
      return send(res, 200, {
        defaultFolder: process.cwd(),
        unity: await findUnity(),
        settings: settingsFields.map((key) => ({
          key,
          configured: !!process.env[key],
        })),
        connections: Object.fromEntries(
          [
            ...roles,
            { id: "cursor", key: "CURSOR_API_KEY" },
            { id: "notion", key: "NOTION_TOKEN" },
            { id: "stability", key: "STABILITY_API_KEY" },
            { id: "meshy", key: "MESHY_API_KEY" },
          ].map((r) => [
            r.id,
            verified.has(r.id)
              ? "응답 확인됨"
              : r.key && process.env[r.key]
                ? "키 설정됨"
                : r.id === "codex"
                  ? "로컬 로그인 사용"
                  : "연결 필요",
          ]),
        ),
      });
    if (
      req.method !== "POST" ||
      req.headers.origin !== `http://${req.headers.host}`
    )
      return send(res, 403, { error: "허용되지 않은 요청입니다." });
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 64000)
        return send(res, 413, { error: "입력이 너무 깁니다." });
    }
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object")
      throw new Error("잘못된 입력입니다.");
    if (req.url === "/api/folder")
      return send(res, 200, { folder: await chooseFolder() });
    if (req.url === "/api/settings") {
      if (active.size)
        throw new Error("진행 중인 작업이 끝난 뒤 설정을 변경해주세요.");
      for (const [key, value] of Object.entries(body))
        if (
          !settingsFields.includes(key) ||
          typeof value !== "string" ||
          value.length > 1000
        )
          throw new Error("설정 값이 올바르지 않습니다.");
      const next = { ...settings, ...body };
      await writeFile("data/settings.tmp", JSON.stringify(next));
      await rename("data/settings.tmp", "data/settings.json");
      Object.assign(settings, next);
      Object.assign(process.env, next);
      verified.clear();
      return send(res, 200, { ok: true });
    }
    if (req.url === "/api/check") {
      if (body.provider === "codex")
        await runProvider(
          "codex",
          "도구 없이 WC Office 연결 확인이라고만 답하세요.",
        );
      else if (body.provider === "notion")
        await api(
          "https://api.notion.com/v1/users/me",
          process.env.NOTION_TOKEN,
          undefined,
          { "Notion-Version": "2022-06-28" },
        );
      else if (body.provider === "cursor")
        await api(
          "https://api.cursor.com/v1/agents?limit=1",
          process.env.CURSOR_API_KEY,
        );
      else throw new Error("지원하지 않는 연결 검사입니다.");
      verified.add(body.provider);
      return send(res, 200, { message: "실제 응답 확인됨" });
    }
    if (req.url === "/api/projects") {
      const name = requireText(body.name, 80),
        goal = requireText(body.goal);
      if (
        !["unity", "web", "roblox", "landing", "unassigned"].includes(
          body.type,
        ) ||
        !["claude", "codex"].includes(body.developer)
      )
        throw new Error("프로젝트 유형과 개발 담당을 선택해주세요.");
      const id = randomUUID();
      const folder = await projectFolder(requireText(body.folder, 1000), id);
      const p = {
        id,
        name,
        goal,
        folder,
        type: body.type === "landing" ? "web" : body.type,
        developer: body.developer,
        repository: typeof body.repository === "string" ? body.repository : "",
        repositoryImported: body.repositoryImported === true,
        createdAt: new Date().toISOString(),
        status: "대화 준비",
        tasks: [],
        messages: [],
        activity: [],
        events: ["프로젝트 생성"],
      };
      await writeFile(
        path.join(folder, "project.json"),
        JSON.stringify({ id, name, goal, type: p.type }, null, 2),
      );
      projects.unshift(p);
      await save();
      return send(res, 201, p);
    }
    const p = projects.find((p) => p.id === body.id);
    if (!p) return send(res, 404, { error: "프로젝트를 찾지 못했습니다." });
    if (req.url === "/api/project/restore") {
      delete p.deletedAt;
      await save();
      return send(res, 200, { ok: true });
    }
    if (p.deletedAt)
      return send(res, 404, {
        error: "삭제한 프로젝트입니다. 먼저 복원해주세요.",
      });
    if (req.url === "/api/project/hold") {
      if (active.has(p.id))
        throw new Error("진행 중인 작업이 끝난 뒤 보류해주세요.");
      p.onHold = body.onHold === true;
      p.holdChangedAt = new Date().toISOString();
      await save();
      return send(res, 200, { ok: true });
    }
    if (
      p.onHold &&
      !["/api/project/update", "/api/project/delete"].includes(req.url)
    )
      throw new Error("보류를 해제한 뒤 작업을 요청해주세요.");
    if (req.url === "/api/project/delete") {
      if (active.has(p.id))
        throw new Error("진행 중인 작업이 끝난 뒤 삭제해주세요.");
      p.deletedAt = new Date().toISOString();
      await save();
      for (const response of subscribers.get(p.id) || []) response.end();
      return send(res, 200, { ok: true });
    }
    if (req.url === "/api/project/update") {
      if (active.has(p.id)) throw new Error("작업 종료 후 수정해주세요.");
      if (!["claude", "codex"].includes(body.developer))
        throw new Error("개발 담당을 확인해주세요.");
      if (
        body.type &&
        !["unity", "web", "roblox", "unassigned"].includes(body.type)
      )
        throw new Error("프로젝트 유형을 확인해주세요.");
      const name = requireText(body.name, 80),
        goal = requireText(body.goal),
        repository =
          typeof body.repository === "string" ? body.repository.trim() : "";
      if (
        repository &&
        !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(repository)
      )
        throw new Error("GitHub 저장소 URL을 확인해주세요.");
      Object.assign(p, {
        name,
        goal,
        repository,
        developer: body.developer,
        type: body.type || p.type,
        approved: false,
      });
      await save();
    } else if (req.url === "/api/compile") {
      job(p, "게임 제작 · Unity 컴파일", "Unity", async () => {
        if (!p.unityFolder) throw new Error("게임 코드부터 생성해주세요.");
        return compileUnity(p.unityFolder);
      });
    } else if (req.url === "/api/chat") {
      const message = requireText(body.message);
      p.messages.push({ role: "우찬", text: message });
      p.activity.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        from: "우찬",
        to: "팀 전체",
        kind: "instruction",
        text: message,
      });
      p.approved = false;
      if (active.has(p.id)) {
        (p.pendingInstructions ||= []).push(message);
        await teamEvent(
          p,
          "시스템",
          "우찬",
          "지시를 접수했습니다. 이후 AI 요청에 포함되며, 현재 작업이 끝나면 Codex가 추가 지시를 검토합니다. 진행 중인 응답은 즉시 중단되지 않습니다.",
        );
        return send(res, 202, { queued: true });
      }
      job(p, "기획 대화", "Codex", async () =>
        runProvider(
          "codex",
          `한국어 프로젝트 총괄 기획자. 프로젝트 유형(Unity, Web, Roblox)에 맞춰 사용자의 대화에 답하고 목표를 개발 작업과 완료 기준으로 정리하라. 도구나 파일 접근 없이 답변만 작성.\n${context(p)}`,
        ),
      );
    } else if (req.url === "/api/build") {
      if (p.type === "unassigned")
        throw new Error(
          "프로젝트 설정에서 Unity, Web, Roblox 중 유형을 먼저 선택해주세요.",
        );
      job(
        p,
        p.type === "unity"
          ? "게임 제작 · Unity 컴파일"
          : p.type === "roblox"
            ? "Roblox 제작"
            : "Web 제작",
        p.developer === "codex" ? "Codex" : "Claude",
        () =>
          teamBuild(p, async () => {
            if (p.type === "unity") return makeGame(p);
            if (!p.folder)
              throw new Error("폴더를 지정한 새 프로젝트를 만들어주세요.");
            p.approved = false;
            if (p.type === "roblox") {
              const output = await runProvider(
                p.developer || "claude",
                'Roblox Studio용 게임을 Luau로 작성하라. 외부 에셋 없이 기본 Part를 생성하고 게임 규칙, 승패, 재시작을 구현. ServerScriptService의 Script에 넣을 단일 서버 스크립트와 설치·테스트 지침을 작성. JSON만 출력: {"code":"전체 Luau 코드","instructions":"한국어 설치와 테스트 방법"}. 실행 검증했다고 주장하지 말 것. ' +
                  context(p),
              );
              const result = JSON.parse(
                output
                  .trim()
                  .replace(/^```(?:json)?\s*/, "")
                  .replace(/\s*```$/, ""),
              );
              if (
                !result ||
                typeof result.code !== "string" ||
                !result.code.trim() ||
                typeof result.instructions !== "string"
              )
                throw new Error("Roblox 코드 응답 형식을 확인해주세요.");
              const folder = path.join(
                p.folder,
                "Roblox-" + Date.now() + "-" + randomUUID().slice(0, 6),
              );
              await mkdir(folder);
              await writeFile(
                path.join(folder, "Game.server.luau"),
                result.code,
              );
              await writeFile(
                path.join(folder, "설치안내.txt"),
                result.instructions,
              );
              return (
                "Roblox 코드와 설치 안내 저장 완료\n" +
                folder +
                "\nStudio에서 가져온 뒤 플레이 테스트가 필요합니다.\n" +
                result.instructions
              );
            }
            const html = await runProvider(
              p.developer || "claude",
              "목표에 맞는 Web 프로젝트의 완전한 단일 HTML 프로토타입을 작성하세요. CSS와 JavaScript를 포함하고 외부 의존성 없이 동작하게 하세요. HTML만 답변하세요. " +
                context(p),
            );
            const file = path.join(p.folder, "web-" + Date.now() + ".html");
            await writeFile(
              file,
              html
                .trim()
                .replace(/^```(?:html)?\s*/, "")
                .replace(/\s*```$/, ""),
            );
            return "HTML 저장 완료 " + file + "\n" + html;
          }),
      );
    } else if (req.url === "/api/unity/open") {
      if (active.has(p.id) || !p.unityFolder)
        throw new Error("제작 완료 후 열어주세요.");
      await openUnity(p.unityFolder);
    } else if (req.url === "/api/approve") {
      if (
        active.has(p.id) ||
        p.tasks
          .filter((t) =>
            [
              "게임 제작 · Unity 컴파일",
              "Web 제작",
              "Roblox 제작",
              "랜딩페이지 제작",
            ].includes(t.title),
          )
          .at(-1)?.status !== "완료"
      )
        throw new Error("최신 제작 작업 완료 후 결과를 확인하고 승인해주세요.");
      p.approved = true;
      p.status = "승인 완료";
      await save();
    } else if (req.url === "/api/notion") {
      job(p, "Notion 문서 동기화", "Notion", async () => {
        if (!process.env.NOTION_PARENT_PAGE_ID)
          throw new Error("Notion 상위 페이지 ID가 필요합니다.");
        p.notion = await syncNotion(p);
        return `새 문서 저장 완료 ${p.notion.url}`;
      });
    } else if (req.url === "/api/cursor") {
      job(p, "Cursor 원격 개발", "Cursor", async () => {
        if (p.cursor?.run?.id)
          throw new Error("기존 Cursor 작업 상태를 확인해주세요.");
        p.cursor = await launchCursor(
          p,
          `${context(p)}\n명시된 프로젝트 유형에 맞게 구현하고 테스트 후 별도 브랜치의 PR로 제출하라. 로컬 생성 파일은 자동 업로드되지 않으므로 원격 저장소 기준으로 작업하라.`,
        );
        return `원격 작업 제출 완료. 로컬 폴더와 자동 병합되지 않습니다.\n${p.cursor.agent?.url || JSON.stringify(p.cursor)}`;
      });
    } else if (req.url === "/api/cursor/status") {
      job(p, "Cursor 상태 확인", "Cursor", async () => {
        if (!p.cursor) throw new Error("Cursor 작업을 먼저 제출해주세요.");
        p.cursorResult = await cursorStatus(p.cursor);
        return JSON.stringify(p.cursorResult, null, 2);
      });
    } else if (req.url === "/api/review") {
      job(p, "코드 검토", "GitHub Copilot", async () =>
        copilotReview(
          `도구를 실행하지 말고 코드와 요구사항을 검토하라. ${context(p)}\n${p.unityFolder ? await readFile(path.join(p.unityFolder, "Assets/Scripts/GameBootstrap.cs"), "utf8").catch(() => "") : ""}`,
        ),
      );
    } else if (req.url === "/api/image") {
      const prompt = requireText(body.prompt);
      job(p, "2D 이미지 생성", "Stable Diffusion", async () => {
        if (!p.folder) throw new Error("새 프로젝트를 생성해주세요.");
        const file = path.join(p.folder, `image-${Date.now()}.png`);
        await writeFile(file, await generateImage(prompt));
        return `이미지 저장 완료\n${file}`;
      });
    } else if (req.url === "/api/mesh") {
      const prompt = requireText(body.prompt);
      job(p, "3D 모델 생성", "Meshy", async () => {
        if (p.mesh) throw new Error("기존 모델 상태를 확인해주세요.");
        p.mesh = await createMesh(prompt);
        return `3D 생성 작업 제출됨 · ${p.mesh.result}`;
      });
    } else if (req.url === "/api/mesh/status") {
      job(p, "3D 모델 상태", "Meshy", async () => {
        if (!p.mesh) throw new Error("모델 생성부터 시작해주세요.");
        p.meshResult = await meshStatus(p.mesh.result);
        return JSON.stringify(p.meshResult, null, 2);
      });
    } else return send(res, 404, { error: "요청을 찾지 못했습니다." });
    return send(res, 202, { ok: true });
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
});
server.listen(4310, "127.0.0.1", () =>
  console.log("WC Office http://127.0.0.1:4310"),
);
const repositorySync = createRepositorySync({
  projects,
  save,
  isActive: (id) => active.has(id),
});
const checkRepositories = () =>
  repositorySync
    .poll()
    .catch(() => console.error("저장소 자동 갱신 저장 실패"));
setTimeout(checkRepositories, 2500).unref();
setInterval(checkRepositories, SYNC_INTERVAL).unref();
