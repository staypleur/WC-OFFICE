import { projectSummary } from "/project-summary.mjs";
import {
  compareHistory,
  historyKey,
  searchParts,
  createComparisonPreference,
  restoreHistorySelection,
  sortProjects,
  moveFavoriteOrder,
  projectUpdateKey,
  hasNewProjectUpdate,
  markProjectUpdatesRead,
  undoProjectUpdatesRead,
} from "/history-compare.mjs";
let comparisonStorage;
try {
  comparisonStorage = window.localStorage;
} catch {
  /* Browser may block storage. */
}
const historySelections = createComparisonPreference(
  comparisonStorage,
  "dates",
);
const comparisonFilters = createComparisonPreference(
  comparisonStorage,
  "filter",
);
const comparisonQueries = createComparisonPreference(
  comparisonStorage,
  "query",
);
const projectNameQueries = createComparisonPreference(
  comparisonStorage,
  "query",
);
const projectTypePreferences = createComparisonPreference(
  comparisonStorage,
  "projectType",
);
const projectSortPreferences = createComparisonPreference(
  comparisonStorage,
  "projectSort",
);
const projectSortDirections = createComparisonPreference(
  comparisonStorage,
  "projectSortDirection",
);
const projectFavorites = createComparisonPreference(
  comparisonStorage,
  "favorite",
);
const favoriteOrders = createComparisonPreference(
  comparisonStorage,
  "favoriteOrder",
);
let draggedFavorite = null;
let favoriteOrderUndo = null;
let favoriteOrderUndoTimer;
let updateReadUndo = null;
let updateReadUndoTimer;
const $ = (selector) => document.querySelector(selector);
const expansionPreferences = createComparisonPreference(
  comparisonStorage,
  "open",
);
const positionPreferences = createComparisonPreference(
  comparisonStorage,
  "position",
);
let viewPath = location.pathname;
let restoringPosition = true;
let positionRevision = 0;
let positionTimer;
history.scrollRestoration = "manual";
function expansionKey(node) {
  return node.dataset.historyKey
    ? "detail:" + node.dataset.historyKey
    : node.dataset.project
      ? "project:" + node.dataset.project
      : null;
}
function saveViewPosition() {
  if (restoringPosition) return;
  clearTimeout(positionTimer);
  const nodes = [
    ...document.querySelectorAll(
      "#projects .project-accordion, #projects [data-history-key]",
    ),
  ];
  const anchor = nodes
    .filter((node) => {
      const r = node.getBoundingClientRect();
      return node.getClientRects().length && r.top <= 110 && r.bottom > 110;
    })
    .at(-1);
  positionPreferences.set(viewPath, {
    y: window.scrollY,
    anchor: anchor ? expansionKey(anchor) : null,
    offset: anchor ? anchor.getBoundingClientRect().top : 0,
  });
}
async function restoreViewPosition(revision) {
  await Promise.race([
    document.fonts?.ready || Promise.resolve(),
    new Promise((resolve) => setTimeout(resolve, 800)),
  ]);
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  if (revision !== positionRevision || !restoringPosition) return;
  const saved = positionPreferences.get(viewPath);
  const anchor =
    saved?.anchor &&
    [
      ...document.querySelectorAll(
        "#projects .project-accordion, #projects [data-history-key]",
      ),
    ].find(
      (node) =>
        expansionKey(node) === saved.anchor && node.getClientRects().length,
    );
  const y = anchor
    ? window.scrollY + anchor.getBoundingClientRect().top - saved.offset
    : saved?.y || 0;
  window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
  restoringPosition = false;
}
window.addEventListener(
  "scroll",
  () => {
    if (restoringPosition) return;
    clearTimeout(positionTimer);
    positionTimer = setTimeout(saveViewPosition, 180);
  },
  { passive: true },
);
function cancelPositionRestore() {
  if (restoringPosition) {
    restoringPosition = false;
    positionRevision++;
  }
}
window.addEventListener("wheel", cancelPositionRestore, { passive: true });
window.addEventListener("touchstart", cancelPositionRestore, { passive: true });
window.addEventListener("keydown", (event) => {
  if (
    ["PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp", " "].includes(
      event.key,
    ) &&
    !event.target.matches("input, textarea, select")
  )
    cancelPositionRestore();
});
let reportId = null;
let chatId = null;
let chatStream = null;
let lastChatView = "";

