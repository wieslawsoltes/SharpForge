import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector, verifyCilAssembly, verificationType, VerificationKind, mergeVerificationStacks } from '@sharpforge/cil';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { dataflowBlocks } from '../packages/cil/src/verify/dataflow-blocks.js';
import { DataflowWorklist } from '../packages/cil/src/verify/dataflow.js';
import { sameVerificationType } from '../packages/cil/src/verify/types.js';
import { verifiedStackBound } from '../packages/cil/src/verified-stack.js';
import { dataflowFixture, nativeCases } from './fixtures/verifier-dataflow/input.js';

function decoded(name) {
  const fixture = nativeCases.find(value => value.name === name);
  const inspector = new AssemblyInspector(dataflowFixture(fixture));
  const method = inspector.getMethod(inspector.pe.entryPoint);
  const offsets = new Map(method.instructions.map((instruction, index) => [instruction.offset, index]));
  return { inspector, method, offsets };
}

function solver(graph, overrides = {}, options = {}) {
  return new DataflowWorklist(graph, {
    emptyState: 0, stopped: () => false, merge: (incoming, stored) => Math.max(incoming, stored),
    transfer: (block, state) => state, invalidEdge: () => assert.fail('Unexpected invalid edge'), ...overrides,
  }, options);
}

test('basic blocks split targets and fallthroughs while preserving decoded records and duplicate switch edges', () => {
  const { method, offsets } = decoded('Diamond');
  const graph = dataflowBlocks(method, offsets);
  assert.deepEqual(graph.blocks.map(({ start, end }) => [start, end]), [[0, 2], [2, 4], [4, 5], [5, 7]]);
  assert.deepEqual(graph.blocks.map(block => block.successors), [[2, 1], [3], [3], []]);
  const switching = decoded('Switch');
  const switchGraph = dataflowBlocks(switching.method, switching.offsets);
  assert.deepEqual(switchGraph.blocks[0].successors, [1, 1, 1, 1]);
  let transfers = 0;
  const worklist = solver(switchGraph, { transfer: () => { transfers++; return 0; } });
  worklist.enqueue(0, 0);
  worklist.run();
  assert.equal(transfers, 2);
});

test('EH boundaries are block entries and leave clears the outgoing state', () => {
  const { method, offsets } = decoded('Catch');
  const graph = dataflowBlocks(method, offsets);
  const handler = graph.blockAt[offsets.get(method.handlers[0].target)];
  assert.equal(graph.blocks[handler].clearStack, true);
  const seen = [];
  const worklist = solver(graph, { transfer(block, state) { seen.push([block.start, state]); return state; } });
  worklist.enqueue(handler, 1);
  worklist.run();
  assert.deepEqual(seen.map(value => value[1]), [1, 0]);
});

test('typed joins reprocess previously visited successors and terminate stable backedges', () => {
  const root = verificationType(VerificationKind.Object, Object.freeze({ name: 'Root' }));
  const left = verificationType(VerificationKind.Object, Object.freeze({ name: 'Left' }));
  const right = verificationType(VerificationKind.Object, Object.freeze({ name: 'Right' }));
  const relations = { isAssignableTo: (source, target) => source === target || target === root, commonSupertype: () => root };
  const graph = { blocks: [[1, 2], [3], [3], [4], [3]].map((successors, start) =>
    ({ start, end: start + 1, successors, clearStack: false })) };
  const visits = new Map();
  const worklist = solver(graph, {
    emptyState: Object.freeze([]),
    merge(incoming, stored) {
      const merged = mergeVerificationStacks(incoming, stored, { relations });
      return merged.every((value, index) => sameVerificationType(value, stored[index])) ? stored : merged;
    },
    transfer(block, state) {
      visits.set(block.start, (visits.get(block.start) ?? 0) + 1);
      if (block.start === 1) return Object.freeze([left]);
      if (block.start === 2) return Object.freeze([right]);
      return state;
    },
  });
  worklist.enqueue(0, Object.freeze([]));
  const states = worklist.run();
  assert.deepEqual(states[3], [root]);
  assert.deepEqual(states[4], [root]);
  assert.equal(visits.get(3), 2);
  assert.equal(visits.get(4), 2);
});

test('queued joins are merged once per edge without duplicating pending block transfers', () => {
  const graph = { blocks: [{ start: 0, end: 1, successors: [], clearStack: false }] };
  let transfers = 0;
  const worklist = solver(graph, { transfer(block, state) { transfers++; assert.equal(state, 9999); return state; } });
  for (let value = 0; value < 10000; value++) worklist.enqueue(0, value);
  assert.deepEqual(worklist.run(), [9999]);
  assert.equal(transfers, 1);
});

