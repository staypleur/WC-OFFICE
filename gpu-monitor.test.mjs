import test from "node:test";
import assert from "node:assert/strict";
import { parseGpuSample } from "./gpu-monitor.mjs";
test("GPU sensor values preserve measured units and distinguish unsupported from zero", () => {
  const [a, b] = parseGpuSample(
    "0, NVIDIA GeForce RTX 5080, 16303, 4286, 21, 49\n1, Other GPU, [N/A], [Not Supported], 0, N/A",
  );
  assert.equal(a.name, "NVIDIA GeForce RTX 5080");
  assert.equal(a.memoryTotal, 16303 * 1024 ** 2);
  assert.equal(a.temperature, 49);
  assert.equal(a.utilization, 21);
  assert.equal(b.memoryTotal, null);
  assert.equal(b.memoryUsed, null);
  assert.equal(b.utilization, 0);
  assert.equal(b.temperature, null);
  assert.deepEqual(parseGpuSample(""), []);
});

test("GPU ranking keeps busiest engine per live process and excludes idle or invalid samples", async () => {
  const { rankGpuProcesses } = await import("./gpu-monitor.mjs");
  const counter = (pid, engine, usage) => ({
    name: `pid_${pid}_luid_0x0_0x1_phys_0_eng_0_engtype_${engine}`,
    usage,
  });
  const rows = [
    counter(1, "3D", 20),
    counter(1, "VideoDecode", 40),
    counter(2, "Copy", 30),
    counter(3, "3D", 0),
    counter(99, "3D", 90),
    counter(2, "3D", "bad"),
  ];
  const ranked = rankGpuProcesses(rows, [
    { id: 1, name: "Browser" },
    { id: 2, name: "Editor" },
    { id: 3, name: "Idle" },
  ]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].gpu, 40);
  assert.equal(ranked[0].engine, "VideoDecode");
  assert.equal(ranked[1].name, "Editor");
  assert.deepEqual(rankGpuProcesses([], []), []);
});
