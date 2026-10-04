import test from 'node:test';
import assert from 'node:assert/strict';
import {Op} from '@sharpforge/bytecode';
import {analyzeMethod, CilError} from '@sharpforge/cil';

test('source stack analysis exposes stable instruction input and output types', () => {
  const image = {constants: [42], types: [], methods: [], statics: []};
  const method = {qualifiedName: 'Program.Main', locals: [], handlers: [],
    code: Int32Array.from([Op.CONST, 0, 0, Op.RET, 0, 0])};
  const result = analyzeMethod(image, method);
  assert.deepEqual(result.states, [[], ['int']]);
  assert.deepEqual(result.outputs, [['int'], []]);
  assert.equal(result.maxStack, 1);
  assert.throws(() => analyzeMethod(image, {...method, code: Int32Array.from([Op.RET, 0, 0])}), CilError);
});