function setPageVisibility(id) {
  $("#project-name-query").value =
    projectNameQueries.get("project-list:" + location.pathname) || "";
  const page = id ? "room" : location.pathname;
  const groups = [
    [".hero", ["/"]],
    [
      "#project-list,#projects",
      ["/", "/projects", "/projects/active", "/projects/held"],
    ],
    [
      "#project-hub",
      [
        "/projects",
        "/new",
        "/projects/active",
        "/projects/held",
        "/projects/deleted",
        "room",
      ],
    ],
    ["#deleted-projects", ["/projects/deleted"]],
    ["#marketing-page", ["/marketing"]],
    ["#form", ["/new"]],
    ["#ai-team", ["/team", "/settings"]],
    [".room-toolbar,#workspace", ["room"]],
  ];
  groups.forEach(([selector, pages]) =>
    document
      .querySelectorAll(selector)
      .forEach((node) =>
        node.classList.toggle("route-hidden", !pages.includes(page)),
      ),
  );
  document.querySelectorAll("aside nav a").forEach((link) => {
    const active =
      new URL(link.href).pathname ===
      ([
        "room",
        "/",
        "/new",
        "/projects/active",
        "/projects/held",
        "/projects/deleted",
      ].includes(page)
        ? "/projects"
        : page === "/settings"
          ? "/team"
          : page);
    link.classList.toggle("nav", active);
    link.classList.toggle("side-link", !active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.querySelectorAll(".project-subnav a").forEach((link) => {
    const active =
      new URL(link.href).pathname ===
      (page === "/new"
        ? "/new"
        : page === "/projects/held"
          ? "/projects/held"
          : page === "/projects/deleted"
            ? "/projects/deleted"
            : "/projects/active");
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function connectChat(id) {
  chatStream?.close();
  chatStream = null;
  if (chatId !== id) $("#chat-input").value = "";
  chatId = id;
  lastChatView = "";
  $("#chat-project").value = id || "";
  $("#chat-input").disabled = !id;
  $("#chat-form button").disabled = !id;
  $("#chat-error").textContent = "";
  if (!id) {
    $("#team-feed").innerHTML =
      '<div class="empty">새 프로젝트를 만들면 AI 대화를 시작할 수 있습니다.</div>';
    $("#current-work").textContent = "";
    $("#chat-connection").textContent = "프로젝트 없음";
    return;
  }
  const p = projects.find((p) => p.id === id);
  if (p) renderChat(p);
  $("#chat-connection").textContent = "연결 중…";
  chatStream = new EventSource(
    "/api/projects/" + encodeURIComponent(id) + "/events",
  );
  chatStream.addEventListener("project", (event) => {
    if (chatId !== id) return;
    const p = JSON.parse(event.data);
    $("#chat-connection").textContent = "실시간 연결";
    renderChat(p);
  });
  chatStream.onerror = () =>
    ($("#chat-connection").textContent = "연결 복구 중…");
}
$("#chat-toggle").onclick = async () => {
  $("#chat-sidebar").showModal();
  $("#chat-toggle").setAttribute("aria-expanded", "true");
  try {
    await refresh();
    if (!$("#chat-sidebar").open) return;
    $("#chat-project").innerHTML = projects
      .map(
        (p) =>
          `<option value="${escape(p.id)}">${escape(p.name || p.goal)}</option>`,
      )
      .join("");
    connectChat(
      selected ||
        reportId ||
        projects.find((p) => p.id === chatId)?.id ||
        projects[0]?.id ||
        null,
    );
  } catch (e) {
    $("#chat-error").textContent = e.message;
  }
};
$("#chat-close").onclick = () => $("#chat-sidebar").close();
$("#chat-sidebar").addEventListener("close", () => {
  chatStream?.close();
  chatStream = null;
  $("#chat-toggle").setAttribute("aria-expanded", "false");
  $("#chat-toggle").focus();
});
$("#chat-project").onchange = (event) => connectChat(event.target.value);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
let projects = [];
let selected =
  /^\/projects\/([a-f0-9-]+)$/.exec(location.pathname)?.[1] || null;
let eventStream;
function routeProject(id, push = true) {
  clearFavoriteOrderUndo();
  clearUpdateReadUndo();
  saveViewPosition();
  restoringPosition = true;
  const revision = ++positionRevision;
  clearTimeout(positionTimer);
  selected = id;
  lastView = "";
  editingProject = null;
  if (push) history.pushState({}, "", id ? "/projects/" + id : "/");
  viewPath = location.pathname;
  document.body.classList.toggle("project-mode", !!id);
  setPageVisibility(id);
  eventStream?.close();
  eventStream = null;
  if (id) {
    $("#live-state").textContent = "연결 중";
    eventStream = new EventSource(
      "/api/projects/" + encodeURIComponent(id) + "/events",
    );
    eventStream.addEventListener("project", (event) => {
      if (selected !== id) return;
      const p = JSON.parse(event.data);
      const index = projects.findIndex((item) => item.id === p.id);
      if (index < 0) projects.push(p);
      else projects[index] = p;
      $("#live-state").textContent = "실시간 연결";
      renderProject(p);
    });
    eventStream.onerror = () => {
      $("#live-state").textContent = "연결 복구 중…";
    };
  }
  refresh()
    .then(() => restoreViewPosition(revision))
    .catch((e) => {
      restoringPosition = false;
      error(e.message);
    });
}
window.addEventListener("popstate", () =>
  routeProject(
    /^\/projects\/([a-f0-9-]+)$/.exec(location.pathname)?.[1] || null,
    false,
  ),
);
window.addEventListener("pagehide", () => {
  document
    .querySelectorAll(
      "#projects .project-accordion, #projects [data-history-key]",
    )
    .forEach((node) => {
      const key = expansionKey(node);
      if (key) expansionPreferences.set(key, node.open);
    });
  saveViewPosition();
  eventStream?.close();
  chatStream?.close();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) routeProject(selected, false);
  if (event.persisted && $("#chat-sidebar").open) connectChat(chatId);
});
let lastView = "";
let editingProject = null;
async function request(url, body) {
  const response = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}
function error(message) {
  $("#error").textContent = message;
}
async function refresh() {
  await updateBatchStatus();
  projects = await request("/api/projects");
  const heldPage = location.pathname === "/projects/held";
  const visibleProjects = projects.filter((p) => !!p.onHold === heldPage);
  $("#project-list h2").textContent = heldPage
    ? "보류 프로젝트"
    : "진행 프로젝트";
  $("#marketing-projects").innerHTML =
    projects
      .map(
        (p) =>
          `<button data-marketing="${escape(p.id)}"><strong>${escape(p.name || p.goal)}</strong><span>홍보 기획 대화 ↗</span></button>`,
      )
      .join("") || '<p class="notice">새 프로젝트를 먼저 만들어주세요.</p>';
  const openIds = new Set(
    [...document.querySelectorAll(".project-accordion[open]")].map(
      (node) => node.dataset.project,
    ),
  );
  const listView = JSON.stringify(visibleProjects);
  if (
    $("#projects").dataset.view !== listView &&
    !draggedFavorite &&
    !document.activeElement?.matches("[data-change-search]")
  ) {
    const expandedHistory = new Set(
      [...document.querySelectorAll("[data-history-key][open]")].map(
        (node) => node.dataset.historyKey,
      ),
    );
    $("#projects").innerHTML =
      visibleProjects
        .map((p) => {
          const s = projectSummary(p);
          const type =
            p.type === "unassigned" ? "유형 확인 필요" : p.type.toUpperCase();
          const repoLink =
            /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(
              p.repository || "",
            )
              ? '<a href="' +
                escape(p.repository) +
                '" target="_blank" rel="noopener noreferrer">GitHub 저장소 ↗</a>'
              : "";
          return (
            '<details class="project-accordion" data-project="' +
            escape(p.id) +
            '" ' +
            ((expansionPreferences.get("project:" + p.id) ?? openIds.has(p.id))
              ? "open"
              : "") +
            '><summary><button type="button" class="favorite-drag" draggable="true" hidden aria-label="즐겨찾기 순서 변경" title="드래그하여 순서 변경 · 위/아래 방향키로 이동">⠿</button><span class="project-identity"><small>' +
            escape(type) +
            "</small><strong>" +
            escape(p.name || p.goal) +
            '</strong></span><span class="project-progress">' +
            escape(s.progress) +
            '</span><button type="button" class="project-favorite" data-favorite="' +
            escape(p.id) +
            '" aria-label="즐겨찾기" aria-pressed="false">☆</button><span class="accordion-arrow">⌄</span></summary><div class="project-details"><div class="report-grid"><div><small>진행 상황</small><p>' +
            escape(s.progress) +
            "</p><span>WC Office 완료 작업 " +
            s.completed +
            " / " +
            s.total +
            "</span></div><div><small>필요한 승인</small><p>" +
            escape(s.approval) +
            "</p></div><div><small>최근 결과 요약</small>" +
            compactSummary(s.result, p.id + ":recent-summary") +
            "</div></div>" +
            repositoryReportHtml(p) +
            '<div class="project-links"><a href="/projects/' +
            escape(p.id) +
            '">작업실 입장 ↗</a>' +
            repoLink +
            '<button type="button" data-read-update="' +
            escape(p.id) +
            '" hidden>업데이트 확인 완료</button>' +
            '<button type="button" data-hold="' +
            escape(p.id) +
            '" ' +
            (p.status === "작업 중" ? "disabled" : "") +
            ">" +
            (p.onHold ? "보류 해제" : "보류") +
            "</button>" +
            '<button type="button" class="delete-project" data-delete="' +
            escape(p.id) +
            '" ' +
            (p.status === "작업 중" ? "disabled" : "") +
            ">프로젝트 삭제</button></div></div></details>"
          );
        })
        .join("") || '<div class="empty">프로젝트를 만들어 시작하세요.</div>';
    $("#projects").dataset.view = listView;
    document.querySelectorAll("[data-history-key]").forEach((node) => {
      node.open =
        expansionPreferences.get(expansionKey(node)) ??
        expandedHistory.has(node.dataset.historyKey);
    });
    document
      .querySelectorAll("[data-compare-project]")
      .forEach(applyChangeSearch);
  }
  applyProjectNameSearch();
  const deleted = await request("/api/projects/deleted");
  $("#deleted-project-list").innerHTML =
    deleted
      .map(
        (p) =>
          '<div class="deleted-row"><span>' +
          escape(p.name) +
          '</span><button data-restore="' +
          escape(p.id) +
          '">복원</button></div>',
      )
      .join("") || '<p class="notice">삭제한 프로젝트가 없습니다.</p>';
  const project = projects.find((p) => p.id === selected);
  $("#workspace").hidden = !project;
  if (selected && !project)
    error("프로젝트를 찾지 못했습니다. 프로젝트 목록으로 돌아가주세요.");
  if (project) renderProject(project);
}
let batchTimer;
async function updateBatchStatus(status) {
  clearTimeout(batchTimer);
  try {
    const s = status || (await request("/api/projects/refresh-status"));
    const running = s.state === "running";
    const processed = s.completed + s.failed + s.skipped;
    $("#refresh-all").disabled = running;
    $("#refresh-all").textContent = running
      ? "↻ 전체 갱신 중…"
      : "↻ 전체 새로고침";
    $("#refresh-all-status").textContent =
      s.state === "idle"
        ? ""
        : running
          ? `갱신 중 ${processed}/${s.total} · ${s.current || "준비 중"}`
          : `${s.failed ? "일부 갱신 실패" : "갱신 완료"} · 성공 ${s.completed}개${s.failed ? ` · 실패 ${s.failed}개` : ""}${s.skipped ? ` · 제외 ${s.skipped}개 (미연결·작업 중 등)` : ""} · ${new Date(s.finishedAt).toLocaleTimeString("ko-KR")}`;
    $("#refresh-all-progress").hidden = !running;
    $("#refresh-all-progress").max = s.total || 1;
    $("#refresh-all-progress").value = processed;
    if (running) batchTimer = setTimeout(() => updateBatchStatus(), 1500);
  } catch (e) {
    $("#refresh-all-status").textContent =
      "갱신 상태를 확인할 수 없습니다. 다시 확인 중…";
    batchTimer = setTimeout(() => updateBatchStatus(), 3000);
  }
}
$("#refresh-all").onclick = async () => {
  $("#refresh-all").disabled = true;
  try {
    await updateBatchStatus(await request("/api/projects/refresh", {}));
  } catch (e) {
    error(e.message);
    $("#refresh-all").disabled = false;
  }
};
function renderProject(project) {
  if (project.id !== selected) return;
  $("#workspace").hidden = false;
  $("#project-name").textContent = project.name || project.goal;
  $("#project-goal").textContent = project.goal;
  $("#project-folder").textContent =
    project.folder || "기존 프로젝트 · 폴더 미지정";
  if (editingProject !== project.id) {
    $("#edit-name").value = project.name || project.goal.slice(0, 80);
    $("#edit-goal").value = project.goal;
    $("#edit-repository").value = project.repository || "";
    $("#edit-developer").value = project.developer || "claude";
    $("#edit-type").value = project.type;
    editingProject = project.id;
  }
  const view = JSON.stringify([
    project.messages,
    project.tasks,
    project.status,
    project.activity,
    project.phase,
    project.onHold,
  ]);
  if (view !== lastView) {
    $("#task-history").innerHTML = project.tasks
      .map(
        (t) =>
          `<details><summary>${escape(t.agent)} · ${escape(t.title)} · ${escape(t.status)}</summary><pre>${escape(t.output || "실행 중")}</pre></details>`,
      )
      .join("");
    renderChat(project);
    lastView = view;
  }
  const busy = project.status === "작업 중" || project.onHold;
  $("#project-status").textContent = project.status;
  $("#workspace")
    .querySelectorAll("button:not(#chat-form button)")
    .forEach((button) => (button.disabled = busy));
  $("#open-unity").disabled = busy || !project.unityFolder;
  $("#open-unity").hidden = project.type !== "unity";
  $('#workspace [data-action="/api/compile"]').hidden =
    project.type !== "unity";
  $('#workspace [data-action="/api/compile"]').disabled =
    busy || !project.unityFolder;
  $('#workspace [data-action="/api/approve"]').disabled =
    busy ||
    project.tasks
      .filter((task) =>
        [
          "게임 제작 · Unity 컴파일",
          "Web 제작",
          "Roblox 제작",
          "랜딩페이지 제작",
        ].includes(task.title),
      )
      .at(-1)?.status !== "완료";
  $('#workspace [data-action="/api/build"]').textContent =
    project.type === "unassigned"
      ? "프로젝트 유형 설정 필요"
      : project.type === "unity"
        ? "Unity 제작 · 컴파일"
        : project.type === "roblox"
          ? "Roblox 코드 제작"
          : "Web 제작";
  $('#workspace [data-action="/api/build"]').disabled =
    busy || project.type === "unassigned";
}
async function config() {
  const data = await request("/api/config");
  if (!$("#folder").value) $("#folder").value = data.defaultFolder;
  for (const [name, status] of Object.entries(data.connections)) {
    const node = document.getElementById(name);
    if (node) node.textContent = status;
  }
  const names = {
    ANTHROPIC_API_KEY: "Claude API 키",
    V0_API_KEY: "v0 API 키",
    GEMINI_API_KEY: "Gemini API 키",
    PERPLEXITY_API_KEY: "Perplexity API 키",
    CURSOR_API_KEY: "Cursor API 키",
    NOTION_TOKEN: "Notion 통합 토큰",
    NOTION_PARENT_PAGE_ID: "Notion 상위 페이지 ID",
    STABILITY_API_KEY: "Stable Diffusion API 키",
    MESHY_API_KEY: "Meshy API 키",
  };
  const providers = {
    ANTHROPIC_API_KEY: "claude",
    V0_API_KEY: "v0",
    GEMINI_API_KEY: "gemini",
    PERPLEXITY_API_KEY: "perplexity",
    CURSOR_API_KEY: "cursor",
    NOTION_TOKEN: "notion",
    NOTION_PARENT_PAGE_ID: "notion",
    STABILITY_API_KEY: "stability",
    MESHY_API_KEY: "meshy",
  };
  for (const provider of new Set(Object.values(providers))) {
    const fields = $(`[data-provider-fields="${provider}"]`);
    const drafts = Object.fromEntries(
      [...fields.querySelectorAll("input")].map((input) => [
        input.name,
        input.value,
      ]),
    );
    fields.innerHTML = data.settings
      .filter((field) => providers[field.key] === provider)
      .map(
        (field) =>
          `<label>${escape(names[field.key])}<input form="settings-form" name="${escape(field.key)}" type="password" autocomplete="off" placeholder="${field.configured ? "저장됨 · 변경할 때 입력" : "미설정"}"></label>`,
      )
      .join("");
    fields.querySelectorAll("input").forEach((input) => {
      input.value = drafts[input.name] || "";
    });
  }
}
$("#marketing-projects").onclick = async (event) => {
  const button = event.target.closest("[data-marketing]");
  if (!button) return;
  reportId = button.dataset.marketing;
  await $("#chat-toggle").onclick();
  $("#chat-input").value =
    "이 프로젝트의 마케팅 목표와 대상 고객, 홍보 채널, 실행 계획을 함께 정리해줘.";
  $("#chat-input").focus();
};
$("#form").onsubmit = async (event) => {
  event.preventDefault();
  error("");
  $("#submit").disabled = true;
  try {
    const p = await request("/api/projects", {
      name: $("#name").value,
      goal: $("#goal").value,
      folder: $("#folder").value,
      type: $("#type").value,
      developer: $("#developer").value,
      repository: $("#repository").value,
    });
    routeProject(p.id);
  } catch (e) {
    error(e.message);
  } finally {
    $("#submit").disabled = false;
  }
};
$("#choose-folder").onclick = async (event) => {
  event.target.disabled = true;
  try {
    const result = await request("/api/folder", {});
    if (result.folder) $("#folder").value = result.folder;
  } catch (e) {
    error(e.message);
  } finally {
    event.target.disabled = false;
  }
};
$("#projects").addEventListener(
  "toggle",
  (event) => {
    if (
      event.target.isConnected &&
      event.target instanceof HTMLDetailsElement
    ) {
      const key = expansionKey(event.target);
      if (key) expansionPreferences.set(key, event.target.open);
    }
    if (event.target.matches(".project-accordion") && event.target.open)
      reportId = event.target.dataset.project;
  },
  true,
);
const favoritesOnlyPreferences = createComparisonPreference(
  comparisonStorage,
  "favoritesOnly",
);
const updatesOnlyPreferences = createComparisonPreference(
  comparisonStorage,
  "updatesOnly",
);
const seenUpdates = createComparisonPreference(comparisonStorage, "seenUpdate");
const approvalOnlyPreferences = createComparisonPreference(
  comparisonStorage,
  "approvalOnly",
);
function applyProjectNameSearch() {
  applyProjectSort();
  const query = $("#project-name-query").value.trim();
  const favoritesOnly =
    favoritesOnlyPreferences.get("project-list:" + location.pathname) === true;
  $("#favorites-only").setAttribute("aria-pressed", String(favoritesOnly));
  const approvalOnly =
    approvalOnlyPreferences.get("project-list:" + location.pathname) === true;
  $("#approval-only").setAttribute("aria-pressed", String(approvalOnly));
  const updatesOnly =
    updatesOnlyPreferences.get("project-list:" + location.pathname) === true;
  $("#updates-only").setAttribute("aria-pressed", String(updatesOnly));
  const type =
    projectTypePreferences.get("project-list:" + location.pathname) || "all";
  document
    .querySelectorAll("[data-project-type-filter]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.projectTypeFilter === type),
      ),
    );
  const cards = [...document.querySelectorAll("#projects .project-accordion")];
  const typeCounts = { all: 0, unity: 0, web: 0, roblox: 0 };
  let matched = 0;
  let favoriteCount = 0;
  let approvalCount = 0;
  let updatesCount = 0;
  for (const card of cards) {
    const p = projects.find((project) => project.id === card.dataset.project);
    const parts = searchParts(p?.name || p?.goal || "", query);
    const matchesName = !query || parts.some((part) => part.match);
    const needsApproval = projectSummary(p || {}).ready;
    const matchesApproval = !approvalOnly || needsApproval;
    const hasUpdate = hasNewProjectUpdate(p, seenUpdates.get(p?.id));
    const matchesUpdate = !updatesOnly || hasUpdate;
    card.querySelector("[data-read-update]").hidden = !hasUpdate;
    if (
      matchesName &&
      matchesApproval &&
      matchesUpdate &&
      (type === "all" || p?.type === type) &&
      projectFavorites.get(p?.id) === true
    )
      favoriteCount++;
    const matchesFavorite =
      !favoritesOnly || projectFavorites.get(p?.id) === true;
    if (
      matchesName &&
      matchesFavorite &&
      matchesUpdate &&
      (type === "all" || p?.type === type) &&
      needsApproval
    )
      approvalCount++;
    if (
      matchesName &&
      matchesFavorite &&
      matchesApproval &&
      (type === "all" || p?.type === type) &&
      hasUpdate
    )
      updatesCount++;
    if (matchesName && matchesFavorite && matchesApproval && matchesUpdate) {
      typeCounts.all++;
      if (["unity", "web", "roblox"].includes(p?.type)) typeCounts[p.type]++;
    }
    card.hidden =
      !matchesName ||
      !matchesFavorite ||
      !matchesApproval ||
      !matchesUpdate ||
      (type !== "all" && p?.type !== type);
    card.querySelector(".project-identity strong").innerHTML = parts
      .map((part) =>
        part.match
          ? '<mark class="search-match project-name-match">' +
            escape(part.text) +
            "</mark>"
          : escape(part.text),
      )
      .join("");
    if (!card.hidden) matched++;
  }
  document.querySelectorAll("[data-project-type-count]").forEach((node) => {
    node.textContent = typeCounts[node.dataset.projectTypeCount];
  });
  $("#favorites-only-count").textContent = favoriteCount;
  $("#approval-only-count").textContent = approvalCount;
  $("#updates-only-count").textContent = updatesCount;
  $("#read-visible-updates").disabled = updatesCount === 0;
  const filtered =
    !!query || type !== "all" || favoritesOnly || approvalOnly || updatesOnly;
  $("#count").textContent = filtered
    ? `${matched} / ${cards.length}개`
    : `${cards.length}개`;
  $("#project-search-status").textContent = filtered
    ? `${matched}개 표시 · 펼치기·접기는 표시된 프로젝트에만 적용`
    : "";
  $("#project-search-empty").hidden = !filtered || matched > 0;
  $("#clear-project-name").disabled = !$("#project-name-query").value.length;
  $("#reset-project-filters").disabled =
    !$("#project-name-query").value.length &&
    type === "all" &&
    !favoritesOnly &&
    !approvalOnly &&
    !updatesOnly;
  $("#expand-projects").disabled = !matched;
  $("#collapse-projects").disabled = !matched;
}
function applyProjectSort() {
  const favoriteOrder =
    favoriteOrders.get("project-list:" + location.pathname) || [];
  $("#reset-favorite-order").disabled = favoriteOrder.length === 0;
  const order =
    projectSortPreferences.get("project-list:" + location.pathname) || "recent";
  $("#project-sort").value = order;
  const direction =
    projectSortDirections.get("project-list:" + location.pathname) ||
    (order === "name" ? "asc" : "desc");
  $("#project-sort-direction").value = direction;
  const container = $("#projects");
  const cards = [...container.querySelectorAll(".project-accordion")];
  const byId = new Map(cards.map((card) => [card.dataset.project, card]));
  const favorites = new Set(
    projects
      .filter((project) => projectFavorites.get(project.id))
      .map((project) => project.id),
  );
  for (const card of cards) {
    const selected = favorites.has(card.dataset.project);
    const button = card.querySelector("[data-favorite]");
    const name =
      projects.find((project) => project.id === card.dataset.project)?.name ||
      "프로젝트";
    button.textContent = selected ? "★" : "☆";
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute(
      "aria-label",
      name + (selected ? " 즐겨찾기 해제" : " 즐겨찾기 추가"),
    );
    button.title = selected ? "즐겨찾기 해제" : "즐겨찾기 추가";
    card.classList.toggle("is-favorite", selected);
    card.querySelector(".favorite-drag").hidden = !selected;
  }
  const sorted = sortProjects(
    projects.filter((project) => byId.has(project.id)),
    order,
    direction,
    favorites,
    favoriteOrder,
  );
  if (
    sorted.some(
      (project, index) => cards[index]?.dataset.project !== project.id,
    )
  ) {
    for (const project of sorted) container.append(byId.get(project.id));
  }
}
function startUndoCountdown(button, label, expiresAt, onExpire) {
  const duration = Math.max(1, expiresAt - Date.now());
  let timer;
  let lastLabel;
  let pausedRemaining = null;
  let finished = false;
  const remaining = () =>
    pausedRemaining ?? Math.max(0, expiresAt - Date.now());
  button.hidden = false;
  button.disabled = false;
  button.classList.add("undo-timed");
  button.classList.remove("undo-expiring", "undo-paused");
  const tick = () => {
    const left = remaining();
    const seconds = Math.ceil(left / 1000);
    button.style.setProperty(
      "--undo-remaining",
      String(Math.max(0, Math.min(1, left / duration))),
    );
    const nextLabel = `${label} · ${pausedRemaining !== null ? "일시정지 · " : ""}${seconds}초`;
    if (nextLabel !== lastLabel) {
      button.textContent = nextLabel;
      lastLabel = nextLabel;
    }
    if (seconds > 0) {
      if (pausedRemaining === null)
        timer = setTimeout(tick, Math.min(50, remaining()));
      return;
    }
    button.disabled = true;
    finished = true;
    removeListeners();
    onExpire();
    button.classList.add("undo-expiring");
    timer = setTimeout(
      () => {
        button.hidden = true;
      },
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220,
    );
  };
  const pause = () => {
    if (finished || pausedRemaining !== null) return;
    const left = remaining();
    clearTimeout(timer);
    if (left <= 0) {
      tick();
      return;
    }
    pausedRemaining = left;
    button.classList.add("undo-paused");
    tick();
  };
  const resume = () => {
    if (finished || pausedRemaining === null) return;
    expiresAt = Date.now() + pausedRemaining;
    pausedRemaining = null;
    button.classList.remove("undo-paused");
    tick();
  };
  const removeListeners = () => {
    button.removeEventListener("mouseenter", pause);
    button.removeEventListener("mouseleave", resume);
  };
  button.addEventListener("mouseenter", pause);
  button.addEventListener("mouseleave", resume);
  tick();
  if (button.matches(":hover")) pause();
  const cancel = () => {
    finished = true;
    clearTimeout(timer);
    removeListeners();
    button.hidden = true;
    button.disabled = false;
    button.classList.remove("undo-expiring", "undo-paused");
  };
  cancel.isActive = () => !finished && remaining() > 0;
  return cancel;
}
function clearUpdateReadUndo() {
  updateReadUndoTimer?.();
  updateReadUndoTimer = null;
  updateReadUndo = null;
  $("#undo-read-updates").hidden = true;
  $("#read-updates-status").textContent = "";
}
$("#read-visible-updates").onclick = () => {
  const visibleIds = new Set(
    [
      ...$("#projects").querySelectorAll(".project-accordion:not([hidden])"),
    ].map((card) => card.dataset.project),
  );
  const snapshot = markProjectUpdatesRead(
    projects.filter((project) => visibleIds.has(project.id)),
    seenUpdates,
  );
  if (!snapshot.length) return;
  clearUpdateReadUndo();
  updateReadUndo = { snapshot, expiresAt: Date.now() + 10000 };
  $("#read-updates-status").textContent = `${snapshot.length}개 확인 완료`;
  updateReadUndoTimer = startUndoCountdown(
    $("#undo-read-updates"),
    "↶ 확인 실행 취소",
    updateReadUndo.expiresAt,
    () => {
      updateReadUndo = null;
      $("#read-updates-status").textContent = "";
    },
  );
  applyProjectNameSearch();
  $("#undo-read-updates").focus({ preventScroll: true });
};
$("#undo-read-updates").onclick = () => {
  if (!updateReadUndo || !updateReadUndoTimer?.isActive()) {
    clearUpdateReadUndo();
    return;
  }
  undoProjectUpdatesRead(updateReadUndo.snapshot, seenUpdates);
  clearUpdateReadUndo();
  applyProjectNameSearch();
  $("#project-view-status").textContent =
    "업데이트 확인 상태를 복원하고 저장했습니다.";
  $("#updates-only").focus({ preventScroll: true });
};
function clearFavoriteOrderUndo() {
  favoriteOrderUndoTimer?.();
  favoriteOrderUndoTimer = null;
  favoriteOrderUndo = null;
  $("#undo-favorite-order").hidden = true;
}
$("#undo-favorite-order").onclick = () => {
  const snapshot = favoriteOrderUndo;
  if (
    !snapshot ||
    snapshot.path !== location.pathname ||
    !favoriteOrderUndoTimer?.isActive()
  ) {
    clearFavoriteOrderUndo();
    return;
  }
  favoriteOrders.set("project-list:" + snapshot.path, snapshot.order);
  clearFavoriteOrderUndo();
  applyProjectSort();
  $("#project-view-status").textContent =
    "이전 즐겨찾기 순서로 복원하고 저장했습니다.";
  $("#reset-favorite-order").focus({ preventScroll: true });
  saveViewPosition();
};
$("#reset-favorite-order").onclick = () => {
  const key = "project-list:" + location.pathname;
  const previousOrder = favoriteOrders.get(key) || [];
  if (!previousOrder.length) return;
  clearFavoriteOrderUndo();
  favoriteOrderUndo = {
    path: location.pathname,
    order: [...previousOrder],
    expiresAt: Date.now() + 10000,
  };
  favoriteOrders.set(key, []);
  favoriteOrderUndoTimer = startUndoCountdown(
    $("#undo-favorite-order"),
    "↶ 실행 취소",
    favoriteOrderUndo.expiresAt,
    () => {
      favoriteOrderUndo = null;
    },
  );
  applyProjectSort();
  $("#project-view-status").textContent =
    "즐겨찾기 순서를 초기화했습니다. 10초 동안 실행 취소할 수 있습니다.";
  saveViewPosition();
};
$("#project-sort").onchange = (event) => {
  projectSortPreferences.set(
    "project-list:" + location.pathname,
    event.target.value,
  );
  applyProjectSort();
};
$("#project-sort-direction").onchange = (event) => {
  projectSortDirections.set(
    "project-list:" + location.pathname,
    event.target.value,
  );
  applyProjectSort();
};
$("#updates-only").onclick = () => {
  const key = "project-list:" + location.pathname;
  updatesOnlyPreferences.set(key, !updatesOnlyPreferences.get(key));
  applyProjectNameSearch();
};
$("#approval-only").onclick = () => {
  const key = "project-list:" + location.pathname;
  approvalOnlyPreferences.set(key, !approvalOnlyPreferences.get(key));
  applyProjectNameSearch();
};
$("#favorites-only").onclick = () => {
  const key = "project-list:" + location.pathname;
  favoritesOnlyPreferences.set(key, !favoritesOnlyPreferences.get(key));
  applyProjectNameSearch();
};
$("#project-type-filters").onclick = (event) => {
  const button = event.target.closest("[data-project-type-filter]");
  if (!button) return;
  projectTypePreferences.set(
    "project-list:" + location.pathname,
    button.dataset.projectTypeFilter,
  );
  applyProjectNameSearch();
};
$("#project-name-query").addEventListener("input", (event) => {
  projectNameQueries.set(
    "project-list:" + location.pathname,
    event.target.value,
  );
  applyProjectNameSearch();
});
$("#clear-project-name").onclick = () => {
  $("#project-name-query").value = "";
  projectNameQueries.set("project-list:" + location.pathname, "");
  applyProjectNameSearch();
  $("#project-name-query").focus();
};
$("#reset-project-filters").onclick = () => {
  $("#project-name-query").value = "";
  projectNameQueries.set("project-list:" + location.pathname, "");
  projectTypePreferences.set("project-list:" + location.pathname, "all");
  favoritesOnlyPreferences.set("project-list:" + location.pathname, false);
  approvalOnlyPreferences.set("project-list:" + location.pathname, false);
  updatesOnlyPreferences.set("project-list:" + location.pathname, false);
  applyProjectNameSearch();
  $("#project-name-query").focus();
};
function setAllProjectsExpanded(open) {
  const cards = [
    ...document.querySelectorAll("#projects .project-accordion:not([hidden])"),
  ];
  if (!cards.length) return;
  cancelPositionRestore();
  for (const card of cards) {
    if (!open) {
      card.querySelectorAll("details").forEach((detail) => {
        detail.open = false;
        const key = expansionKey(detail);
        if (key) expansionPreferences.set(key, false);
      });
    }
    card.open = open;
    expansionPreferences.set(expansionKey(card), open);
  }
  $("#project-view-status").textContent =
    `${cards.length}개 프로젝트를 ${open ? "펼쳤습니다" : "하위 기록까지 모두 접었습니다"}.`;
  requestAnimationFrame(saveViewPosition);
}
$("#expand-projects").onclick = () => setAllProjectsExpanded(true);
$("#collapse-projects").onclick = () => setAllProjectsExpanded(false);
function saveFavoriteMove(source, target, after) {
  const ids = [
    ...$("#projects").querySelectorAll(".project-accordion.is-favorite"),
  ].map((card) => card.dataset.project);
  if (!ids.includes(source) || !ids.includes(target)) return;
  clearFavoriteOrderUndo();
  favoriteOrders.set(
    "project-list:" + location.pathname,
    moveFavoriteOrder(ids, source, target, after),
  );
  applyProjectSort();
  $("#project-view-status").textContent = "즐겨찾기 순서를 저장했습니다.";
  saveViewPosition();
}
function clearFavoriteDrag() {
  draggedFavorite = null;
  $("#projects")
    .querySelectorAll(".drop-before, .drop-after, .is-dragging")
    .forEach((card) =>
      card.classList.remove("drop-before", "drop-after", "is-dragging"),
    );
}
$("#projects").addEventListener("dragstart", (event) => {
  const handle = event.target.closest(".favorite-drag");
  if (!handle || handle.hidden) return;
  const card = handle.closest(".project-accordion");
  draggedFavorite = card.dataset.project;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedFavorite);
  card.classList.add("is-dragging");
});
$("#projects").addEventListener("dragover", (event) => {
  if (!draggedFavorite) return;
  $("#projects")
    .querySelectorAll(".drop-before, .drop-after")
    .forEach((card) => card.classList.remove("drop-before", "drop-after"));
  const card = event.target.closest(
    ".project-accordion.is-favorite:not([hidden])",
  );
  if (!card || card.dataset.project === draggedFavorite) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  const rect = card.querySelector("summary").getBoundingClientRect();
  card.classList.add(
    event.clientY > rect.top + rect.height / 2 ? "drop-after" : "drop-before",
  );
});
$("#projects").addEventListener("drop", (event) => {
  if (!draggedFavorite) return;
  event.preventDefault();
  const card = event.target.closest(
    ".project-accordion.is-favorite:not([hidden])",
  );
  if (card && card.dataset.project !== draggedFavorite) {
    const rect = card.querySelector("summary").getBoundingClientRect();
    saveFavoriteMove(
      draggedFavorite,
      card.dataset.project,
      event.clientY > rect.top + rect.height / 2,
    );
  }
  clearFavoriteDrag();
});
$("#projects").addEventListener("dragend", clearFavoriteDrag);
$("#projects").addEventListener("keydown", (event) => {
  const handle = event.target.closest(".favorite-drag");
  if (!handle || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const cards = [
    ...$("#projects").querySelectorAll(
      ".project-accordion.is-favorite:not([hidden])",
    ),
  ];
  const source = handle.closest(".project-accordion");
  const down = event.key === "ArrowDown";
  const target = cards[cards.indexOf(source) + (down ? 1 : -1)];
  if (target)
    saveFavoriteMove(source.dataset.project, target.dataset.project, down);
  handle.focus({ preventScroll: true });
});
$("#projects").onclick = async (event) => {
  const readUpdate = event.target.closest("[data-read-update]");
  if (readUpdate) {
    clearUpdateReadUndo();
    const p = projects.find(
      (project) => project.id === readUpdate.dataset.readUpdate,
    );
    if (p) seenUpdates.set(p.id, projectUpdateKey(p));
    applyProjectNameSearch();
    $("#updates-only").focus({ preventScroll: true });
    return;
  }
  if (event.target.closest(".favorite-drag")) {
    event.preventDefault();
    return;
  }
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    event.preventDefault();
    const id = favorite.dataset.favorite;
    projectFavorites.set(id, !projectFavorites.get(id));
    applyProjectNameSearch();
    if (favorite.closest(".project-accordion").hidden) {
      $("#favorites-only").focus({ preventScroll: true });
    } else {
      favorite.focus({ preventScroll: true });
    }
    return;
  }
  const clearSearch = event.target.closest(
    "[data-search-clear], [data-search-reset]",
  );
  if (clearSearch) {
    const panel = clearSearch.closest("[data-compare-project]");
    comparisonQueries.set(panel.dataset.compareProject, "");
    if (clearSearch.hasAttribute("data-search-reset")) {
      comparisonFilters.set(panel.dataset.compareProject, "all");
      panel.querySelectorAll("[data-change-filter]").forEach((button) => {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.changeFilter === "all"),
        );
      });
    }
    const input = panel.querySelector("[data-change-search]");
    input.value = "";
    applyChangeSearch(panel);
    input.focus();
    return;
  }
  const filterButton = event.target.closest("[data-change-filter]");
  if (filterButton) {
    const panel = filterButton.closest("[data-compare-project]");
    const filter = filterButton.dataset.changeFilter;
    comparisonFilters.set(panel.dataset.compareProject, filter);
    panel
      .querySelectorAll("[data-change-filter]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.changeFilter === filter),
        ),
      );
    applyChangeSearch(panel);
    return;
  }
  const refreshButton = event.target.closest("[data-refresh-repository]");
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = "갱신 중…";
    try {
      const result = await request("/api/project/refresh", {
        id: refreshButton.dataset.refreshRepository,
      });
      if (result.sync?.state === "error") error(result.sync.error);
    } catch (e) {
      error(e.message);
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = "↻ 새로고침";
      await refresh();
    }
    return;
  }
  const hold = event.target.closest("[data-hold]");
  if (hold) {
    hold.disabled = true;
    try {
      const p = projects.find((p) => p.id === hold.dataset.hold);
      await request("/api/project/hold", { id: p.id, onHold: !p.onHold });
      await refresh();
    } catch (e) {
      error(e.message);
      hold.disabled = false;
    }
    return;
  }
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  button.disabled = true;
  try {
    await request("/api/project/delete", { id: button.dataset.delete });
    if (reportId === button.dataset.delete) reportId = null;
    await refresh();
  } catch (e) {
    error(e.message);
    button.disabled = false;
  }
};
$("#deleted-project-list").onclick = async (event) => {
  const button = event.target.closest("[data-restore]");
  if (!button) return;
  button.disabled = true;
  try {
    await request("/api/project/restore", { id: button.dataset.restore });
    await refresh();
  } catch (e) {
    error(e.message);
    button.disabled = false;
  }
};
$("#chat-form").onsubmit = async (event) => {
  event.preventDefault();
  error("");
  $("#chat-error").textContent = "";
  const sendButton = $("#chat-form button");
  sendButton.disabled = true;
  try {
    await request("/api/chat", {
      id: chatId,
      message: $("#chat-input").value,
    });
    $("#chat-input").value = "";
    await refresh();
  } catch (e) {
    $("#chat-error").textContent = e.message;
  } finally {
    sendButton.disabled = false;
  }
};
$("#project-settings").onsubmit = async (event) => {
  event.preventDefault();
  error("");
  try {
    await request("/api/project/update", {
      id: selected,
      name: $("#edit-name").value,
      goal: $("#edit-goal").value,
      repository: $("#edit-repository").value,
      developer: $("#edit-developer").value,
      type: $("#edit-type").value,
    });
    await refresh();
  } catch (e) {
    error(e.message);
  }
};
$("#workspace").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  button.disabled = true;
  error("");
  try {
    await request(button.dataset.action, {
      id: selected,
      prompt: $("#asset-prompt").value,
    });
    await refresh();
  } catch (e) {
    error(e.message);
  } finally {
    button.disabled = false;
  }
});
$("#settings-form").onsubmit = async (event) => {
  event.preventDefault();
  error("");
  const inputs = [
    ...(event.submitter?.closest(".ai-card") || document).querySelectorAll(
      'input[form="settings-form"]',
    ),
  ];
  const values = Object.fromEntries(
    inputs
      .map((input) => [input.name, input.value])
      .filter(([, value]) => value.trim())
      .map(([key, value]) => [key, value.trim()]),
  );
  try {
    await request("/api/settings", values);
    inputs.forEach((input) => {
      input.value = "";
    });
    await config();
    $("#settings-status").textContent = "로컬 설정 저장 완료";
  } catch (e) {
    error(e.message);
  }
};
document.querySelectorAll("[data-check]").forEach(
  (button) =>
    (button.onclick = async () => {
      button.disabled = true;
      $("#settings-status").textContent = "연결 확인 중…";
      try {
        const result = await request("/api/check", {
          provider: button.dataset.check,
        });
        $("#settings-status").textContent = result.message;
        await config();
      } catch (e) {
        $("#settings-status").textContent = e.message;
      } finally {
        button.disabled = false;
      }
    }),
);
config().catch((e) => error(e.message));
routeProject(selected, false);
setInterval(() => {
  if (!selected) refresh().catch((e) => error(e.message));
}, 10000);

