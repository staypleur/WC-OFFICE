import { diffLines } from "/file-diff.mjs";
const workspace = document.getElementById("workspace");
const grid = document.createElement("div");
grid.className = "workbench-grid";
const files = document.createElement("div");
files.className = "workbench-files";
files.innerHTML =
  '<h3>프로젝트 파일</h3><label>파일 출처<select id="artifact-source"><option value="repository">GitHub 저장소</option><option value="generated">AI 생성 결과</option></select></label><label>버전 · 커밋<select id="artifact-version"></select></label><label>파일 찾기<input id="artifact-search" type="search" placeholder="이름 또는 경로" /></label><button type="button" id="artifact-refresh">파일 새로고침</button><p id="artifact-file-count" class="notice"></p><nav id="artifact-files" aria-label="결과 파일 목록"></nav>';
const center = document.createElement("section");
center.className = "workbench-view";
center.innerHTML =
  '<div class="workbench-toolbar"><strong id="artifact-name">결과물</strong><div class="artifact-tabs" role="group" aria-label="결과 보기 방식"><button data-view="preview" aria-pressed="true">미리보기</button><button data-view="source" aria-pressed="false">코드</button><button data-view="diff" aria-pressed="false">변경 비교</button></div></div><label id="artifact-compare-label" hidden>비교 기준<select id="artifact-compare"></select></label><p id="artifact-notice" role="status"></p><div id="artifact-display"></div>';
const right = document.createElement("div");
right.className = "workbench-controls";
right.setAttribute("aria-label", "작업 및 승인");
const children = [...workspace.children];
for (const child of children.slice(3)) right.append(child);
grid.append(files, center, right);
workspace.append(grid);
const $ = (s) => workspace.querySelector(s);
let project = null,
  signature = "",
  version = "current",
  baseline = "",
  selectedFile = "",
  mode = "preview",
  requestId = 0;
let source = "generated",
  fresh = false;
let currentFiles = [],
  baseFiles = [];
