import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {instrumentFloatFactory, floatAllocationCounterSupported} from '../bench/vm/float-allocation-instrumentation.js';
import {parseFloatAllocationTrace, assessFloatAllocation} from '../bench/vm/float-allocation-trace.js';
import {measureFloatAllocation, floatAllocationOptions} from '../bench/vm/float-allocation.js';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {qualificationAssembly} from '../bench/vm/qualification-assembly.js';
import {executeCilStep, cilStepActive} from '../packages/runtime/src/execution/cil-step.js';

test('float allocation instrumentation covers the factory return and rejects a changed allocation site', () => {
  const original = readFileSync(new URL('../packages/bytecode/src/numeric/float.js', import.meta.url), 'utf8');
  const result = instrumentFloatFactory(original);
  assert.equal(result.allocationSites, 1);
  assert.notEqual(result.beforeSHA256, result.afterSHA256);
  assert.match(result.source, /__a05FloatAllocationCounter.objects\+\+;\n  return Object.freeze/);
  assert.throws(() => instrumentFloatFactory(original.replace('Object.freeze({float:', 'Object.seal({float:')), /needs review/);
  assert.throws(() => instrumentFloatFactory(original + original), /needs review/);
});

test('float trace parsing keeps exact carrier counts distinct from V8 byte observations', () => {
  const gc = bytes => `[1:0xabcdef:0] 123 ms: pause=1.0 gc=ms allocated=${bytes}\n`;
  const row = {mode: 'typed', iterations: 100, floatCarriers: 0, outputVerified: true,
    managedAllocations: 0, framesAllocated: 0, frameArraysAllocated: 0};
  const log = gc(1000) + 'A05_FLOAT_TRACE_BEGIN\nA05_FLOAT_TRACE_END\n' + gc(64) +
    'A05_FLOAT_RESULT ' + JSON.stringify(row) + '\n';
  const actual = parseFloatAllocationTrace(log);
  assert.equal(actual.trace.reportedAllocatedBytes, 64);
  assert.equal(actual.trace.collectionsDuringLoop, 0);
  const control = {...actual, iterations: 0};
  const assessment = assessFloatAllocation(control, [actual]);
  assert.equal(assessment.floatCarrierAcceptance, 'met');
  assert.equal(assessment.hostAllocationObservation, 'no-observed-growth');
  assert.equal(assessment.totalJSObjectAcceptance, 'unqualified', 'trace bytes are not an exact all-object counter');
  assert.equal(assessFloatAllocation(control, [{...actual, floatCarriers: 1}]).floatCarrierAcceptance, 'missed');
  assert.throws(() => assessFloatAllocation(control, [{...actual, warmupSlices: 2}]), /matching/);
  assert.throws(() => parseFloatAllocationTrace(log.replace('A05_FLOAT_TRACE_END\n', '')), /Incomplete|Unmatched/);
  assert.throws(() => parseFloatAllocationTrace(log.replace('allocated=64', 'allocated=NaN')), /valid allocated/);
  assert.throws(() => parseFloatAllocationTrace(log + 'A05_FLOAT_TRACE_BEGIN\n'), /duplicate/);
});

test('real isolated float counter detects generic carriers and zero typed warm-loop carriers',
  {skip: !floatAllocationCounterSupported && 'Node module.registerHooks is unavailable before 22.15'}, () => {
  for (const mode of ['reference', 'typed', 'mixed']) {
    const {row} = measureFloatAllocation(mode, 64, 17, 4);
    assert.equal(row.outputVerified, true);
    assert.equal(row.instructions, 64 * 11);
    assert.equal(row.warmupIterations, 17);
    assert.equal(row.warmupSlices, 4);
    if (mode === 'reference') assert(row.floatCarriers > 0);
    else assert.equal(row.floatCarriers, 0);
    assert.equal(row.instrumentation.allocationSites, 1);
    assert.equal(row.managedAllocations, 0);
  }
});

test('float measurement bounds and required evidence destination are explicit', () => {
  assert.deepEqual(floatAllocationOptions(['--runner', 'smoke', '--out', 'report.json', '--iterations', '64', '--warmup', '16']),
    {runner: 'smoke', out: 'report.json', iterations: 64, warmup: 16, warmupSlices: 1});
  assert.equal(floatAllocationOptions(['--runner', 'smoke', '--out', 'report.json', '--warmup-slices', '10']).warmupSlices, 10);
  assert.throws(() => floatAllocationOptions(['--runner', 'smoke', '--out', 'report.json', '--warmup', '2', '--warmup-slices', '3']), /Invalid/);
  assert.throws(() => floatAllocationOptions(['--iterations', '0']), /Invalid/);
  assert.throws(() => floatAllocationOptions(['--unexpected', 'value']), /Expected/);
  assert.throws(() => floatAllocationOptions(['--runner', 'first', '--runner', 'second']), /Expected/);
  assert.throws(() => measureFloatAllocation('typed', 1000001), RangeError);
  assert.throws(() => measureFloatAllocation('other', 1), RangeError);
  assert.throws(() => measureFloatAllocation('typed', 1, 16, 17), RangeError);
});

test('reused CIL dispatch activity state preserves nested entry, normal exit and thrown dispatch cleanup', () => {
  const vm = new CilVirtualMachine(qualificationAssembly({result: 'void',
    body: writer => writer.op('nop').op('nop').op('nop').op('ret')}));
  try {
    assert.equal(cilStepActive(vm), false);
    executeCilStep(vm, () => {
      assert.equal(cilStepActive(vm), true);
      executeCilStep(vm, () => assert.equal(cilStepActive(vm), true));
      assert.equal(cilStepActive(vm), true);
    });
    assert.equal(cilStepActive(vm), false);
    assert.throws(() => executeCilStep(vm, () => { throw new Error('dispatch probe'); }), /dispatch probe/);
    assert.equal(cilStepActive(vm), false);
    assert.equal(vm.run().state, 'terminated');
    assert.equal(cilStepActive(vm), false);
  } finally { vm.stop(); }
});
