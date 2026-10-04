import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION, Op, Binary, verifyImage, verifiedSourceStackBound} from '@sharpforge/bytecode';

function fixture(code, handlers = [], locals = []) {
  return {formatVersion: FORMAT_VERSION, entryPoint: 0, constants: [40, 2], types: [], statics: [], sequencePoints: [],
    methods: [{id: 0, name: 'Main', qualifiedName: 'Main', isStatic: true, parameters: [], returnType: 'int',
      locals, handlers, code: Int32Array.from(code)}]};
}
const arithmetic = () => fixture([Op.CONST, 0, 0, Op.CONST, 1, 0, Op.BINARY, Binary['+'], 0, Op.RET, 0, 0]);

test('opt-in bounds retain the existing verification result and unchanged public wire IDs', () => {
  const image = arithmetic();
  assert.deepEqual(verifyImage(image), []);
  assert.equal(verifiedSourceStackBound(image, image.methods[0]), null);
  assert.deepEqual(verifyImage(image, {stackBounds: true}), []);
  const bound = verifiedSourceStackBound(image, image.methods[0]);
  assert.deepEqual(bound, {peak: 2});
  assert(Object.isFrozen(bound));
  assert.deepEqual([Op.CONST, Op.CALL, Op.RET, Op.ENUM, Binary['>>>']], [1, 15, 17, 29, 16]);
});

test('proofs reject a different owner, replaced or modified bodies, and handler changes', () => {
  const image = arithmetic(), method = image.methods[0];
  verifyImage(image, {stackBounds: true});
  assert.equal(verifiedSourceStackBound({...image}, method), null);
  const code = method.code;
  method.code = code.slice();
  assert.equal(verifiedSourceStackBound(image, method), null);
  method.code = code;
  method.code[1] = 1;
  assert.equal(verifiedSourceStackBound(image, method), null);
  method.code[1] = 0;
  method.handlers = [];
  assert.equal(verifiedSourceStackBound(image, method), null);
});

test('catch and finally entry seeds participate in the same CFG peak calculation', () => {
  const image = fixture([
    Op.CONST, 0, 0, Op.RET, 0, 0,
    Op.CONST, 0, 0, Op.CONST, 1, 0, Op.POP, 0, 0, Op.RET, 0, 0,
    Op.ENDFINALLY, 0, 0
  ], [{kind: 'catch', start: 0, end: 2, target: 2, slot: 0},
    {kind: 'finally', start: 0, end: 2, target: 6, handlerEnd: 7}], [{type: 'Exception', slot: 0}]);
  assert.deepEqual(verifyImage(image, {stackBounds: true}), []);
  assert.deepEqual(verifiedSourceStackBound(image, image.methods[0]), {peak: 2});
  image.methods[0].handlers[0].target = 3;
  assert.equal(verifiedSourceStackBound(image, image.methods[0]), null);
});

test('inconsistent control flow publishes no bounds for any method', () => {
  const image = fixture([Op.CONST, 0, 0, Op.JTRUE, 3, 0, Op.CONST, 1, 0, Op.RET, 0, 0]);
  assert(verifyImage(image, {stackBounds: true}).length > 0);
  assert.equal(verifiedSourceStackBound(image, image.methods[0]), null);
});
