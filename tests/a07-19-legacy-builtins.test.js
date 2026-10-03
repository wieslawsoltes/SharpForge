import test from 'node:test';
import assert from 'node:assert/strict';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {hasLegacyBclBuiltin, invokeLegacyBclBuiltin, legacyBclBuiltinNames} from '@sharpforge/bcl-core';
import {legacyBuiltinCases} from './fixtures/a07/legacy-builtins.js';
import {sourceImage, cilAssembly, execute} from './fixtures/a07/legacy-builtin-engines.js';

test('A07 legacy parity fixture contains sixty distinct parse, conversion and string calls', () => {
  assert.equal(legacyBuiltinCases.length, 60);
  assert.equal(new Set(legacyBuiltinCases.map(row => JSON.stringify(row))).size, 60);
});

for (const [index, fixture] of legacyBuiltinCases.entries()) {
  test(`A07 legacy source and direct CIL ${index + 1}: ${fixture.name} ${JSON.stringify(fixture.args)}`, () => {
    const expected = fixture.fault ? {fault: fixture.expected} : {value: fixture.expected};
    const source = execute(fixture, 'source');
    const cil = execute(fixture, 'cil');
    assert.deepEqual(source, expected, 'source bytecode result');
    assert.deepEqual(cil, expected, 'independent direct CIL result');
    assert.deepEqual(source, cil);
  });
}

test('A07 Replace with a null old value reports ArgumentNullException on both engines', () => {
  // The source builtin previously threw ArgumentException; the contract path already used ArgumentNullException.
  const fixture = {name: 'string.Replace', args: ['abc', null, 'x'], result: 'string'};
  for (const engine of ['source', 'cil']) {
    assert.deepEqual(execute(fixture, engine), {fault: 'ArgumentNullException'});
  }
});

test('A07 legacy builtin host caches do not enter source or CIL VM snapshots', () => {
  const fixture = {name: 'Convert.ToString', args: [true], result: 'string', parameter: 'bool'};
  for (const engine of ['source', 'cil']) {
    const vm = engine === 'source'
      ? new VirtualMachine(sourceImage(fixture))
      : new CilVirtualMachine(cilAssembly(fixture), {arguments: fixture.args});
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(vm.value(vm.returnValue), 'True');
      assert.equal(Object.hasOwn(vm, 'legacyBclHost'), false);
      assert.equal(Object.hasOwn(vm, 'legacyBclHosts'), false);
      const snapshot = vm.snapshot();
      vm.restore(snapshot);
      assert.equal(vm.value(vm.returnValue), 'True');
    } finally {
      vm.stop();
    }
  }
});

test('A07 legacy package surface keeps explicit host services and rejects unknown operations', () => {
  const host = {
    heap: {string: value => ({text: value})},
    value: value => value,
    format: value => value === null ? '' : String(value),
    runtimeTypeText: () => null,
    fault: (name, message) => Object.assign(new Error(message), {name})
  };
  assert(Object.isFrozen(legacyBclBuiltinNames));
  for (const name of legacyBclBuiltinNames) assert(hasLegacyBclBuiltin(name));
  assert.equal(hasLegacyBclBuiltin('toString'), false);
  assert.equal(hasLegacyBclBuiltin('Math.Abs'), false);
  assert.deepEqual(invokeLegacyBclBuiltin(host, 'object.ToString', [42]), {text: '42'});
  assert.throws(() => invokeLegacyBclBuiltin(host, 'toString', []), {name: 'MissingMethodException'});
  assert.throws(() => invokeLegacyBclBuiltin(host, 'Math.Abs', [-1]), {name: 'MissingMethodException'});
});
