import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { TextBuffer, VisualColumnIndex, visualColumnAt, unicodeGraphemeVersion } from '../src/index.js';

function percentile(values, fraction) { return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]; }
function summary(values) { return { medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95), samples: values.length }; }
const text = 'a'.repeat(1024 * 1024 - 4) + '\t界e\u0301';
const buffer = new TextBuffer(text);
const index = new VisualColumnIndex(buffer);
const started = performance.now();
await index.get(buffer.length);
const firstLookupMs = performance.now() - started;
const baseline = [];
const cached = [];
for (let sample = 0; sample < 30; sample++) {
  const offset = buffer.length - 20 - sample;
  let start = performance.now();
  const before = visualColumnAt(text, offset);
  baseline.push(performance.now() - start);
  start = performance.now();
  const after = await index.get(offset);
  cached.push(performance.now() - start);
  if (before !== after) throw new Error('Column benchmark comparison disagrees');
}
console.log(JSON.stringify({
  runtime: process.version, unicode: unicodeGraphemeVersion, hostUnicode: process.versions.unicode,
  platform: `${platform()}/${arch()}`, cpu: cpus()[0]?.model, units: buffer.length,
  baseline: { method: 'visualColumnAt(full line, offset)', ...summary(baseline) },
  indexed: { method: 'VisualColumnIndex.get(offset), sparse prefix already indexed', ...summary(cached), firstLookupMs },
  statistics: index.statistics, snapshotTextMaterialized: buffer.statistics.textMaterialized,
  note: 'Local shared-host model measurement; no browser/UI frame-latency claim'
}, null, 2));
index.dispose();
