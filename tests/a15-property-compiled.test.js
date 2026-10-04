import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCompiledBindingDescriptor} from '@sharpforge/winui-properties';

const member = 0x17000001;
const other = 0x17000002;
const path = (...tokens) => ({kind: 'path', steps: tokens.map(token => ({token}))});
const descriptor = expression => ({version: 1, kind: 'property', mode: 'OneWay', target: {id: 'target', token: member}, expression});

test('A15 compiled descriptor rejects executable data, accessors and invalid token paths', () => {
  const valid = descriptor(path(member));
  assert(Object.isFrozen(validateCompiledBindingDescriptor(valid)));
  for (const invalid of [
    {...valid, version: 2}, {...valid, expression: path(0)}, {...valid, execute: () => 1},
    {...valid, expression: {kind: 'path', steps: [{name: 'Property'}]}}
  ]) assert.throws(() => validateCompiledBindingDescriptor(invalid), {kind: 'ArgumentException'});
  let calls = 0;
  const getter = {...valid};
  Object.defineProperty(getter, 'expression', {get() { calls++; return path(member); }, enumerable: true});
  assert.throws(() => validateCompiledBindingDescriptor(getter), {kind: 'ArgumentException'});
  assert.equal(calls, 0);
});

