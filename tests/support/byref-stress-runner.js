import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CilVirtualMachine, isReference} from '@sharpforge/runtime';

export const stressOptions = Object.freeze({gcStress: 'instruction', maxInstructions: 10000,
  maxFrames: 32, maxBytes: 1024 * 1024, initialThreshold: 1024 * 1024});
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const active = new Set(['ready', 'running']);
const referenceKey = value => isReference(value) ? `${value.h}:${value.g}` : null;

function frameValues(vm, visit) {
  if (!vm.inspector) for (const value of vm.stack) visit(value, 'stack');
  for (const frame of vm.frames) {
    if (frame.stack) for (const value of frame.stack) visit(value, 'stack');
    if (frame.args) for (const value of frame.args) visit(value, 'arguments');
    const parameters = vm.inspector ? 0 : vm.image.methods[frame.methodId].parameters.length;
    for (let index = 0; index < frame.locals.length; index++) {
      visit(frame.locals[index], index < parameters ? 'arguments' : 'locals');
    }
    visit(frame.returnObject, 'ordinary');
  }
}

/** Only the test control suppresses owners that have no ordinary frame reference. */
export class MissingByrefOwnerVM extends CilVirtualMachine {
  *roots() {
    const owners = new Set();
    const ordinary = new Set();
    frameValues(this, value => {
      if (value?.byref && isReference(value.owner)) owners.add(referenceKey(value.owner));
      else if (isReference(value)) ordinary.add(referenceKey(value));
    });
    for (const value of this.statics.values()) if (isReference(value)) ordinary.add(referenceKey(value));
    for (const value of super.roots()) {
      const key = referenceKey(value);
      if (!owners.has(key) || ordinary.has(key)) yield value;
    }
  }
}

function observe(vm, coverage) {
  const owners = new Map();
  const ordinary = new Set();
  frameValues(vm, (value, container) => {
    if (isReference(value)) ordinary.add(referenceKey(value));
    if (!value?.byref || !isReference(value.owner)) return;
    vm.heap.get(value.owner);
    const key = referenceKey(value.owner);
    let locations = owners.get(key);
    if (!locations) owners.set(key, locations = new Set());
    locations.add(container);
    coverage[container]++;
    coverage.maxPath = Math.max(coverage.maxPath, value.path.length);
    coverage.kinds[value.kind] = (coverage.kinds[value.kind] ?? 0) + 1;
  });
  for (const [owner, locations] of owners) {
    if (!ordinary.has(owner) && locations.size === 1) coverage.sole[[...locations][0]]++;
  }
}

/** Observe canonical storage between real one-instruction slices; never invoke collection from the test. */
export function executeByrefStress(vm, specimen, {negative = false} = {}) {
  const coverage = {stack: 0, arguments: 0, locals: 0, maxPath: 0, kinds: {}, sole: {stack: 0, arguments: 0, locals: 0}};
  const collectionsBefore = vm.heap.stats.collections;
  const instructionsBefore = vm.instructions;
  let slices = 0;
  try {
    while (active.has(vm.state)) {
      assert(++slices <= 10000, 'stress guest exceeded its bounded slice count');
      if (!negative) observe(vm, coverage);
      vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
    }
    const instructions = vm.instructions - instructionsBefore;
    const collections = vm.heap.stats.collections - collectionsBefore;
    assert(instructions > 0, 'the guest must execute instructions');
    assert.equal(collections, instructions, 'gcStress must collect at every executed boundary');
    const result = {state: vm.state, output: vm.output.join(''), fault: vm.fault?.name,
      instructions, collections, coverage, nativeIntBits: vm.options.nativeIntBits, preciseRoots: vm.options.preciseRoots !== false};
    if (negative) {
      assert.equal(result.state, 'faulted', 'dropping only byref owner roots must break the same guest');
      assert.equal(result.fault, 'InvalidReferenceException');
      assert.notEqual(result.output, specimen.expected + '\n');
    } else {
      assert.equal(result.state, 'terminated', `specimen ${specimen.ordinal}/${specimen.kind}: ${vm.fault?.message}`);
      assert.equal(result.output, specimen.expected + '\n', `lost nested ref write in specimen ${specimen.ordinal}`);
      if (vm.inspector && vm.returnType !== 'void') assert.equal(vm.resultValue(), specimen.expected);
      for (const container of ['stack', 'arguments', 'locals']) assert(coverage[container] > 0, `missing ${container} coverage`);
      assert(coverage.kinds[specimen.kind] > 0, `missing ${specimen.kind} address ownership`);
      assert(coverage.maxPath >= 2, 'nested value-type field addresses must cross collection boundaries');
    }
    return result;
  } finally { vm.stop(); }
}

/** A compact reproducible manifest, with full specimen rows optionally saved by the serial validator. */
export function stressReport(specimens, cases, counterparts) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const sources = ['tests/byref-gc-stress.test.js', 'tests/support/byref-stress-programs.js',
    'tests/support/byref-stress-runner.js', 'tests/support/generic-call-fixture.js'];
  const report = {
    format: 'SharpForge.ByrefGCStress/1', seed: '0x53464237', count: cases.length,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    trackedDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: root, encoding: 'utf8'}).trim() !== '',
    environment: {node: process.version, platform: process.platform, arch: process.arch},
    generator: Object.fromEntries(sources.map(path => [path, sha256(readFileSync(new URL('../../' + path, import.meta.url)))])),
    corpusSHA256: sha256(cases.map(item => item.sha256).join('\n')),
    uniqueAssemblies: new Set(cases.map(item => item.sha256)).size,
    ownerCounts: Object.fromEntries(['field', 'array', 'box'].map(kind => [kind, specimens.filter(item => item.kind === kind).length])),
    depths: [...new Set(specimens.map(item => item.levels.length))].sort(),
    instructions: cases.reduce((sum, item) => sum + item.instructions, 0),
    collections: cases.reduce((sum, item) => sum + item.collections, 0),
    sourceCounterparts: counterparts,
    nativeQualification: false,
    unsupported: ['Native/Rust/browser qualification is not established by this Node report.',
      'Source bytecode cannot create an unbox interior; box ownership is exercised by independent direct CIL.'],
    cases
  };
  if (process.env.SHARPFORGE_BYREF_STRESS_REPORT) {
    writeFileSync(process.env.SHARPFORGE_BYREF_STRESS_REPORT, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  }
  return report;
}
