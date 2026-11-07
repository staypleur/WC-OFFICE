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
