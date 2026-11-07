const systemHistory = [];
let systemTimer, systemRequest;
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
  if (location.pathname !== "/system" || document.hidden) return;
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
    systemText(
      "system-cpu",
      data.cpu.percent === null ? "측정 중" : data.cpu.percent.toFixed(1) + "%",
    );
    systemText("system-memory", data.memory.percent.toFixed(1) + "%");
    document.getElementById("system-cpu-bar").value = data.cpu.percent ?? 0;
    document.getElementById("system-memory-bar").value = data.memory.percent;
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
    drawSystemChart("system-cpu-chart", "cpu");
    drawSystemChart("system-memory-chart", "memory");
  } catch (error) {
    if (error.name !== "AbortError")
      systemText("system-status", "연결 재시도 중 · 마지막 측정값 표시");
  } finally {
    if (
      !controller.signal.aborted &&
      location.pathname === "/system" &&
      !document.hidden
    )
      systemTimer = setTimeout(pollSystem, 3000);
  }
}
window.addEventListener("office-route-change", pollSystem);
document.addEventListener("visibilitychange", pollSystem);
window.addEventListener("pagehide", () => {
  clearTimeout(systemTimer);
  systemRequest?.abort();
});
window.addEventListener("pageshow", pollSystem);
pollSystem();
