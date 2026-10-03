import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, ManagedFault, VirtualMachine, isReference} from '@sharpforge/runtime';
import {findContracts, frameworkType} from '@sharpforge/framework';
import {invokeString} from '../packages/bcl-core/src/system/string.js';

function createPlatform(engine) {
  const compiled = compileToIL('using System; class Program { static void Main() {} }');
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
  vm.platform.bclHost = {frameworkType, isReference, fault: (type, message) => { throw new ManagedFault(type, message); }};
  return vm.platform;
}

function invoke(platform, name, args, parameterTypes) {
  const descriptor = findContracts('System.String', name).find(member =>
    member.parameters.join(',') === parameterTypes.join(','));
  assert.ok(descriptor, name);
  return invokeString(platform, descriptor, args).value;
}

for (const engine of ['source', 'cil']) {
  test(`BCL String ${engine}: ordinal operations and bounded split remainder`, () => {
    const platform = createPlatform(engine);
    const input = platform.heap.string('a,b,c');
    const separator = platform.heap.string(',');
    const split = invoke(platform, 'Split', [input, separator, 2], ['string', 'int']);
    assert.deepEqual(platform.heap.get(split).data.map(value => platform.native(value)), ['a', 'b,c']);
    const empty = invoke(platform, 'Split', [input, separator, 0], ['string', 'int']);
    assert.deepEqual(platform.heap.get(empty).data, []);
    assert.equal(platform.native(invoke(platform, 'Substring', [input, 2, 1], ['int', 'int'])), 'b');
    assert.equal(platform.native(invoke(platform, 'CompareOrdinal', [null, input], ['string', 'string'])), -1);
    assert.equal(platform.native(invoke(platform, 'CompareOrdinal', [input, input], ['string', 'string'])), 0);
    assert.equal(platform.native(invoke(platform, 'IsNullOrEmpty', [null], ['string'])), engine === 'cil' ? 1 : true);
  });

  test(`BCL String ${engine}: invalid inputs retain managed exception types`, () => {
    const platform = createPlatform(engine);
    const input = platform.heap.string('abc');
    const empty = platform.heap.string('');
    assert.throws(() => invoke(platform, 'Substring', [input, 4], ['int']), {name: 'ArgumentOutOfRangeException'});
    assert.throws(() => invoke(platform, 'Substring', [input, 1, 3], ['int', 'int']), {name: 'ArgumentOutOfRangeException'});
    assert.throws(() => invoke(platform, 'Contains', [input, null], ['string']), {name: 'ArgumentNullException'});
    assert.throws(() => invoke(platform, 'ToString', [null], []), {name: 'NullReferenceException'});
    assert.throws(() => invoke(platform, 'Replace', [input, empty, null], ['string', 'string']), {name: 'ArgumentException'});
    assert.throws(() => invoke(platform, 'PadLeft', [input, 1000001], ['int']), {name: 'ArgumentOutOfRangeException'});
  });
}
