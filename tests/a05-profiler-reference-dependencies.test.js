import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync,
  lstatSync, realpathSync, mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as product from '@sharpforge/runtime';
import {compileToIL} from '@sharpforge/compiler';
import {root} from '../bench/vm/evidence.js';
import {linkReferenceDependencies, verifyReferenceDependencies} from '../bench/vm/profiler-reference-dependencies.js';
import {profilerReferenceChanges} from '../bench/vm/profiler-reference-transform.js';

function assertReferenceAllocationObservers(reference) {
  const heap = new reference.ManagedHeap();
  const owner = heap.object('System.Object', []);
  const child = heap.string('host-observer child');
  const pins = [...heap.pins];
  const observed = [];
  const failure = new Error('reference host observer failure');
  heap.allocationObserver = {allocation(bytes, growth) {
    observed.push([bytes, growth]);
    heap.collect();
    assert.equal(heap.get(child).data, 'host-observer child');
    if (growth) throw failure;
  }};
  heap.withRoots([owner, child], () => {
    const allocated = heap.string('host-observer result');
    assert.equal(heap.get(allocated).data, 'host-observer result');
    assert.throws(() => heap.replaceData(owner, [child]), error => error === failure);
    assert.deepEqual(heap.get(owner).data, [child]);
  });
  assert.equal(observed.length, 2);
  assert.equal(observed[0][1], undefined);
  assert.deepEqual(observed[1], [8, true]);
  assert.deepEqual(heap.pins, pins);
  heap.collect();
  assert.throws(() => heap.get(owner), {name: 'InvalidReferenceException'});
}

test('reference dependencies stay ignored while explicit hook-free runtime imports retain their own identity', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'a05-reference-dependencies-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  execFileSync('git', ['init', '-q', directory]);
  writeFileSync(join(directory, '.gitignore'), 'node_modules/\n');
  const recorded = linkReferenceDependencies(root, directory);
  assert.equal(lstatSync(join(directory, 'node_modules')).isSymbolicLink(), false);
  assert.equal(execFileSync('git', ['-C', directory, 'status', '--porcelain=v1', '--', 'node_modules'], {encoding: 'utf8'}), '');
  verifyReferenceDependencies(root, directory, recorded);
  assert.equal(realpathSync(join(directory, 'node_modules/@sharpforge/runtime')), realpathSync(join(root, 'packages/runtime')));

  const packageDirectory = join(directory, 'packages/runtime');
  mkdirSync(join(directory, 'packages'));
  cpSync(join(root, 'packages/runtime'), packageDirectory, {recursive: true});
  const sourceDirectory = join(packageDirectory, 'src');
  const files = readdirSync(sourceDirectory, {recursive: true}).filter(path => path.endsWith('.js')).map(path => path.replaceAll('\\', '/'));
  const changes = profilerReferenceChanges(files.map(path => [path, readFileSync(join(sourceDirectory, path), 'utf8')]));
  for (const change of changes) writeFileSync(join(sourceDirectory, change.path), change.after);
  // This is the same explicit public path used after loadProfilerReference's provenance checks.
  const reference = await import(pathToFileURL(join(sourceDirectory, 'index.js')).href);
  assert.notEqual(reference.VirtualMachine, product.VirtualMachine);
  assert.notEqual(reference.CilVirtualMachine, product.CilVirtualMachine);
  assert.throws(() => Object.getOwnPropertyDescriptor(reference.VirtualMachine.prototype, 'profiler').get.call({}), TypeError);
  assertReferenceAllocationObservers(reference);
  const artifact = compileToIL('class Program { static int Main() { return 42; } }');
  assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
  for (const [engine, vm] of [['source', new reference.VirtualMachine(artifact.image, {profile: false})],
    ['cil', new reference.CilVirtualMachine(artifact.assembly, {profile: false})]]) {
    try {
      assert.equal(vm.profiler, null, engine);
      reference.prepareExecution(vm);
      assert.equal(vm.run().state, 'terminated', engine);
      assert.equal(vm.returnValue, 42, engine);
      assert.equal(reference.instructionProfile(vm), null, engine);
      assert(reference.framePoolStatistics(vm).framesAllocated > 0, engine);
    } finally { vm.stop(); }
  }
});

test('reference dependency verification rejects changed copied entries and added paths', t => {
  const directory = mkdtempSync(join(tmpdir(), 'a05-reference-dependency-change-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const source = join(directory, 'product'), target = join(directory, 'reference');
  mkdirSync(join(source, 'node_modules'), {recursive: true});
  mkdirSync(target);
  writeFileSync(join(source, 'node_modules/metadata.json'), '{}\n');
  const recorded = linkReferenceDependencies(source, target);
  verifyReferenceDependencies(source, target, recorded);
  writeFileSync(join(target, 'node_modules/metadata.json'), '{"changed":true}\n');
  assert.throws(() => verifyReferenceDependencies(source, target, recorded), /dependency differs/);
  writeFileSync(join(target, 'node_modules/metadata.json'), '{}\n');
  writeFileSync(join(target, 'node_modules/extra.js'), 'export {};\n');
  assert.throws(() => verifyReferenceDependencies(source, target, recorded), /provenance changed/);
});
