import path from "node:path";
import { github, repositorySlug } from "./repository-sync.mjs";
export function createRepositoryFiles(api = github) {
  const cache = new Map();
  async function get(key, ttl = 60000, fresh = false) {
    const old = cache.get(key);
    if (!fresh && old && old.until > Date.now()) return old.value;
    const value = api(key);
    cache.set(key, { value, until: Date.now() + ttl });
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    try {
      return await value;
    } catch (e) {
      cache.delete(key);
      throw e;
    }
  }
  return async function repositoryFiles(
    p,
    version = "current",
    file,
    fresh = false,
  ) {
    const slug = repositorySlug(p.repository);
    if (!slug) throw Error("GitHub 저장소 연결이 없습니다.");
    const base = `repos/${slug}`;
    const commits = await get(`${base}/commits?per_page=20`, 60000, fresh);
    const versions = commits
      .filter((c) => /^[a-f0-9]{40}$/.test(c.sha))
      .map((c) => ({
        id: c.sha,
        label: `${c.sha.slice(0, 7)} · ${c.commit.message.split("\n")[0].slice(0, 55)}`,
      }));
    const sha = version === "current" ? versions[0]?.id : version;
    if (!sha || !versions.some((v) => v.id === sha))
      throw Error(
        "최근 20개 커밋에서 해당 버전을 찾지 못했습니다. 파일 새로고침 후 다시 선택해주세요.",
      );
    const tree = await get(`${base}/git/trees/${sha}?recursive=1`, 3600000);
    const files = (tree.tree || [])
      .filter(
        (f) => f.type === "blob" && f.mode !== "120000" && f.mode !== "160000",
      )
      .map((f) => ({ name: f.path, size: f.size, sha: f.sha }));
    const result = {
      versions,
      version: sha,
      files: files.map(({ name, size }) => ({ name, size })),
      note: tree.truncated
        ? "GitHub가 파일 목록을 일부만 반환했습니다. 일부 파일은 표시되지 않을 수 있습니다."
        : "기본 브랜치 · 최근 20개 커밋",
    };
    if (!file) return result;
    const entry = files.find((f) => f.name === file);
    if (!entry) throw Error("선택한 커밋에 없는 파일입니다.");
    if (entry.size > 2 * 1024 * 1024)
      return {
        ...result,
        name: file,
        kind: "unsupported",
        note: "2MB 이하 파일만 미리볼 수 있습니다.",
      };
    const ext = path.extname(file).toLowerCase();
    const mime = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
    }[ext];
    const text =
      /\.(html?|css|scss|sass|js|mjs|cjs|jsx|ts|tsx|json|cs|lua|luau|md|txt|py|go|rs|java|cpp|c|h|sh|ps1|ya?ml|toml|xml|svg|shader|unity|asset|meta|mat)$/i.test(
        file,
      ) || /(^|\/)(Dockerfile|LICENSE|\.gitignore|\.editorconfig)$/.test(file);
    if (!mime && !text)
      return {
        ...result,
        name: file,
        kind: "unsupported",
        note: "이 파일 형식은 코드·이미지 미리보기를 지원하지 않습니다.",
      };
    const blob = await get(`${base}/git/blobs/${entry.sha}`, 3600000);
    if (blob.encoding !== "base64")
      throw Error("지원하지 않는 GitHub 파일 응답입니다.");
    const bytes = Buffer.from(blob.content, "base64");
    if (bytes.length > 2 * 1024 * 1024)
      throw Error("미리보기 파일 크기 제한을 초과했습니다.");
    return {
      ...result,
      name: file,
      kind: mime ? "image" : /\.html?$/i.test(file) ? "html" : "text",
      content: mime
        ? `data:${mime};base64,${bytes.toString("base64")}`
        : bytes.toString("utf8"),
      note: /\.html?$/i.test(file)
        ? "단일 HTML 미리보기 · 상대 경로 리소스와 빌드가 필요한 앱은 코드 탭에서 확인해주세요."
        : "GitHub 커밋에 저장된 파일",
    };
  };
}
