import { projectSummary } from "/project-summary.mjs";
import { compareHistory, historyKey } from "/history-compare.mjs";
const historySelections = new Map();
const comparisonFilters = new Map();
const $ = (selector) => document.querySelector(selector);
let reportId = null;
let chatId = null;
let chatStream = null;
let lastChatView = "";

function setPageVisibility(id) {
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
  selected = id;
  lastView = "";
  editingProject = null;
  if (push) history.pushState({}, "", id ? "/projects/" + id : "/");
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
  refresh().catch((e) => error(e.message));
  window.scrollTo(0, 0);
}
window.addEventListener("popstate", () =>
  routeProject(
    /^\/projects\/([a-f0-9-]+)$/.exec(location.pathname)?.[1] || null,
    false,
  ),
);
window.addEventListener("pagehide", () => {
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
  $("#count").textContent = `${visibleProjects.length}개`;
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
  if ($("#projects").dataset.view !== listView) {
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
            (openIds.has(p.id) ? "open" : "") +
            '><summary><span class="project-identity"><small>' +
            escape(type) +
            "</small><strong>" +
            escape(p.name || p.goal) +
            '</strong></span><span class="project-progress">' +
            escape(s.progress) +
            '</span><span class="accordion-arrow">⌄</span></summary><div class="project-details"><div class="report-grid"><div><small>진행 상황</small><p>' +
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
      node.open = expandedHistory.has(node.dataset.historyKey);
    });
  }
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
    if (event.target.matches(".project-accordion") && event.target.open)
      reportId = event.target.dataset.project;
  },
  true,
);
$("#projects").onclick = async (event) => {
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
    let count = 0;
    panel.querySelectorAll("[data-change-group]").forEach((group) => {
      group.hidden = filter !== "all" && group.dataset.changeGroup !== filter;
      if (!group.hidden) count += group.querySelectorAll("li").length;
    });
    panel.querySelector(".filter-empty").hidden = count > 0;
    panel.querySelector(".filter-status").textContent =
      (filter === "all" ? "전체" : filterButton.dataset.filterLabel) +
      " · " +
      count +
      "건 표시";
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
  if (!visibleCategories.some((category) => category.type === activeFilter))
    activeFilter = "all";
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
          "</span><strong>" +
          groupItems(category).length +
          "<small>건</small></strong></button>",
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
            .map((item) => "<li>" + escape(item.text) + "</li>")
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
    '<div class="change-filter-toolbar"><button type="button" class="filter-all" data-change-filter="all" aria-pressed="' +
    (activeFilter === "all") +
    '">전체 보기</button><span class="filter-status" role="status">' +
    filterLabel +
    " · " +
    shownCount +
    "건 표시</span></div>" +
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
  const selection = historySelections.get(p.id) || {
    from: historyKey(entries[0]),
    to: historyKey(entries.at(-1)),
  };
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
