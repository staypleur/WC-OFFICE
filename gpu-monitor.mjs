import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);

// Match Task Manager's busiest-engine metric; do not sum parallel engines.
// https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/
export function rankGpuProcesses(counters, processes) {
  const names = new Map(processes.map((p) => [p.id, p.name]));
  const busiest = new Map();
  for (const counter of counters) {
    const match = /^pid_(\d+)_.*_phys_(\d+)_eng_\d+_engtype_(.+)$/.exec(
      counter.name,
    );
    const value = Number(counter.usage);
    if (!match || !Number.isFinite(value) || value <= 0) continue;
    const id = Number(match[1]);
    if (!names.has(id)) continue;
    const gpu = Math.min(100, value);
    if (!busiest.has(id) || gpu > busiest.get(id).gpu)
      busiest.set(id, {
        id,
        name: names.get(id),
        gpu,
        engine: match[3],
        adapter: Number(match[2]),
      });
  }
  return [...busiest.values()]
    .sort((a, b) => b.gpu - a.gpu || a.id - b.id)
    .slice(0, 5);
}

function numberOrNull(value) {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  return Number(value);
}
export function parseGpuSample(output) {
  return output
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [index, name, total, used, utilization, temperature] = line
        .split(",")
        .map((s) => s.trim());
      const memoryTotal = numberOrNull(total),
        memoryUsed = numberOrNull(used);
      return {
        index: numberOrNull(index),
        name,
        memoryTotal: memoryTotal === null ? null : memoryTotal * 1024 ** 2,
        memoryUsed: memoryUsed === null ? null : memoryUsed * 1024 ** 2,
        utilization: numberOrNull(utilization),
        temperature: numberOrNull(temperature),
      };
    })
    .filter((gpu) => gpu.name && gpu.index !== null);
}
let cached,
  cachedAt = 0,
  pending,
  fallbackName;
export async function gpuSnapshot() {
  if (cached && Date.now() - cachedAt < 2000) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const { stdout } = await execute(
        "nvidia-smi",
        [
          "--query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu",
          "--format=csv,noheader,nounits",
        ],
        { windowsHide: true, timeout: 4000, maxBuffer: 64000 },
      );
      const devices = parseGpuSample(stdout);
      if (!devices.length) throw Error("No sensor data");
      cached = {
        devices,
        sampledAt: new Date().toISOString(),
        source: "NVIDIA 드라이버",
      };
      fallbackName = devices[0].name;
    } catch {
      if (!fallbackName && process.platform === "win32") {
        try {
          const { stdout } = await execute(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
            ],
            { windowsHide: true, timeout: 4000, maxBuffer: 16000 },
          );
          fallbackName = stdout.trim();
        } catch {
          fallbackName = "GPU 정보 확인 불가";
        }
      }
      cached = {
        devices: [
          {
            name: fallbackName || "GPU 정보 확인 불가",
            utilization: null,
            temperature: null,
            memoryUsed: null,
            memoryTotal: null,
          },
        ],
        error:
          "GPU 센서를 읽을 수 없습니다. 드라이버 지원 또는 연결 상태를 확인해주세요.",
      };
    } finally {
      cachedAt = Date.now();
      pending = null;
    }
    return cached;
  })();
  return pending;
}