function renderChat(project) {
  if (project.id !== chatId) return;
  const view = JSON.stringify([
    project.messages,
    project.activity,
    project.phase,
    project.status,
    project.onHold,
  ]);
  if (view === lastChatView) return;
  lastChatView = view;
  const messages = $("#messages");
  const followChat =
    messages.scrollHeight - messages.scrollTop - messages.clientHeight < 90;
  $("#messages").innerHTML =
    (project.messages || [])
      .map(
        (m) =>
          `<div class="message"><strong>${escape(m.role)}</strong><pre>${escape(m.text)}</pre></div>`,
      )
      .join("") ||
    '<div class="empty">목표를 구체화하거나 바로 제작을 시작하세요.</div>';
  if (followChat) messages.scrollTop = messages.scrollHeight;
  const feed = $("#team-feed");
  const follow = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 90;
  feed.innerHTML =
    (project.activity || [])
      .map(
        (item) =>
          '<article class="team-event ' +
          (item.from === "우찬" ? "mine " : "") +
          escape(item.kind) +
          '"><div class="event-route"><strong>' +
          escape(item.from) +
          (item.to ? " <span>→</span> " + escape(item.to) : "") +
          "</strong><time>" +
          escape(
            new Date(item.at).toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
          ) +
          "</time></div><p>" +
          escape(item.text) +
          "</p>" +
          (item.detail
            ? '<div class="chat-body"><pre>' +
              escape(item.detail) +
              "</pre></div>"
            : "") +
          "</article>",
      )
      .join("") ||
    '<div class="empty">팀 채팅방입니다. 목표와 첫 지시를 남겨주세요.</div>';
  if (follow) feed.scrollTop = feed.scrollHeight;
  $("#chat-input").disabled = !!project.onHold;
  $("#chat-form button").disabled = !!project.onHold;
  $("#current-work").textContent = project.onHold
    ? "보류 중 · 보류 해제 후 지시할 수 있습니다."
    : project.phase
      ? project.phase.agent + " · " + project.phase.title
      : "현재 진행 중인 작업 없음";
  $("#current-work").classList.toggle("working", project.status === "작업 중");
}

