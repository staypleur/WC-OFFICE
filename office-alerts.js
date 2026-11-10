let seen = {},
  inbox = [],
  desktop = false;
try {
  seen = JSON.parse(localStorage.getItem("office-alert-seen") || "{}");
  inbox = JSON.parse(localStorage.getItem("office-alert-inbox") || "[]");
  desktop = localStorage.getItem("office-alert-desktop") === "true";
} catch {}
const panel = document.createElement("details");
panel.className = "office-alerts";
const label = document.createElement("summary");
const items = document.createElement("div");
panel.append(label, items);
document.body.append(panel);
function draw() {
  label.textContent = `알림 · ${inbox.length}`;
  items.replaceChildren();
  if (!inbox.length) items.textContent = "새 작업 알림이 없습니다.";
  for (const entry of inbox.slice().reverse()) {
    const link = document.createElement("a");
    link.href = "/projects/" + encodeURIComponent(entry.projectId);
    link.textContent = `${entry.name} · ${entry.message} · ${new Date(entry.at).toLocaleString("ko-KR")}`;
    items.append(link);
  }
  const clear = document.createElement("button");
  clear.textContent = "알림 비우기";
  clear.onclick = () => {
    inbox = [];
    persist();
    draw();
  };
  items.append(clear);
}
function persist() {
  try {
    localStorage.setItem("office-alert-seen", JSON.stringify(seen));
    localStorage.setItem("office-alert-inbox", JSON.stringify(inbox));
  } catch {}
}
export function observeProject(p) {
  const finished = (p.tasks || []).filter(
    (t) => t.status === "완료" || t.status === "오류",
  );
  const initial = !Object.hasOwn(seen, p.id);
  const known = new Set(seen[p.id] || []);
  for (const t of finished) {
    const key = t.id + ":" + t.status;
    if (!initial && !known.has(key)) {
      const build = /제작|컴파일|복원/.test(t.title);
      const message =
        t.title +
        " · " +
        (t.status === "오류"
          ? "오류 확인 필요"
          : build
            ? "완료 · 결과 확인 필요"
            : "완료");
      const entry = {
        projectId: p.id,
        name: p.name || "프로젝트",
        message,
        at: t.finishedAt || new Date().toISOString(),
      };
      inbox.push(entry);
      inbox = inbox.slice(-30);
      if (
        desktop &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        const n = new Notification(entry.name, { body: message, tag: t.id });
        n.onclick = () => {
          window.focus();
          location.href = "/projects/" + encodeURIComponent(p.id);
          n.close();
        };
      }
    }
    known.add(key);
  }
  seen[p.id] = [...known].slice(-500);
  persist();
  draw();
}
const toggle = document.getElementById("enable-notifications");
function toggleLabel() {
  toggle.textContent = desktop ? "데스크톱 알림 끄기" : "데스크톱 알림 켜기";
}
toggle.onclick = async () => {
  if (desktop) desktop = false;
  else if ("Notification" in window)
    desktop = (await Notification.requestPermission()) === "granted";
  try {
    localStorage.setItem("office-alert-desktop", String(desktop));
  } catch {}
  document.getElementById("notification-status").textContent = desktop
    ? "사이트가 열려 있는 동안 완료·오류 알림을 보냅니다."
    : "데스크톱 알림이 꺼져 있습니다. 사이트 안 알림은 계속 표시됩니다.";
  toggleLabel();
};
toggleLabel();
draw();
