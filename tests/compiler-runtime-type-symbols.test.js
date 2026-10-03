import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '@sharpforge/compiler';
import {BuiltinMap} from '@sharpforge/bytecode';
import {RegistryBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {SymbolKind} from '../packages/compiler/src/symbols/types.js';

const bridge = new RegistryBridge();

test('Type name properties retain builtin getters and their instance receiver', () => {
  const type = bridge.typeFromName('System.Type');
  assert.equal(type.isStatic, false);
  for (const name of ['Name', 'FullName']) {
    const builtin = BuiltinMap.get('Type.' + name);
    const property = bridge.symbolForBuiltin(builtin);
    assert.equal(property.kind, SymbolKind.Property);
    assert.equal(property.containingType, type);
    assert.equal(property.isStatic, false);
    assert.equal(property.getMethod.builtin, builtin);
    assert.equal(property.getMethod.parameters.length, 0);
  }
  const source = 'Console.WriteLine("hello".GetType().Name);Console.WriteLine("hello".GetType().FullName);';
  const result = compile(source, {pipeline: 'verify'});
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
});

test('Enum.HasFlag, string interning and reference equality expose CLR member shapes', () => {
  const flag = bridge.symbolForBuiltin(BuiltinMap.get('Enum.HasFlag'));
  assert.equal(flag.containingType, bridge.typeFromName('System.Enum'));
  assert.equal(flag.isStatic, false);
  assert.equal(flag.parameters.length, 1);
  assert.equal(flag.parameters[0].type, bridge.typeFromName('System.Enum'));
  for (const name of ['string.Intern', 'string.IsInterned', 'object.ReferenceEquals']) {
    const builtin = BuiltinMap.get(name);
    const method = bridge.symbolForBuiltin(builtin);
    assert.equal(method.isStatic, true);
    assert.equal(method.parameters.length, builtin.params.length);
  }
});