function compactSummary(text, key) {
  const full = text || "저장된 요약 없음";
  const sentence = full.split(/(?<=[.!?])\s+/)[0];
  const preview =
    sentence.length > 160 ? sentence.slice(0, 157) + "…" : sentence;
  return (
    '<p class="summary-lead">' +
    escape(preview) +
    "</p>" +
    (preview !== full
      ? '<details class="summary-more" data-history-key="' +
        escape(key) +
        '"><summary>전체 요약 보기</summary><p>' +
        escape(full) +
        "</p></details>"
      : "")
  );
}

function applyChangeSearch(panel) {
  const input = panel.querySelector("[data-change-search]");
  if (!input) return;
  const query = comparisonQueries.get(panel.dataset.compareProject) || "";
  const filter =
    panel.querySelector('[data-change-filter][aria-pressed="true"]')?.dataset
      .changeFilter || "all";
  let count = 0;
  const counts = { added: 0, modified: 0, removed: 0, other: 0 };
  panel.querySelectorAll("[data-change-group]").forEach((group) => {
    let matched = 0;
    group.querySelectorAll("[data-change-text]").forEach((item) => {
      const parts = searchParts(item.dataset.changeText, query);
      item.hidden = !!query.trim() && !parts.some((part) => part.match);
      item.innerHTML = parts
        .map((part) =>
          part.match
            ? '<mark class="search-match">' + escape(part.text) + "</mark>"
            : escape(part.text),
        )
        .join("");
      if (!item.hidden) matched++;
    });
    counts[group.dataset.changeGroup] = matched;
    group.hidden =
      !matched || (filter !== "all" && filter !== group.dataset.changeGroup);
    if (!group.hidden) count += matched;
  });
  panel.querySelectorAll("[data-change-count]").forEach((node) => {
    node.textContent = counts[node.dataset.changeCount] || 0;
  });
  const labels = {
    all: "전체",
    added: "추가",
    modified: "수정",
    removed: "삭제",
    other: "기타",
  };
  panel.querySelector(".filter-status").textContent =
    labels[filter] + " · " + count + (query.trim() ? "건 검색됨" : "건 표시");
  const empty = panel.querySelector(".filter-empty");
  empty.hidden = count > 0;
  empty.textContent = query.trim()
    ? "검색어와 선택한 필터에 맞는 변경 내용이 없습니다."
    : "선택한 종류의 변경 내용이 없습니다.";
  panel.querySelector("[data-search-clear]").disabled = !query.length;
  panel.querySelector("[data-search-reset]").disabled =
    !query.length && filter === "all";
}

