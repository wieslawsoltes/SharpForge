import test from 'node:test';
import assert from 'node:assert/strict';
import {cilAdmissionOptions} from '../packages/runtime/src/execution/cil-admission.js';

test('CIL admission reuses normalized options when no runtime quota or assembly override needs removal', () => {
  const signal = new AbortController().signal;
  const options = Object.freeze({maxMethods: 2, maxClauses: 4, methodToken: 0x06000001, signal});
  assert.equal(cilAdmissionOptions(options), options);
});

test('CIL admission removes each runtime-only quota without mutating caller options', () => {
  for (const quota of [{maxInstructions: 1}, {maxBytes: 256}, {maxInstructions: 20_000_000, maxBytes: 256}]) {
    const roots = Object.freeze([0x06000002]);
    const options = Object.freeze({...quota, maxMethods: 2, additionalMethodTokens: roots});
    const admission = cilAdmissionOptions(options);
    assert.notEqual(admission, options);
    assert.deepEqual(admission, {maxMethods: 2, additionalMethodTokens: roots});
    assert.equal(admission.additionalMethodTokens, roots);
    for (const [name, value] of Object.entries(quota)) assert.equal(options[name], value);
  }
});

test('explicit assembly quotas survive runtime filtering and override legacy structural settings', () => {
  const signal = new AbortController().signal;
  const assemblyLimits = Object.freeze({maxBytes: 4096, maxInstructions: 32, maxMethods: 2});
  const options = Object.freeze({maxBytes: 256, maxInstructions: 20_000_000, maxMethods: 9,
    maxClauses: 4, methodToken: 0x06000001, assemblyLimits, signal});
  const admission = cilAdmissionOptions(options);
  assert.deepEqual(admission, {maxBytes: 4096, maxInstructions: 32, maxMethods: 2,
    maxClauses: 4, methodToken: 0x06000001, signal});
  assert.equal(Object.hasOwn(admission, 'assemblyLimits'), false);
  assert.equal(options.maxBytes, 256);
  assert.equal(options.maxInstructions, 20_000_000);
  assert.equal(options.assemblyLimits, assemblyLimits);
});

test('an explicit assembly-only override is flattened even without runtime quota properties', () => {
  const options = Object.freeze({maxMethods: 9, assemblyLimits: Object.freeze({maxMethods: 1})});
  assert.deepEqual(cilAdmissionOptions(options), {maxMethods: 1});
  assert.deepEqual(cilAdmissionOptions(Object.freeze({assemblyLimits: undefined})), {});
});
