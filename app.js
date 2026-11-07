import { projectSummary } from "/project-summary.mjs";
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
      "#project-list,#projects,#deleted-projects",
      ["/", "/projects", "/projects/active", "/projects/held"],
    ],
    [
      "#project-hub",
      ["/projects", "/new", "/projects/active", "/projects/held", "room"],
    ],
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
      (["room", "/", "/new", "/projects/active", "/projects/held"].includes(
        page,
      )
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
            "</p></div><div><small>최근 결과 요약</small><p>" +
            escape(s.result) +
            "</p></div></div>" +
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

function repositoryReportHtml(p) {
  const r = p.repositoryReport;
  if (!r) return "";
  const list = (title, items) =>
    "<div><small>" +
    title +
    "</small><ul>" +
    items.map((x) => "<li>" + escape(x) + "</li>").join("") +
    "</ul></div>";
  return (
    '<section class="repository-report"><h3>GitHub 코드 분석</h3><p>' +
    escape(r.summary) +
    '</p><div class="repository-columns">' +
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
    escape((r.evidence || []).join("\n") + "\n로컬 코드: " + r.localPath) +
    "</pre></details></section>"
  );
}