$("#projects").addEventListener("input", (event) => {
  if (!event.target.matches("[data-change-search]")) return;
  const panel = event.target.closest("[data-compare-project]");
  comparisonQueries.set(panel.dataset.compareProject, event.target.value);
  applyChangeSearch(panel);
});

function comparisonResultHtml(p, selection) {
  const result = compareHistory(
    p.repositoryHistory || [],
    selection.from,
    selection.to,
  );
  if (result.error)
    return (
      '<p class="comparison-hint" role="status">' +
      escape(result.error) +
      "</p>"
    );
  const snapshot = (label, entry) =>
    '<div class="comparison-snapshot"><small>' +
    label +
    "</small><h4>" +
    escape(entry.stage || "진행 상태") +
    "</h4>" +
    compactSummary(
      entry.summary,
      p.id + ":snapshot:" + label + ":" + entry.commit,
    ) +
    "<code>" +
    escape(entry.commit.slice(0, 8)) +
    "</code></div>";
  const categories = [
    { type: "added", label: "추가된 기능", short: "추가", icon: "+" },
    { type: "modified", label: "수정된 내용", short: "수정", icon: "↻" },
    { type: "removed", label: "삭제된 내용", short: "삭제", icon: "−" },
    { type: "other", label: "기타 · 분류 확인", short: "기타", icon: "•" },
  ];
  const groupItems = (category) =>
    result.categorized.filter((item) => item.type === category.type);
  const visibleCategories = categories.filter(
    (category) => category.type !== "other" || groupItems(category).length,
  );
  let activeFilter = comparisonFilters.get(p.id) || "all";
  if (
    activeFilter !== "all" &&
    !visibleCategories.some((category) => category.type === activeFilter)
  ) {
    activeFilter = "all";
    comparisonFilters.set(p.id, activeFilter);
  }
  const shownCount = result.categorized.filter(
    (item) => activeFilter === "all" || item.type === activeFilter,
  ).length;
  const filterLabel =
    categories.find((category) => category.type === activeFilter)?.short ||
    "전체";
  const stats =
    '<div class="change-stats">' +
    visibleCategories
      .map(
        (category) =>
          '<button type="button" class="change-stat change-' +
          category.type +
          '" data-change-filter="' +
          category.type +
          '" data-filter-label="' +
          category.short +
          '" aria-pressed="' +
          (activeFilter === category.type) +
          '"><span><b aria-hidden="true">' +
          category.icon +
          "</b> " +
          category.short +
          '</span><strong><span data-change-count="' +
          category.type +
          '">' +
          groupItems(category).length +
          "</span><small>건</small></strong></button>",
      )
      .join("") +
    "</div>";
  const grouped =
    '<div class="change-groups">' +
    visibleCategories
      .filter((category) => groupItems(category).length)
      .map(
        (category) =>
          '<section class="change-group change-' +
          category.type +
          '" data-change-group="' +
          category.type +
          '" ' +
          (activeFilter !== "all" && activeFilter !== category.type
            ? "hidden"
            : "") +
          '><h5><span class="change-badge">' +
          category.icon +
          " " +
          category.short +
          "</span>" +
          category.label +
          "</h5><ul>" +
          groupItems(category)
            .map(
              (item) =>
                '<li data-change-text="' +
                escape(item.text) +
                '">' +
                escape(item.text) +
                "</li>",
            )
            .join("") +
          "</ul></section>",
      )
      .join("") +
    "</div>";
  return (
    '<div class="comparison-snapshots">' +
    snapshot("시작 시점", result.before) +
    snapshot("종료 시점", result.after) +
    "</div>" +
    '<div class="comparison-changes"><h4>기간 중 변경 내용 <span>' +
    result.count +
    "회 갱신</span></h4>" +
    '<div class="change-search"><label><span>변경 내용 검색</span><input type="search" data-change-search maxlength="200" placeholder="검색어 입력 · 예: 로그인, 화면, 저장" value="' +
    escape(comparisonQueries.get(p.id) || "") +
    '"></label><button type="button" data-search-clear>검색 지우기</button></div>' +
    '<div class="change-filter-toolbar"><button type="button" class="filter-all" data-change-filter="all" aria-pressed="' +
    (activeFilter === "all") +
    '">전체 보기</button><span class="filter-status" role="status">' +
    filterLabel +
    " · " +
    shownCount +
    '건 표시</span><button type="button" class="search-reset" data-search-reset title="검색어와 종류 필터 초기화">전체 초기화</button></div>' +
    stats +
    '<p class="filter-empty" ' +
    (shownCount ? "hidden" : "") +
    ">선택한 종류의 변경 내용이 없습니다.</p>" +
    (result.changes.length
      ? grouped
      : "<p>이 구간에 저장된 변경 요약이 없습니다. 위의 두 시점 요약을 참고해주세요.</p>") +
    (result.incomplete
      ? '<p class="comparison-hint">일부 기록의 커밋 비교가 없어 변경 내역이 완전하지 않을 수 있습니다.</p>'
      : "") +
    '<p class="comparison-hint">저장된 변경 기록을 모아 보여줍니다. 중간에 추가 후 취소된 내용도 포함될 수 있습니다.</p>' +
    (result.compareUrl
      ? '<a class="comparison-link" href="' +
        escape(result.compareUrl) +
        '" target="_blank" rel="noopener noreferrer">GitHub에서 실제 코드 차이 보기 ↗</a>'
      : "") +
    "</div>"
  );
}

