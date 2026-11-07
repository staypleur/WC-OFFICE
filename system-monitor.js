const systemHistory = [];
let systemTimer, systemRequest, systemFrame;
let displayed = { cpu: null, memory: null },
  tweenFrom = { ...displayed },
  tweenAt = 0;
const systemText = (id, value) => {
  document.getElementById(id).textContent = value;
};
const gib = (bytes) => (bytes / 1024 ** 3).toFixed(1) + " GB";
function drawSystemChart(id, key) {
  const cutoff = Date.now() - 180000;
  while (systemHistory[0]?.time < cutoff) systemHistory.shift();
  document.getElementById(id).setAttribute(
    "points",
    systemHistory
      .map((p, i) =>
        i === systemHistory.length - 1 ? { ...p, [key]: displayed[key] } : p,
      )
      .filter((p) => p[key] !== null)
      .map(
        (p) =>
          `${Math.max(0, ((p.time - cutoff) / 180000) * 300).toFixed(1)},${(76 - p[key] * 0.72).toFixed(1)}`,
      )
      .join(" "),
  );
}
async function pollSystem() {
  clearTimeout(systemTimer);
  systemRequest?.abort();
  if (location.pathname !== "/system" || document.hidden) {
    cancelAnimationFrame(systemFrame);
    return;
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  systemRequest = controller;
  try {
    const response = await fetch("/api/system", {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw Error("사용량을 불러오지 못했습니다.");
    const data = await response.json();
    if (controller.signal.aborted) return;
    tweenFrom = { ...displayed };
    tweenAt = Date.now();
    systemText(
      "system-memory-detail",
      gib(data.memory.used) + " 사용 / " + gib(data.memory.total),
    );
    systemText("system-model", data.cpu.model);
    systemText("system-cores", data.cpu.logicalCores + "개");
    systemText("system-ram", gib(data.memory.total));
    systemText(
      "system-os",
      (data.os.name === "Windows_NT" ? "Windows · 빌드" : data.os.name) +
        " " +
        data.os.release +
        " · " +
        data.os.architecture,
    );
    systemText(
      "system-uptime",
      Math.floor(data.uptime / 86400) +
        "일 " +
        Math.floor((data.uptime % 86400) / 3600) +
        "시간 " +
        Math.floor((data.uptime % 3600) / 60) +
        "분",
    );
    systemText(
      "system-status",
      "실시간 · " + new Date(data.sampledAt).toLocaleTimeString("ko-KR"),
    );
    systemHistory.push({
      time: Date.now(),
      cpu: data.cpu.percent,
      memory: data.memory.percent,
    });
    renderProcessRanks(data.processes);
    startSystemAnimation();
  } catch (error) {
    if (error.name !== "AbortError")
      systemText("system-status", "연결 재시도 중 · 마지막 측정값 표시");
  } finally {
    if (
      !controller.signal.aborted &&
      location.pathname === "/system" &&
      !document.hidden
    )
      systemTimer = setTimeout(
        pollSystem,
        Math.max(0, 3000 - (Date.now() - startedAt)),
      );
  }
}
window.addEventListener("office-route-change", pollSystem);
document.addEventListener("visibilitychange", pollSystem);
window.addEventListener("pagehide", () => {
  clearTimeout(systemTimer);
  cancelAnimationFrame(systemFrame);
  systemRequest?.abort();
});
window.addEventListener("pageshow", pollSystem);
pollSystem();

function startSystemAnimation() {
  cancelAnimationFrame(systemFrame);
  let lastPaint = 0;
  function frame(time) {
    if (location.pathname !== "/system" || document.hidden) return;
    if (time - lastPaint >= 32) {
      lastPaint = time;
      const target = systemHistory.at(-1);
      const t = matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 1
        : Math.min(1, (Date.now() - tweenAt) / 900);
      const ease = 1 - Math.pow(1 - t, 3);
      for (const key of ["cpu", "memory"]) {
        displayed[key] =
          target[key] === null
            ? null
            : (tweenFrom[key] ?? target[key]) +
              (target[key] - (tweenFrom[key] ?? target[key])) * ease;
        systemText(
          "system-" + key,
          displayed[key] === null ? "측정 중" : displayed[key].toFixed(1) + "%",
        );
        document.getElementById("system-" + key + "-bar").value =
          displayed[key] ?? 0;
        drawSystemChart("system-" + key + "-chart", key);
      }
    }
    systemFrame = requestAnimationFrame(frame);
  }
  systemFrame = requestAnimationFrame(frame);
}
function renderProcessRanks(data) {
  for (const key of ["cpu", "memory"]) {
    const list = document.getElementById("system-top-" + key);
    list.replaceChildren();
    const rows = data?.[key] || [];
    if (!rows.length) {
      const row = document.createElement("li");
      row.textContent = data?.error || "사용량을 측정하고 있습니다…";
      list.append(row);
    }
    for (const p of rows) {
      const row = document.createElement("li"),
        name = document.createElement("span"),
        value = document.createElement("strong");
      name.textContent = p.name + " · " + p.id;
      name.title = "프로세스 ID " + p.id;
      value.textContent =
        key === "cpu" ? p.cpu.toFixed(1) + "%" : gib(p.memory);
      row.append(name, value);
      list.append(row);
    }
  }
}
