import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {stripProfilerConsumer} from '../bench/vm/profiler-reference-transform.js';

const read = path => readFileSync(new URL('../packages/runtime/src/' + path, import.meta.url), 'utf8');

test('private construction handles and shared host allocation observers remain byte-identical', () => {
  for (const path of ['vm.js', 'cil-vm.js', 'execution/heap-allocation.js']) {
    const source = read(path);
    assert.deepEqual(stripProfilerConsumer(path, source), {source, changes: 0}, path);
  }
  const allocation = read('execution/heap-allocation.js');
  for (const source of [allocation.replace('allocation(size, true)', 'allocation(size, false)'),
    allocation + '\nvm.profiler?.instruction(frame);\n']) {
    assert.throws(() => stripProfilerConsumer('execution/heap-allocation.js', source), /Unreviewed shared allocation/);
  }
});

test('profiler-free construction retains the exact callback with a null handle before guest entry', () => {
  for (const path of ['execution/initialize-source.js', 'execution/cil-instrumentation.js']) {
    const source = read(path);
    const expected = source.split('\n').filter(line => !line.startsWith('import ') || !line.includes("from './profiler.js'"))
      .filter(line => line.trim() !== 'initializeExecutionProfiler(vm, options.profile);').join('\n')
      .replace('profilerReady?.(executionProfiler(vm));', 'profilerReady?.(null);');
    assert.equal(stripProfilerConsumer(path, source).source, expected, path);
    assert.throws(() => stripProfilerConsumer(path, source.replace('profilerReady?.(executionProfiler(vm));',
      'profilerReady?.(executionProfiler(other));')), /Unrecognized profiling hook/);
  }
});

test('prepared pool capabilities, source identities, calls and callbacks remain byte-identical in the reference', () => {
  const unchanged = ['source-prepared-calls', 'prepared-cil-frame', 'prepared-virtual-call', 'source-fusion-batch', 'callback-frames',
    'frame-pool', 'source-frame-capability', 'cil-frame-capability', 'prepared-frame-scrub', 'method-table', 'source-type-display',
    'type-display-name', 'runtime-type-assembly', 'tokens', 'type-system', 'managed-object-string'];
  for (const name of unchanged) {
    const path = 'execution/' + name + '.js', source = read(path);
    assert.deepEqual(stripProfilerConsumer(path, source), {source, changes: 0}, path);
  }
});

test('reference removes only profiler eligibility from the integrated batching guards', () => {
  for (const name of ['source-fusion', 'numeric-blocks']) {
    const path = 'execution/' + name + '.js', source = read(path);
    const actual = stripProfilerConsumer(path, source);
    assert.equal(actual.changes, 1, path);
    assert.equal(actual.source, source.replace('vm.profiler || vm.options.profile || ', ''), path);
    assert.match(actual.source, /vm\.scheduler\.suppressed/);
    assert.match(actual.source, /vm\.options\.gcStress === 'instruction'/);
    assert.match(actual.source, /vm\.runtimeEvents/);
    assert.match(actual.source, /frame\.objectValueWork/);
  }
});

test('current instruction, continuation and method consumers produce syntactically valid reference modules', () => {
  const consumers = ['source-slice', 'cil-slice', 'cil-step', 'call-frames', 'cil-method-events',
    'source-array-continuations', 'cil-array-continuations', 'object-value-slice'];
  for (const name of consumers) {
    const path = 'execution/' + name + '.js', actual = stripProfilerConsumer(path, read(path));
    assert.ok(actual.changes > 0, path);
    const result = spawnSync(process.execPath, ['--check', '--input-type=module'],
      {input: actual.source, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024});
    assert.ifError(result.error);
    assert.equal(result.status, 0, path + ': ' + result.stderr);
    assert.equal(result.signal, null, path);
  }
});

test('option-only gates and direct profiler calls require explicit transformation review', () => {
  for (const source of ['if (vm.options.profile) observe();', 'if (this.options.profile) observe();',
    'profiler.instruction(frame);', 'profiler.newHook(frame);']) {
    assert.throws(() => stripProfilerConsumer('execution/new-consumer.js', source), /Unreviewed profiler consumer/);
    assert.throws(() => stripProfilerConsumer('execution/cil-step.js', source), /Unrecognized profiling hook/);
  }
  const comment = '// vm.options.profile is disabled for this path.\nexport const unchanged = true;\n';
  assert.deepEqual(stripProfilerConsumer('ordinary.js', comment), {source: comment, changes: 0});
  const publicExport = "export {instructionProfile} from './execution/profiler.js';\n";
  assert.deepEqual(stripProfilerConsumer('index.js', publicExport), {source: publicExport, changes: 0});
});
