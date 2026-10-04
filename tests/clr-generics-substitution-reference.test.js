import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeSignature, formatSignature } from '@sharpforge/cil';
import { substituteSignature } from '../packages/clr/src/index.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-substitution/native-signatures.json', import.meta.url)));
const primitive = name => ({ kind: 'primitive', name });

test('CLR substituted raw member signatures match independent CoreCLR closed generic reflection', () => {
  assert.match(native.runtime, /^\.NET 10\./);
  assert.ok(native.cases.some(item => item.name === 'Dictionary._entries'));
  assert.ok(native.cases.some(item => item.name === 'Dictionary.TryGetValue'));
  assert.ok(native.cases.some(item => item.name === 'Pair.Generic'));
  for (const item of native.cases) {
    const original = decodeSignature(Buffer.from(item.signature, 'base64'));
    const result = substituteSignature(original, {
      typeArguments: item.typeArguments.map(primitive), methodArguments: item.methodArguments?.map(primitive),
    });
    assert.deepEqual(formatSignature(result, { typeName: token => native.names[token] }), item.expected, item.name);
  }
});