function historyComparisonHtml(p) {
  const entries = [...(p.repositoryHistory || [])].sort(
    (a, b) => new Date(a.checkedAt) - new Date(b.checkedAt),
  );
  if (entries.length < 2)
    return '<div class="history-comparison"><h4>날짜별 비교</h4><p class="comparison-hint">기록이 2개 이상 쌓이면 두 날짜를 선택해 비교할 수 있습니다.</p></div>';
  const selection = restoreHistorySelection(
    entries,
    historySelections.get(p.id),
  );
  historySelections.set(p.id, selection);
  const selector = (label, side) =>
    "<label>" +
    label +
    '<select data-compare-side="' +
    side +
    '">' +
    entries
      .map(
        (entry) =>
          '<option value="' +
          escape(historyKey(entry)) +
          '" ' +
          (selection[side] === historyKey(entry) ? "selected" : "") +
          ">" +
          escape(
            new Date(entry.checkedAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            }),
          ) +
          " · " +
          escape(entry.commit.slice(0, 7)) +
          "</option>",
      )
      .join("") +
    "</select></label>";
  return (
    '<section class="history-comparison" data-compare-project="' +
    escape(p.id) +
    '"><div class="comparison-heading"><h4>날짜별 비교</h4><span>두 시점 사이의 변화</span></div><div class="comparison-selectors">' +
    selector("시작 날짜", "from") +
    selector("종료 날짜", "to") +
    '</div><div class="comparison-result" aria-live="polite">' +
    comparisonResultHtml(p, selection) +
    "</div></section>"
  );
}

