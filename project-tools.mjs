import { mkdir, readdir, lstat, copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Script } from "node:vm";

export function checkWeb(html) {
  const checks = [];
  checks.push({
    name: "HTML 문서",
    passed:
      /<!doctype\s+html/i.test(html) &&
      /<html[\s>]/i.test(html) &&
      /<\/html>/i.test(html),
  });
  let skipped = 0;
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    const attrs = match[1];
    if (/\bsrc\s*=|\btype\s*=/i.test(attrs)) {
      skipped++;
      continue;
    }
    try {
      new Script(match[2]);
      checks.push({ name: "JavaScript 문법", passed: true });
    } catch (e) {
      checks.push({
        name: "JavaScript 문법",
        passed: false,
        detail: e.message,
      });
    }
  }
  return {
    at: new Date().toISOString(),
    checks,
    passed: checks.every((c) => c.passed),
    note: `정적 구조·문법 검사입니다. 실제 화면·상호작용은 미검증입니다.${skipped ? ` 외부·모듈 등 스크립트 ${skipped}개는 검사 제외.` : ""}`,
  };
}

// Copy only generated deliverables, never follow links or include Unity caches.
async function copyTree(source, dest, budget = { bytes: 0, files: 0 }) {
  const stat = await lstat(source);
  if (stat.isSymbolicLink())
    throw new Error("체크포인트는 링크 파일을 포함할 수 없습니다.");
  if (stat.isDirectory()) {
    await mkdir(dest, { recursive: true });
    for (const name of await readdir(source))
      await copyTree(path.join(source, name), path.join(dest, name), budget);
  } else if (stat.isFile()) {
    budget.bytes += stat.size;
    budget.files++;
    if (budget.bytes > 50 * 1024 * 1024 || budget.files > 1000)
      throw new Error("체크포인트 한도(50MB·1000개 파일)를 초과했습니다.");
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(source, dest);
  } else throw new Error("지원하지 않는 파일 형식입니다.");
}
const parts = (a) =>
  a.type === "unity"
    ? ["Assets", "Packages", "ProjectSettings"]
    : a.type === "roblox"
      ? ["Game.server.luau", "설치안내.txt"]
      : [path.basename(a.path)];
export async function checkpoint(p, root = "data/checkpoints") {
  if (!p.artifact) return null;
  const id = randomUUID();
  const dest = path.resolve(root, id);
  const artifact = p.artifact;
  const source =
    artifact.type === "web" ? path.dirname(artifact.path) : artifact.path;
  const budget = { bytes: 0, files: 0 };
  for (const part of parts(artifact))
    await copyTree(path.join(source, part), path.join(dest, part), budget);
  const entry = {
    id,
    at: new Date().toISOString(),
    artifact: { ...artifact },
    output:
      p.tasks?.filter((t) => t.artifact?.path === artifact.path).at(-1)
        ?.output || "저장된 제작 결과",
    bytes: budget.bytes,
  };
  (p.checkpoints ||= []).push(entry);
  return entry;
}
export async function restoreCheckpoint(p, id, root = "data/checkpoints") {
  const entry = p.checkpoints?.find((c) => c.id === id);
  if (!entry || !/^[\da-f-]{36}$/i.test(id) || !p.folder)
    throw new Error("복원할 체크포인트를 확인해주세요.");
  const dest = path.join(p.folder, "Restored-" + randomUUID());
  const source = path.resolve(root, id);
  const budget = { bytes: 0, files: 0 };
  for (const part of parts(entry.artifact))
    await copyTree(path.join(source, part), path.join(dest, part), budget);
  return {
    type: entry.artifact.type,
    path:
      entry.artifact.type === "web"
        ? path.join(dest, path.basename(entry.artifact.path))
        : dest,
  };
}
export async function testArtifact(artifact, compile) {
  if (artifact.type === "web")
    return checkWeb(await readFile(artifact.path, "utf8"));
  if (artifact.type === "unity") {
    try {
      const output = await compile(artifact.path);
      return {
        at: new Date().toISOString(),
        passed: true,
        checks: [{ name: "Unity 컴파일", passed: true, detail: output }],
        note: "실제 플레이와 밸런스는 미검증입니다.",
      };
    } catch (e) {
      return {
        at: new Date().toISOString(),
        passed: false,
        checks: [{ name: "Unity 컴파일", passed: false, detail: e.message }],
        note: "컴파일 실패 · 오류 해결 후 다시 검사해주세요.",
      };
    }
  }
  return {
    at: new Date().toISOString(),
    passed: null,
    checks: [],
    note: "Roblox Studio 실행 테스트는 수동 확인이 필요합니다.",
  };
}
