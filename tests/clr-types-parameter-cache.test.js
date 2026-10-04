import test from 'node:test';
import assert from 'node:assert/strict';
import { createTypeDesc } from '../packages/clr/src/type-system/type-desc.js';

test('CLR descriptors resolve immutable generic parameter metadata only once, including empty owners', () => {
  for (const parameters of [Object.freeze([]), Object.freeze([{ name: 'T' }])]) {
    let reads = 0;
    const module = { genericParameters(token) {
      assert.equal(token, 0x02000002);
      reads++;
      return parameters;
    } };
    const type = createTypeDesc({ module, token: 0x02000002 });
    assert.equal(type.genericParameters, parameters);
    assert.equal(type.genericParameters, parameters);
    assert.equal(reads, 1);
  }
});