async function fetchArtifact(v, file) {
  const query = new URLSearchParams({ version: v, source });
  if (fresh && !file) {
    query.set("fresh", "1");
    fresh = false;
  }
  if (file) query.set("file", file);
  const response = await fetch(`/api/artifacts/${project.id}?${query}`);
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "파일을 불러올 수 없습니다.");
  return data;
}
function options(select, versions, value) {
  select.replaceChildren();
  for (const v of versions) {
    const option = document.createElement("option");
    option.value = v.id;
    option.textContent = v.label;
    select.append(option);
  }
  select.value = value;
}
async function load() {
  const token = ++requestId;
  $("#artifact-notice").textContent = "파일 불러오는 중…";
  try {
    const listing = await fetchArtifact(version);
    if (token !== requestId) return;
    version = listing.version || version;
    if (
      baseline === version ||
      !listing.versions.some((v) => v.id === baseline)
    )
      baseline = listing.versions.find((v) => v.id !== version)?.id || "";
    options($("#artifact-version"), listing.versions, version);
    options(
      $("#artifact-compare"),
      listing.versions.filter((v) => v.id !== version),
      baseline,
    );
    currentFiles = listing.files;
    const previous = baseline ? await fetchArtifact(baseline) : { files: [] };
    if (token !== requestId) return;
    baseFiles = previous.files;
    const names = [
      ...new Set(
        [...currentFiles, ...(mode === "diff" ? baseFiles : [])].map(
          (f) => f.name,
        ),
      ),
    ];
    if (!names.includes(selectedFile)) selectedFile = names[0] || "";
    $("#artifact-files").replaceChildren();
    const matching = names.filter((name) =>
      name.toLowerCase().includes($("#artifact-search").value.toLowerCase()),
    );
    $("#artifact-file-count").textContent =
      `${matching.length}개 파일${matching.length > 300 ? " · 300개씩 표시, 검색으로 좁혀주세요." : ""}`;
    for (const name of matching.slice(0, 300)) {
      const button = document.createElement("button");
      button.textContent = name;
      button.title = name;
      button.setAttribute("aria-current", String(name === selectedFile));
      button.onclick = () => {
        selectedFile = name;
        load();
      };
      $("#artifact-files").append(button);
    }
    $("#artifact-name").textContent = selectedFile || "결과물";
    $("#artifact-display").replaceChildren();
    if (!selectedFile) {
      $("#artifact-notice").textContent =
        listing.note || "결과 파일이 없습니다.";
      return;
    }
    const current = currentFiles.some((f) => f.name === selectedFile)
      ? await fetchArtifact(version, selectedFile)
      : null;
    if (token !== requestId) return;
    const display = $("#artifact-display");
    if (mode === "diff") {
      if (!baseline) {
        $("#artifact-notice").textContent =
          source === "repository"
            ? "비교할 이전 커밋이 없습니다."
            : "비교할 이전 체크포인트가 없습니다.";
        return;
      }
      const old = baseFiles.some((f) => f.name === selectedFile)
        ? await fetchArtifact(baseline, selectedFile)
        : null;
      if (token !== requestId) return;
      if (
        [old, current].some(
          (x) => x && ["image", "unsupported"].includes(x.kind),
        )
      ) {
        $("#artifact-notice").textContent =
          "이 파일은 텍스트 비교를 지원하지 않습니다. 미리보기에서 확인해주세요.";
        return;
      }
      const diff = diffLines(old?.content || "", current?.content || "");
      $("#artifact-notice").textContent =
        `추가 ${diff.added}줄 · 삭제 ${diff.removed}줄${!old ? " · 새 파일" : !current ? " · 삭제된 파일" : ""}${diff.truncated ? " · 1500줄까지만 표시" : ""}${diff.coarse ? " · 대용량 변경 구간 단위 비교" : ""}${!diff.rows.length ? " · 변경 없음" : ""}`;
      const code = document.createElement("pre");
      code.className = "file-diff";
      for (const row of diff.rows) {
        const line = document.createElement("div");
        line.dataset.kind = row.kind;
        line.textContent = `${row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "} ${String(row.line).padStart(4)}  ${row.text}`;
        code.append(line);
      }
      display.append(code);
    } else if (current) {
      $("#artifact-notice").textContent =
        current.note ||
        (current.kind === "html" && mode === "preview"
          ? "격리된 Web 미리보기 · 외부 네트워크 연결은 차단됩니다."
          : "파일 내용");
      if (current.kind === "unsupported") return;
      if (current.kind === "image") {
        const img = document.createElement("img");
        img.src = current.content;
        img.alt = selectedFile;
        display.append(img);
      } else if (current.kind === "html" && mode === "preview") {
        const frame = document.createElement("iframe");
        frame.title = "Web 결과 미리보기";
        frame.setAttribute("sandbox", "allow-scripts");
        frame.referrerPolicy = "no-referrer";
        frame.srcdoc =
          "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'\">" +
          current.content;
        display.append(frame);
      } else {
        const pre = document.createElement("pre");
        pre.textContent = current.content;
        display.append(pre);
        if (mode === "preview")
          $("#artifact-notice").textContent =
            source === "repository"
              ? "GitHub 소스 미리보기 · 실행 환경이 필요한 프로젝트는 별도 빌드가 필요합니다."
              : "소스 미리보기 · Unity/Roblox의 플레이는 해당 에디터에서 확인해주세요.";
      }
    }
  } catch (e) {
    if (token === requestId) {
      $("#artifact-display").replaceChildren();
      $("#artifact-notice").textContent = e.message;
    }
  }
}
$("#artifact-version").onchange = (e) => {
  version = e.target.value;
  load();
};
$("#artifact-compare").onchange = (e) => {
  baseline = e.target.value;
  load();
};
$("#artifact-refresh").onclick = () => {
  version = "current";
  fresh = true;
  load();
};
$("#artifact-source").onchange = (e) => {
  source = e.target.value;
  version = "current";
  baseline = "";
  selectedFile = "";
  $("#artifact-search").value = "";
  load();
};
let searchTimer;
$("#artifact-search").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 250);
};
for (const button of center.querySelectorAll("[data-view]"))
  button.onclick = () => {
    mode = button.dataset.view;
    for (const tab of center.querySelectorAll("[data-view]"))
      tab.setAttribute("aria-pressed", String(tab === button));
    $("#artifact-compare-label").hidden = mode !== "diff";
    load();
  };
export function updateWorkbench(p) {
  const changed = project?.id !== p.id;
  project = p;
  const next = JSON.stringify([
    p.id,
    p.repository,
    p.repositoryReport?.commit,
    p.artifact,
    p.checkpoints?.map((c) => c.id),
    p.tasks?.at(-1)?.status,
  ]);
  if (changed) {
    source = p.repository ? "repository" : "generated";
    $("#artifact-source").value = source;
    $("#artifact-source option[value=repository]").disabled = !p.repository;
    $("#artifact-search").value = "";
    version = "current";
    baseline = "";
    selectedFile = "";
  }
  if (next !== signature) {
    signature = next;
    load();
  }
}
