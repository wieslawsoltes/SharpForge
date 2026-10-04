import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, CilWriter, decodeInstructions, buildExceptionRegionTree, validateExceptionControlFlow } from '@sharpforge/cil';
import { decodedExceptionRegions } from '../packages/cil/src/eh-regions/build.js';
import { validateDecodedExceptionControlFlow } from '../packages/cil/src/eh-regions/control-flow.js';
import { flowFixture, nativeCases } from './fixtures/a03-eh-admission/input.js';

function outcome(operation) {
  try { return operation(); } catch (error) {
    if (error.name !== 'CilError') throw error;
    return { code: error.code, offset: error.offset };
  }
}

test('private decoded EH seams preserve standalone flow results and diagnostics', () => {
  for (const options of [...nativeCases.map(value => value.options), { mode: 'overlap' }, { mode: 'boundary' }]) {
    const inspector = new AssemblyInspector(flowFixture(options).bytes);
    const method = inspector.getMethod(0x06000001), body = inspector.pe.methodBody(method.token);
    const expected = outcome(() => validateExceptionControlFlow(body.code, body.handlers));
    const actual = outcome(() => {
      const { tree, boundaries, limits } = decodedExceptionRegions(method.codeSize, method.instructions, method.handlers);
      assert(Object.isFrozen(tree));
      return validateDecodedExceptionControlFlow(method.instructions, tree, limits, boundaries);
    });
    assert.deepEqual(actual, expected, JSON.stringify(options));
  }
});

test('decoded seam preflights byte and instruction budgets before boundary allocation', () => {
  const fails = code => error => error.code === code;
  assert.throws(() => decodedExceptionRegions(2 ** 31, [], []), fails('CILR0002'));
  assert.throws(() => decodedExceptionRegions(-1, [], []), fails('CILR0001'));
  assert.throws(() => decodedExceptionRegions(0, [{}], [], { maxInstructions: 0 }), fails('CILR0029'));
  assert.throws(() => decodedExceptionRegions(0, [], [], { maxDepth: -1 }), fails('CILR0001'));
  assert.throws(() => decodedExceptionRegions(0, [], [], { signal: AbortSignal.abort() }), fails('CILR0003'));
});

test('decoded and byte-oriented trees keep instruction-prefix boundary validation', () => {
  const code = new CilWriter().op('volatile.').finish();
  const instructions = decodeInstructions(code);
  const expected = outcome(() => buildExceptionRegionTree(code, []));
  assert.equal(expected.code, 'CILR0030');
  assert.deepEqual(outcome(() => decodedExceptionRegions(code.length, instructions, [])), expected);
});
