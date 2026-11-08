import os from "node:os";
import { rankGpuProcesses } from "./gpu-monitor.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);

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

export function rankProcesses(rows, previous, elapsed, cores) {
  const measured = rows.map((p) => {
    const before = previous.get(p.id);
    const cpu =
      before && before.name === p.name && elapsed > 0 && p.cpu >= before.cpu
        ? Math.min(
            100,
            Math.max(0, ((p.cpu - before.cpu) / elapsed / cores) * 100),
          )
        : null;
    return {
      id: p.id,
      name: p.name,
      cpu: cpu === null ? null : Math.round(cpu * 10) / 10,
      memory: p.memory,
    };
  });
  return {
    cpu: measured
      .filter((p) => p.cpu !== null)
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 5),
    memory: [...measured].sort((a, b) => b.memory - a.memory).slice(0, 5),
  };
}
let processRows = new Map(),
  processAt = 0,
  processCache,
  processPending;
export async function processSnapshot() {
  if (os.platform() !== "win32")
    return { error: "프로그램별 사용량은 Windows에서 지원합니다." };
  if (processCache && Date.now() - processAt < 2500) return processCache;
  if (processPending) return processPending;
  processPending = (async () => {
    try {
      const script =
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $processList = @(Get-Process | Where-Object { $_.Id -ne 0 } | ForEach-Object { @{id=$_.Id;name=$_.ProcessName;cpu=[double]$_.CPU;memory=[double]$_.WorkingSet64} }); $gpuAvailable = $true; $gpuCounters = @(); try { $gpuCounters = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | ForEach-Object { @{name=$_.Name;usage=[double]$_.UtilizationPercentage} }) } catch { $gpuAvailable = $false }; @{processes=$processList;gpu=$gpuCounters;gpuAvailable=$gpuAvailable} | ConvertTo-Json -Compress -Depth 4";
      const { stdout } = await execute(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 7000, maxBuffer: 1024 * 1024 },
      );
      const sample = JSON.parse(stdout.replace(/^\uFEFF/, ""));
      const rows = sample.processes;
      const at = Date.now();
      processCache = {
        ...rankProcesses(
          rows,
          processRows,
          (at - processAt) / 1000,
          os.cpus().length,
        ),
        sampledAt: new Date(at).toISOString(),
        gpu: sample.gpuAvailable ? rankGpuProcesses(sample.gpu, rows) : [],
        gpuError: sample.gpuAvailable
          ? null
          : "프로그램별 GPU 사용량을 측정할 수 없습니다. 다음 갱신에서 다시 확인합니다.",
      };
      processRows = new Map(rows.map((p) => [p.id, p]));
      processAt = at;
      return processCache;
    } catch {
      return {
        error:
          "프로그램별 사용량을 확인하지 못했습니다. 다음 갱신에서 다시 시도합니다.",
      };
    } finally {
      processPending = null;
    }
  })();
  return processPending;
}
