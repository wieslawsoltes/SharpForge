import test from 'node:test';
import assert from 'node:assert/strict';
import {Builtins, builtinMemberShape} from '@sharpforge/bytecode';
import {RegistryBridge} from '../packages/compiler/src/symbols/registry-bridge.js';

test('finite synchronization and varargs profiles have source-visible owners and exact member shapes', () => {
  const bridge = new RegistryBridge();
  for (const builtin of Builtins.filter(entry => entry.synchronization || entry.varargs)) {
    const descriptor = builtin.synchronization ?? builtin.varargs, symbol = bridge.symbolForBuiltin(builtin);
    assert(symbol, descriptor.owner + '.' + descriptor.name);
    const shape = builtinMemberShape(builtin);
    assert.equal(symbol.name, descriptor.name);
    assert.equal(symbol.parameters.length, descriptor.parameters.length);
    assert.equal(symbol.isStatic, descriptor.isStatic);
    assert.equal(shape.instance, !descriptor.isStatic && descriptor.name !== '.ctor');
    if (descriptor.genericArity) {
      assert.equal(symbol.typeParameters.length, 1);
      assert.equal(symbol.typeParameters[0].hasReferenceTypeConstraint, true);
    }
  }
  for (const name of ['TypedReference', 'ArgIterator', 'RuntimeArgumentHandle', 'RuntimeTypeHandle']) {
    const type = bridge.typeFromName('System.' + name);
    assert.equal(type.isValueType, true);
    assert.equal(type, bridge.coreType('System_' + name));
  }
});