$("#projects").addEventListener("change", (event) => {
  if (!event.target.matches("[data-compare-side]")) return;
  const panel = event.target.closest("[data-compare-project]");
  const p = projects.find(
    (project) => project.id === panel.dataset.compareProject,
  );
  if (!p) return;
  const selection = {
    from: panel.querySelector('[data-compare-side="from"]').value,
    to: panel.querySelector('[data-compare-side="to"]').value,
  };
  historySelections.set(p.id, selection);
  panel.querySelector(".comparison-result").innerHTML = comparisonResultHtml(
    p,
    selection,
  );
  applyChangeSearch(panel);
});

function repositoryHistoryHtml(p) {
  const entries = [...(p.repositoryHistory || [])].sort(
    (a, b) => new Date(b.checkedAt) - new Date(a.checkedAt),
  );
  const groups = new Map();
  for (const entry of entries) {
    const date = new Date(entry.checkedAt).toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(entry);
  }
  return (
    '<details class="repository-history" data-history-key="' +
    escape(p.id + ":history") +
    '"><summary>이전 변경 기록 <span>' +
    entries.length +
    "건</span></summary>" +
    '<p class="notice">갱신 확인일 기준 · 한국 시간</p>' +
    historyComparisonHtml(p) +
    ([...groups]
      .map(
        ([date, items]) =>
          '<details class="history-day" data-history-key="' +
          escape(p.id + ":" + date) +
          '"><summary>' +
          escape(date) +
          " <span>" +
          items.length +
          "건</span></summary>" +
          items
            .map(
              (entry) =>
                '<article class="history-entry"><small>' +
                escape(
                  new Date(entry.checkedAt).toLocaleTimeString("ko-KR", {
                    timeZone: "Asia/Seoul",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                ) +
                " · " +
                escape(entry.commit.slice(0, 8)) +
                "</small><h4>" +
                escape(entry.stage || "진행 요약") +
                "</h4>" +
                (entry.changeReport?.state === "changed"
                  ? "<ul>" +
                    entry.changeReport.items
                      .map((item) => "<li>" + escape(item) + "</li>")
                      .join("") +
                    "</ul>"
                  : '<p class="notice">' +
                    (entry.changeReport?.state === "unavailable"
                      ? "커밋 비교 불가 · 당시 진행 요약"
                      : "저장 당시 진행 요약") +
                    "</p>") +
                compactSummary(
                  entry.summary,
                  p.id + ":history-summary:" + entry.commit,
                ) +
                "</article>",
            )
            .join("") +
          "</details>",
      )
      .join("") ||
      '<p class="notice">아직 기록이 없습니다. 새로고침하면 현재 요약부터 보관합니다.</p>') +
    "</details>"
  );
}

function repositoryReportHtml(p) {
  const r = p.repositoryReport;
  const sync = p.repositorySync || {};
  const labels = {
    checking: "GitHub 변경 확인 중",
    updating: "새 커밋 분석 중",
    current: "최신 커밋 확인됨",
    error: "갱신 실패 · 기존 요약 유지",
  };
  const syncHtml = p.repository
    ? '<div class="repository-sync"><span>' +
      escape(labels[sync.state] || "자동 확인 대기") +
      '</span><button type="button" class="repository-refresh" data-refresh-repository="' +
      escape(p.id) +
      '" ' +
      (["checking", "updating"].includes(sync.state) || p.status === "작업 중"
        ? "disabled"
        : "") +
      ">" +
      (["checking", "updating"].includes(sync.state)
        ? "갱신 중…"
        : "↻ 새로고침") +
      "</button><small>서버 실행 중 약 5분마다 확인" +
      (sync.checkedAt
        ? " · 마지막 확인 " +
          escape(new Date(sync.checkedAt).toLocaleString("ko-KR"))
        : "") +
      "</small>" +
      (sync.error ? '<p role="status">' + escape(sync.error) + "</p>" : "") +
      "</div>"
    : "";
  if (!r) return syncHtml;
  const delta = r.changeReport;
  const unchanged = sync.state === "current" && sync.noChanges === true;
  const deltaHtml =
    '<section class="repository-changes"><h3>이전보다 달라진 점</h3>' +
    (unchanged
      ? '<p class="change-unchanged">이번 확인에서는 새 코드 변경이 없습니다.</p>'
      : "") +
    (delta
      ? "<small>" +
        (unchanged ? "최근 변경 기록 · " : "") +
        escape(new Date(delta.checkedAt).toLocaleString("ko-KR")) +
        "</small>" +
        (delta.state === "changed"
          ? "<ul>" +
            delta.items
              .map((item) => "<li>" + escape(item) + "</li>")
              .join("") +
            "</ul>"
          : "<p>" +
            (delta.state === "baseline"
              ? "첫 분석 결과를 저장했습니다. 다음 갱신부터 변경 내용을 비교합니다."
              : "이전 커밋과 비교할 수 없어 최신 진행 요약만 갱신했습니다.") +
            "</p>") +
        "<small>" +
        (delta.from ? escape(delta.from.slice(0, 8)) + " → " : "") +
        escape(delta.to.slice(0, 8)) +
        "</small>"
      : !unchanged
        ? "<p>다음 코드 변경이 감지되면 변경 내용을 요약합니다.</p>"
        : "") +
    "</section>";
  const list = (title, items) =>
    "<div><small>" +
    title +
    "</small><ul>" +
    items.map((x) => "<li>" + escape(x) + "</li>").join("") +
    "</ul></div>";
  return (
    syncHtml +
    deltaHtml +
    repositoryHistoryHtml(p) +
    '<details class="repository-report report-detail" data-history-key="' +
    escape(p.id + ":report") +
    '"><summary>상세 진행 보고서 <span>구현 내용 · 남은 작업 · 검증 근거</span></summary>' +
    compactSummary(r.summary, p.id + ":report-summary") +
    '<div class="repository-columns">' +
    list("구현 확인", r.implemented || []) +
    list("남은 작업 · 확인 필요", r.remaining || []) +
    '</div><p class="notice">' +
    escape(r.validation || "실행 검증은 하지 않았습니다.") +
    '</p><p class="notice">기준 커밋 ' +
    escape(r.commit?.slice(0, 8)) +
    " · " +
    escape(r.branch) +
    " · 확인 " +
    escape(new Date(r.checkedAt).toLocaleString("ko-KR")) +
    '</p><p class="notice">최근 변경: ' +
    escape(r.latestCommit || "") +
    '</p><p class="notice">' +
    escape(r.githubStatus || "") +
    "</p><details><summary>근거 파일 · 코드 위치</summary><pre>" +
    escape(
      (r.evidence || []).join("\n") +
        "\n" +
        (r.automatic ? "분석용 코드 발췌: " : "로컬 코드: ") +
        r.localPath +
        (r.sourceScope ? "\n" + r.sourceScope : ""),
    ) +
    "</pre></details></details>"
  );
}
