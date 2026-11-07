import os from "node:os";

export function cpuUsage(previous, current) {
  const total = current.total - previous.total;
  if (total <= 0) return null;
  return (
    Math.round(
      Math.max(
        0,
        Math.min(100, (1 - (current.idle - previous.idle) / total) * 100),
      ) * 10,
    ) / 10
  );
}
function cpuTimes() {
  return os.cpus().reduce(
    (sum, cpu) => ({
      idle: sum.idle + cpu.times.idle,
      total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0),
    }),
    { idle: 0, total: 0 },
  );
}
let previous = cpuTimes();
let cpuPercent = null;
setInterval(() => {
  const current = cpuTimes();
  cpuPercent = cpuUsage(previous, current);
  previous = current;
}, 1000).unref();

export function systemSnapshot() {
  const total = os.totalmem();
  const used = total - os.freemem();
  const cpus = os.cpus();
  return {
    sampledAt: new Date().toISOString(),
    cpu: {
      model: cpus[0]?.model || "확인 불가",
      logicalCores: cpus.length,
      percent: cpuPercent,
    },
    memory: { total, used, percent: Math.round((used / total) * 1000) / 10 },
    os: { name: os.type(), release: os.release(), architecture: os.arch() },
    uptime: os.uptime(),
  };
}
