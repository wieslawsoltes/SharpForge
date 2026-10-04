import test from 'node:test';
import assert from 'node:assert/strict';
import {Builtins, BuiltinMap, builtinOwners, builtinMemberShape, builtinParameterType} from '@sharpforge/bytecode';
import {compileToIL} from '@sharpforge/compiler';

test('public builtin metadata retains actual owners, source receivers and operand categories', () => {
  assert.equal(builtinOwners.Console, 'System.Console');
  assert.equal(builtinOwners.Debug, 'System.Diagnostics.Debug');
  assert.deepEqual(builtinMemberShape(BuiltinMap.get('Console.WriteLine')), {name: 'WriteLine', instance: false, property: false});
  assert.deepEqual(builtinMemberShape(BuiltinMap.get('string.Substring')), {name: 'Substring', instance: true, property: false});
  assert.deepEqual(builtinMemberShape(BuiltinMap.get('string.Concat')), {name: 'Concat', instance: false, property: false});
  assert.deepEqual(builtinMemberShape(BuiltinMap.get('Environment.TickCount')), {name: 'TickCount', instance: false, property: true});
  assert.equal(builtinParameterType(BuiltinMap.get('Console.WriteLine'), 'any'), 'object');
  for (const builtin of Builtins.filter(item => item && !item.contract && !item.name.startsWith('$'))) {
    assert.equal(typeof builtinMemberShape(builtin).name, 'string');
    assert.equal(Builtins[builtin.id], builtin, 'metadata projection must preserve runtime descriptor identity');
  }
});

test('shared builtin metadata preserves binding and both emitted runtime artifacts', () => {
  const result = compileToIL('using System; class C { static void Main() { Console.WriteLine("abc".Substring(1)); } }');
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.ok(result.image);
  assert.ok(result.assembly instanceof Uint8Array);
});
