import os from 'node:os';
import assert from 'node:assert/strict';
import {findTextMatches} from '@sharpforge/text';
import {EditorModel} from '../../packages/editor/src/model.js';
import {editorWorkspace} from '../../packages/editor/src/services/workspace-edit.js';
import {EditorSearchSession} from '../../packages/editor/src/features/search-session.js';

const bytes = Number(process.argv[2] ?? 100) * 1024 * 1024;
if (!Number.isSafeInteger(bytes) || bytes < 1024 || bytes > 128 * 1024 * 1024) throw new RangeError('Benchmark size must be 1 KiB–128 MiB');
const marker = 'UNIQUE_END_MARKER';
const line = '// literal search payload 0123456789\n';
const text = line.repeat(Math.ceil((bytes - marker.length) / line.length)).slice(0, bytes - marker.length) + marker;
const model = new EditorModel(text, {uri: 'large.cs'});
const source = model.snapshot();
const baselineStart = performance.now();
let baseline;
try {
  const result = findTextMatches([source], marker, {maxSteps: 2_000_000, timeLimitMs: 12});
  baseline = {status: 'completed', milliseconds: performance.now() - baselineStart, matches: result.matches.length};
} catch (error) {
  if (error.code !== 'SEARCH_LIMIT') throw error;
  baseline = {status: 'budget-exhausted', code: error.code, milliseconds: performance.now() - baselineStart};
}
const editor = {model, uri: 'large.cs', input: {readOnly: false}, sourceSnapshot: () => model.snapshot(),
  get value() { throw new Error('Large-file search must not read the complete editor value'); }};
const session = new EditorSearchSession(editorWorkspace(editor));
const slices = [];
let yields = 0;
let sliceStart = performance.now();
const start = performance.now();
const result = await session.searchAsync(marker, {uri: 'large.cs', onProgress() { slices.push(performance.now() - sliceStart); },
  async yieldControl() {
    await new Promise(resolve => setImmediate(resolve));
    yields++;
    sliceStart = performance.now();
  }});
const milliseconds = performance.now() - start;
assert.equal(result.matches.length, 1);
assert.equal(result.matches[0].start, bytes - marker.length);
assert.equal(result.truncated, false);
const ordered = slices.sort((left, right) => left - right);
const percentile = fraction => ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
console.log(JSON.stringify({
  timestamp: new Date().toISOString(), implementationRevision: process.argv[3] ?? null,
  command: `node tests/bench/a20-editor-search.mjs ${bytes / 1024 / 1024} ${process.argv[3] ?? ''}`.trim(),
  machine: {node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0].model, cores: os.cpus().length},
  source: {bytes, utf16Units: bytes, marker, expectedOffset: bytes - marker.length, fixtureLine: line},
  fullRuns: 1, baseline,
  after: {backend: result.backend, scheduler: 'Node setImmediate', milliseconds, matches: result.matches.length,
    actualOffset: result.matches[0].start, slices: slices.length, yields,
    sliceMedianMs: percentile(0.5), sliceP95Ms: percentile(0.95), sliceMaxMs: ordered.at(-1)},
  browserQualification: {status: 'not-run', reason: 'Node search benchmark; no browser input or paint latency is measured'},
  speedup: null, comparisonNote: 'The bounded synchronous baseline did not finish; no completion speedup is claimed.'
}, null, 2));
