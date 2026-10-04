import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {stripProfilerConsumer, profilerReferenceChanges} from '../bench/vm/profiler-reference-transform.js';
import {loadProfilerReference} from '../bench/vm/profiler-reference.js';

function runtimeSources(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) files.push(...runtimeSources(join(directory, entry.name), path + '/'));
    else if (path.endsWith('.js')) files.push([path, readFileSync(join(directory, entry.name), 'utf8')]);
  }
  return files;
}

test('reference transformation deletes only reviewed consumers and preserves runtime cleanup', () => {
  const directory = fileURLToPath(new URL('../packages/runtime/src/', import.meta.url));
  const changes = profilerReferenceChanges(runtimeSources(directory));
  assert(changes.length >= 14);
  const cil = changes.find(change => change.path === 'execution/cil-step.js');
  assert.match(cil.after, /flushFramePool\(vm\)/);
  assert.match(cil.after, /dispatchWasmCall\(vm/);
  assert.doesNotMatch(cil.after, /succeeded|profiler\?\./);
  const source = changes.find(change => change.path === 'execution/source-slice.js');
  assert.match(source.after, /flushSourceRuntimeEvents\(vm\)/);
  assert.doesNotMatch(source.after, /\bprofiler\b/);
  assert.match(changes.find(change => change.path === 'vm.js').after, /get profiler\(\)\{return null;\}/);
});

test('reference creation refuses unknown hook sites and newly introduced profiler behavior', () => {
  assert.throws(() => stripProfilerConsumer('new-consumer.js', 'vm.profiler?.instruction(frame);'), /Unreviewed/);
  assert.throws(() => stripProfilerConsumer('execution/source-slice.js', 'vm.profiler?.newHook();\n'), /Unreviewed/);
  assert.throws(() => stripProfilerConsumer('execution/cil-step.js', 'other(vm.profiler);'), /Unrecognized/);
  assert.throws(() => profilerReferenceChanges([]), /Expected profiler/);
  assert.deepEqual(stripProfilerConsumer('ordinary.js', 'export const value = 42;'), {source: 'export const value = 42;', changes: 0});
});

test('numeric block reference retains all non-profiler observation guards', () => {
  const before = 'return onInstruction || vm.onWrite || vm.onException || vm.profiler || vm.options.profile || vm.runtimeEvents ||\n' +
    "  vm.options.gcStress === 'instruction' || vm.scheduler.enabled;\n";
  const actual = stripProfilerConsumer('execution/numeric-blocks.js', before);
  assert.equal(actual.changes, 1);
  assert.equal(actual.source, 'return onInstruction || vm.onWrite || vm.onException || vm.runtimeEvents ||\n' +
    "  vm.options.gcStress === 'instruction' || vm.scheduler.enabled;\n");
  assert.throws(() => stripProfilerConsumer('execution/numeric-blocks.js', before.replace('vm.options.profile', 'vm.options.other')),
    /Unrecognized/);
});

test('object-value reference preserves reviewed CIL work and source fault/cleanup boundaries', () => {
  const body = `export function resumeCilObjectValueWork(vm, frame) {
  let succeeded = false;
  try {
    vm.profiler?.instruction(frame);
    resumeObjectValueWork(vm, frame);
    succeeded = true;
  } finally { vm.profiler?.endInstruction(succeeded); }
}
`;
  const cil = stripProfilerConsumer('execution/object-value-slice.js', body).source;
  assert.equal(cil, 'export function resumeCilObjectValueWork(vm, frame) {\n  resumeObjectValueWork(vm, frame);\n}\n');
  assert.throws(() => stripProfilerConsumer('execution/object-value-slice.js', body.replace('resumeObjectValueWork(vm, frame);',
    'resumeObjectValueWork(vm, other);')), /Unrecognized/);
  const source = 'try {\n  vm.profiler?.instruction(frame);\n  resumeObjectValueWork(vm, frame);\n' +
    '} catch (error) { handleSourceInstructionFault(vm, error); } finally { flushFramePool(vm); }\n';
  assert.equal(stripProfilerConsumer('execution/object-value-slice.js', source).source,
    source.replace('  vm.profiler?.instruction(frame);\n', ''));
});

test('reviewed array continuation hooks preserve their exact resume/result and fault-cleanup semantics', () => {
  const body = `export function resumeCilArrayContinuation(vm, frame) {
  const profiler = vm.profiler;
  let succeeded = false;
  try {
    profiler?.instruction(frame);
    const result = resumeArrayOperation(vm, frame);
    if (result.done && result.returns) vm.push(result.value);
    succeeded = true;
  } finally { profiler?.endInstruction(succeeded); }
}
`;
  const cil = stripProfilerConsumer('execution/cil-array-continuations.js', body).source;
  assert.match(cil, /const result = resumeArrayOperation\(vm, frame\)/);
  assert.match(cil, /if \(result.done && result.returns\) vm.push\(result.value\)/);
  assert.doesNotMatch(cil, /profiler|succeeded|finally/);
  assert.throws(() => stripProfilerConsumer('execution/cil-array-continuations.js', body.replace('result.returns', 'result.other')), /Unrecognized/);
  const source = stripProfilerConsumer('execution/source-array-continuations.js',
    'try {\n  vm.profiler?.instruction(frame);\n  resumeArrayOperation(vm, frame);\n} finally { flushFramePool(vm); }\n').source;
  assert.match(source, /resumeArrayOperation\(vm, frame\)/);
  assert.match(source, /finally \{ flushFramePool\(vm\); \}/);
  assert.doesNotMatch(source, /profiler/);
});

test('profiler reference rejects oversized input before parsing or importing another runtime', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'a05-profiler-manifest-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const path = join(directory, 'oversized.json');
  writeFileSync(path, Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(loadProfilerReference(path), /at most 1 MiB/);
  await assert.rejects(loadProfilerReference(directory), /must be a file/);
});
