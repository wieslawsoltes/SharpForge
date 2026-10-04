import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AssemblyInspector, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {compileToAssembly} from '@sharpforge/compiler';
import {asyncNativeTimeout as timeout, loadAsyncToolchain} from './support/cil-async-toolchain.js';

const fixtures = ['Completed', 'Suspended', 'Exceptions', 'Retention', 'WaitAndDelay', 'Mutation'];

function contextFor(context) {
  const toolchain = loadAsyncToolchain();
  if (!toolchain.available) { context.skip(toolchain.reason); return null; }
  const {pack, dotnet, compiler, runtimeConfig, languageVersion} = toolchain;
  const scratch = mkdtempSync(join(tmpdir(), 'sharpforge-cil-async-'));
  function build(source, name, optimize) {
    const path = join(scratch, name + '.dll'), input = path + '.cs';
    writeFileSync(input, source);
    const result = spawnSync(dotnet, [compiler, '-nologo', '-noconfig', '-nostdlib', '-langversion:' + languageVersion,
      '-target:exe', '-optimize' + (optimize ? '+' : '-'), '-out:' + path,
      ...pack.pack.files.map(reference => '-reference:' + reference), input], {encoding: 'utf8', timeout});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    writeFileSync(path.replace(/\.dll$/, '.runtimeconfig.json'), JSON.stringify(runtimeConfig));
    const expected = execFileSync(dotnet, [path], {encoding: 'utf8', timeout}).replace(/\r\n/g, '\n');
    return {bytes: new Uint8Array(readFileSync(path)), expected};
  }
  context.diagnostic(JSON.stringify({...toolchain.invocation, optimizationModes: ['-', '+']}));
  return {pack, build, close: () => rmSync(scratch, {recursive: true, force: true})};
}

function sourceOf(name) {
  return readFileSync(new URL('./fixtures/cil-async/' + name + '.cs', import.meta.url), 'utf8');
}

function finish(vm) {
  let result = vm.run();
  for (let turn = 0; turn < 100 && result.state === 'waiting'; turn++) {
    const delay = vm.scheduler.nextDelay();
    assert.notEqual(delay, null, 'pending async continuation has a runnable context or deadline');
    vm.scheduler.advance(delay);
    result = vm.run();
  }
  assert.equal(result.state, 'terminated', result.fault ? result.fault.name + ': ' + result.fault.message : result.state);
  return result.output;
}

for (const name of fixtures) test('direct CIL async native reference: ' + name, context => {
  const native = contextFor(context);
  if (!native) return;
  try {
    const source = sourceOf(name);
    for (const optimize of [false, true]) {
      const {bytes, expected} = native.build(source, name + (optimize ? 'Release' : 'Debug'), optimize);
      assert.equal(finish(new CilVirtualMachine(bytes, {virtualTime: true})), expected);
      if (!optimize) {
        const emitted = compileToAssembly(source, {name, references: native.pack.references});
        assert.deepEqual(emitted.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), []);
        assert.ok(emitted.assembly);
        assert.equal(finish(new CilVirtualMachine(emitted.assembly, {virtualTime: true})), expected);
      }
    }
  } finally { native.close(); }
});

for (const fixture of ['Retention', 'Mutation']) test('direct CIL async snapshot roots and exactly-once continuation: ' + fixture, context => {
  const native = contextFor(context);
  if (!native) return;
  try {
    for (const optimize of [false, true]) {
      const {bytes, expected} = native.build(sourceOf(fixture), 'Snapshot' + fixture + optimize, optimize);
      const vm = new CilVirtualMachine(bytes, {virtualTime: true});
      assert.equal(vm.run().state, 'waiting');
      vm.heap.collect();
      const snapshot = vm.snapshot();
      assert.equal(finish(vm), expected);
      vm.restore(snapshot);
      vm.heap.collect();
      assert.equal(finish(vm), expected);
      const collecting = new CilVirtualMachine(bytes, {virtualTime: true});
      collecting.heap.allocationObserver = {allocation() { collecting.heap.collect(); }};
      assert.equal(finish(collecting), expected, 'allocation observers may collect while managed callbacks are registered');
    }
  } finally { native.close(); }
});

test('direct CIL async builder reachability rejects invalid MoveNext before execution', context => {
  const native = contextFor(context);
  if (!native) return;
  try {
    const {bytes} = native.build(sourceOf('Suspended'), 'InvalidBody', false);
    const inspector = new AssemblyInspector(bytes);
    const method = [...inspector.methods.values()].find(candidate => candidate.name === 'MoveNext');
    assert.ok(method, 'real Roslyn state machine');
    const body = inspector.pe.methodBody(method.token);
    bytes[body.fileOffset + body.headerSize] = 0x26; // pop at an empty entry stack
    const report = verifyCilAssembly(bytes);
    assert.equal(report.success, false);
    assert.ok(report.issues.some(issue => issue.methodToken === method.token && issue.code === 'IL_STACK'), report.issues);
    assert.throws(() => new CilVirtualMachine(bytes), /verification failed/i);
  } finally { native.close(); }
});