test('limits reject before propagation and exact empty-stack budgets succeed', () => {
  const { method, offsets } = decoded('Empty');
  const graph = dataflowBlocks(method, offsets, { maxDataflowInstructions: 1, maxDataflowEdges: 0 });
  const exact = solver(graph, {}, { maxDataflowSteps: 2 });
  exact.enqueue(0, 0);
  assert.deepEqual(exact.run(), [0]);
  assert.throws(() => dataflowBlocks(method, offsets, { maxDataflowInstructions: 0 }), /instruction limit/);
  const switching = decoded('Switch');
  assert.throws(() => dataflowBlocks(switching.method, switching.offsets, { maxDataflowEdges: 3 }), /edge limit/);
  for (const value of [-1, 1.5, NaN, Infinity, '1', 16000001])
    assert.throws(() => solver(graph, {}, { maxDataflowSteps: value }), /Invalid dataflow limit/);
  const denied = solver(graph, {}, { maxDataflowSteps: 0 });
  assert.throws(() => denied.enqueue(0, 0), /convergence budget/);
  const looping = { blocks: [{ start: 0, end: 1, successors: [0], clearStack: false }] };
  const unbounded = solver(looping, { transfer: (block, value) => value + 1 }, { maxDataflowSteps: 9 });
  unbounded.enqueue(0, 0);
  assert.throws(() => unbounded.run(), /convergence budget/);
});

test('cancellation is checked before graph allocation and after an interrupted transfer', () => {
  const { method, offsets } = decoded('Empty');
  assert.throws(() => dataflowBlocks(method, offsets, { signal: AbortSignal.abort() }), /cancelled/);
  const controller = new AbortController();
  const worklist = solver(dataflowBlocks(method, offsets), {
    transfer: () => { controller.abort(); return null; },
  }, { signal: controller.signal });
  worklist.enqueue(0, 0);
  assert.throws(() => worklist.run(), /cancelled/);
});

test('empty bodies and reachable fallthroughs stay explicit invalid edges', () => {
  for (const instructions of [[], [{ offset: 0, name: 'nop', operandKind: '' }]]) {
    const method = { instructions, handlers: [] };
    const graph = dataflowBlocks(method, new Map(instructions.map((instruction, index) => [instruction.offset, index])));
    let invalid = 0;
    const worklist = solver(graph, { invalidEdge: () => { invalid++; } });
    worklist.enqueue(graph.blocks.length ? 0 : -1, 0);
    worklist.run();
    assert.equal(invalid, 1);
  }
});

test('height integration preserves successful runtime execution and emits precise stack diagnostic categories', () => {
  for (const fixture of nativeCases) {
    const bytes = dataflowFixture(fixture);
    const inspector = new AssemblyInspector(bytes);
    const report = verifyCilAssembly(inspector);
    assert.equal(report.success, !!fixture.accepted, JSON.stringify({ name: fixture.name, issues: report.issues }));
    if (fixture.accepted) {
      assert.ok(verifiedStackBound(inspector, report, inspector.getMethod(inspector.pe.entryPoint)));
      assert.equal(new CilVirtualMachine(bytes).run().state, 'terminated', fixture.name);
    } else {
      assert.ok(report.issues.some(issue => issue.diagnostic === fixture.diagnostic), JSON.stringify(report.issues));
      assert.equal(verifiedStackBound(inspector, report, inspector.getMethod(inspector.pe.entryPoint)), null);
    }
  }
});

test('exhausted dataflow budgets cannot issue runtime stack proofs', () => {
  const { inspector, method } = decoded('Empty');
  for (const options of [{ maxDataflowSteps: 0 }, { maxDataflowInstructions: 0 }, { maxDataflowEdges: -1 }]) {
    const report = verifyCilAssembly(inspector, options);
    assert.equal(report.success, false);
    assert.ok(report.issues.some(issue => issue.code === 'IL_LIMIT'));
    assert.equal(verifiedStackBound(inspector, report, method), null);
  }
});

test('retained ILVerify observations cover height diagnostics, joins, loops and handler seeds', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/verifier-dataflow/native.json', import.meta.url), 'utf8'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(capture.inputSHA256, hash(readFileSync(new URL('./fixtures/verifier-dataflow/input.js', import.meta.url))));
  assert.equal(capture.observations.length, nativeCases.length);
  for (const fixture of nativeCases) {
    const native = capture.observations.find(value => value.name === fixture.name);
    assert.equal(native.assemblySHA256, hash(dataflowFixture(fixture)), fixture.name);
    assert.equal(native.oracle.accepted, !!fixture.accepted, fixture.name);
    if (fixture.diagnostic) assert.ok(native.oracle.errors.includes(fixture.diagnostic), fixture.name);
  }
});
