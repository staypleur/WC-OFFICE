import path from "node:path";
import { lstat, readdir, readFile } from "node:fs/promises";
export async function artifactView(p, version = "current", file) {
  const cp =
    version === "current" ? null : p.checkpoints?.find((c) => c.id === version);
  if (version !== "current" && (!cp || !/^[a-f0-9-]{36}$/i.test(version)))
    throw Error("버전을 찾지 못했습니다.");
  const artifact = cp?.artifact || p.artifact;
  const versions = [
    { id: "current", label: "현재 결과" },
    ...(p.checkpoints || [])
      .slice()
      .reverse()
      .map((c) => ({
        id: c.id,
        label: new Date(c.at).toLocaleString("ko-KR"),
      })),
  ];
  if (!artifact)
    return {
      versions,
      files: [],
      note: "아직 생성된 결과 파일이 없습니다. 자동 제작 후 표시됩니다.",
    };
  const root = cp
    ? path.resolve("data/checkpoints", cp.id)
    : artifact.type === "web"
      ? path.dirname(artifact.path)
      : artifact.path;
  const roots =
    artifact.type === "web"
      ? [path.basename(artifact.path)]
      : artifact.type === "unity"
        ? ["Assets", "Packages", "ProjectSettings"]
        : ["Game.server.luau", "설치안내.txt"];
  const files = [];
  async function walk(relative) {
    if (files.length >= 200) return;
    const absolute = path.join(root, relative);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const name of await readdir(absolute))
        await walk(path.join(relative, name));
    } else if (stat.isFile())
      files.push({
        name:
          artifact.type === "web"
            ? "index.html"
            : relative.split(path.sep).join("/"),
        size: stat.size,
        relative,
      });
  }
  // Reject linked roots as well as links within generated deliverables.
  if ((await lstat(root)).isSymbolicLink())
    throw Error("링크 폴더는 열 수 없습니다.");
  for (const entry of roots) await walk(entry);
  const selected = files.find((f) => f.name === file);
  const result = {
    versions,
    files: files.map(({ name, size }) => ({ name, size })),
    note: files.length >= 200 ? "최대 200개 파일을 표시합니다." : "",
  };
  if (file && !selected) throw Error("결과물에 없는 파일입니다.");
  if (selected) {
    if (selected.size > 2 * 1024 * 1024)
      return {
        ...result,
        name: file,
        kind: "unsupported",
        note: "2MB 이하 파일만 미리볼 수 있습니다.",
      };
    const ext = path.extname(file).toLowerCase();
    const imageType = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    }[ext];
    const supported =
      /\.(html?|css|js|mjs|json|cs|luau|lua|txt|md|shader|yaml|yml|asset|meta|unity|mat)$/i.test(
        file,
      );
    if (!imageType && !supported)
      return {
        ...result,
        name: file,
        kind: "unsupported",
        note: "이 파일 형식은 미리보기를 지원하지 않습니다.",
      };
    const bytes = await readFile(path.join(root, selected.relative));
    return {
      ...result,
      name: file,
      kind: imageType ? "image" : /\.html?$/i.test(file) ? "html" : "text",
      content: imageType
        ? `data:${imageType};base64,${bytes.toString("base64")}`
        : bytes.toString("utf8"),
    };
  }
  return result;
}
