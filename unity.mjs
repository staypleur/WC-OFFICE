import path from "node:path";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { exec } from "./integrations.mjs";
export async function findUnity() {
  if (process.env.UNITY_EDITOR_PATH) return process.env.UNITY_EDITOR_PATH;
  const root = "C:/Program Files/Unity/Hub/Editor";
  try {
    const versions = await readdir(root);
    return path.join(root, versions.sort().at(-1), "Editor", "Unity.exe");
  } catch {
    return null;
  }
}
export async function chooseFolder() {
  const command =
    "Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'WC Office 프로젝트를 저장할 폴더'; if ($dialog.ShowDialog() -eq 'OK') { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::Write($dialog.SelectedPath) }";
  const result = await exec(
    "powershell.exe",
    ["-NoProfile", "-STA", "-Command", command],
    { windowsHide: true, timeout: 120000, encoding: "utf8" },
  );
  return result.stdout.trim();
}
export async function projectFolder(parent, id) {
  if (!path.isAbsolute(parent))
    throw new Error("절대 경로의 폴더를 선택해주세요.");
  if (!(await stat(parent)).isDirectory())
    throw new Error("폴더 경로를 확인해주세요.");
  const folder = path.join(parent, `WC-${id}`);
  await mkdir(folder);
  return folder;
}
export function parseUnityFiles(output) {
  const clean = output
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  const result = JSON.parse(clean);
  if (
    !result ||
    !Array.isArray(result.files) ||
    !result.files.length ||
    result.files.length > 30
  )
    throw new Error("유효한 Unity 파일 목록이 필요합니다.");
  const names = new Set();
  for (const file of result.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      !/^Assets\/Scripts\/[A-Za-z0-9_-]+\.cs$/.test(file.path) ||
      typeof file.content !== "string" ||
      file.content.length > 150000 ||
      names.has(file.path.toLowerCase())
    )
      throw new Error("생성 파일 경로나 내용이 올바르지 않습니다.");
    names.add(file.path.toLowerCase());
  }
  return result.files;
}
export async function writeUnity(folder, files) {
  await mkdir(path.join(folder, "Assets", "Scripts"), { recursive: true });
  await mkdir(path.join(folder, "Packages"), { recursive: true });
  await mkdir(path.join(folder, "ProjectSettings"), { recursive: true });
  await writeFile(
    path.join(folder, "Packages", "manifest.json"),
    JSON.stringify({
      dependencies: {
        "com.unity.modules.physics": "1.0.0",
        "com.unity.modules.imgui": "1.0.0",
        "com.unity.modules.inputlegacy": "1.0.0",
        "com.unity.modules.audio": "1.0.0",
        "com.unity.modules.jsonserialize": "1.0.0",
      },
    }),
  );
  await writeFile(
    path.join(folder, "ProjectSettings", "ProjectVersion.txt"),
    "m_EditorVersion: 6000.6.4f1\n",
  );
  for (const file of files)
    await writeFile(path.join(folder, file.path), file.content);
}
export async function compileUnity(folder) {
  const unity = await findUnity();
  if (!unity) throw new Error("Unity Editor를 설치해주세요.");
  const log = path.join(folder, "compile.log");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/(API_KEY|TOKEN|SECRET|PASSWORD)$/i.test(key),
    ),
  );
  try {
    await exec(
      unity,
      [
        "-batchmode",
        "-nographics",
        "-quit",
        "-projectPath",
        folder,
        "-logFile",
        log,
      ],
      { windowsHide: true, timeout: 240000, maxBuffer: 1000000, env },
    );
  } catch {
    const detail = await readFile(log, "utf8").catch(() => "로그 없음");
    if (
      /entitlement|access token is unavailable|No valid Unity Editor license/i.test(
        detail,
      )
    )
      throw new Error(
        "Unity 라이선스 활성화 필요. Unity Hub에서 로그인하고 라이선스를 활성화한 뒤 재컴파일하세요. 생성된 코드는 저장되어 있습니다.",
      );
    const errors = detail
      .split("\n")
      .filter((line) => /error CS\d+|compilation failed/i.test(line));
    throw new Error(
      "Unity 컴파일 실패. 프로젝트의 compile.log를 확인해주세요.\n" +
        errors.slice(-15).join("\n"),
    );
  }
  const detail = await readFile(log, "utf8");
  if (/error CS\d+|compilation failed/i.test(detail))
    throw new Error("Unity 컴파일 오류\n" + detail.slice(-5000));
  return "Unity 배치 컴파일 통과. 플레이 동작은 Unity Editor에서 확인하세요.";
}
export async function openUnity(folder) {
  const unity = await findUnity();
  if (!unity) throw new Error("Unity Editor를 찾지 못했습니다.");
  const { spawn } = await import("node:child_process");
  await new Promise((resolve, reject) => {
    const child = spawn(unity, ["-projectPath", folder], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
