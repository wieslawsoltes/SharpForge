import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, ManagedFault, VirtualMachine, isReference} from '@sharpforge/runtime';
import {findContracts, frameworkType} from '@sharpforge/framework';
import {invokeStringBuilder} from '../packages/bcl-core/src/text/string-builder.js';

function createPlatform(engine) {
  const compiled = compileToIL('using System; class Program { static void Main() {} }');
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
  vm.platform.bclHost = {frameworkType, isReference, fault: (type, message) => { throw new ManagedFault(type, message); }};
  return vm.platform;
}

function invoke(platform, name, args, parameterTypes = []) {
  const descriptor = findContracts('System.Text.StringBuilder', name).find(member =>
    member.parameters.join(',') === parameterTypes.join(','));
  assert.ok(descriptor, name);
  return platform.heap.withRoots(args, () => invokeStringBuilder(platform, descriptor, args).value);
}

for (const engine of ['source', 'cil']) {
  test(`BCL StringBuilder ${engine}: heap chunks survive collection and snapshot restoration`, () => {
    const platform = createPlatform(engine);
    const initial = platform.heap.string('abc');
    const builder = invoke(platform, '.ctor', [initial], ['string']);
    platform.heap.withRoots([builder], () => {
      invoke(platform, 'Append', [builder, 42], ['int']);
      invoke(platform, 'Append', [builder, platform.managed(true, 'bool')], ['bool']);
      platform.heap.collect();
      assert.equal(platform.native(invoke(platform, 'ToString', [builder])), 'abc42True');
      assert.equal(invoke(platform, 'get_Length', [builder]), 9);
      const snapshot = platform.heap.snapshot();
      const suffix = platform.heap.string('!');
      invoke(platform, 'Append', [builder, suffix], ['string']);
      assert.equal(platform.native(invoke(platform, 'ToString', [builder])), 'abc42True!');
      platform.heap.restore(snapshot);
      assert.equal(platform.native(invoke(platform, 'ToString', [builder])), 'abc42True');
    });
  });

  test(`BCL StringBuilder ${engine}: edits, range checks and capacity failures`, () => {
    const platform = createPlatform(engine);
    const initial = platform.heap.string('abc');
    const builder = invoke(platform, '.ctor', [initial], ['string']);
    invoke(platform, 'set_Length', [builder, 5], ['int']);
    assert.equal(platform.native(invoke(platform, 'ToString', [builder])), 'abc\0\0');
    invoke(platform, 'Remove', [builder, 3, 2], ['int', 'int']);
    const insertion = platform.heap.string('!');
    invoke(platform, 'Insert', [builder, 1, insertion], ['int', 'string']);
    assert.equal(platform.native(invoke(platform, 'ToString', [builder, 1, 2], ['int', 'int'])), '!b');
    assert.throws(() => invoke(platform, 'set_Capacity', [builder, 3], ['int']), {name: 'ArgumentOutOfRangeException'});
    assert.throws(() => invoke(platform, 'Remove', [builder, 2, 9], ['int', 'int']), {name: 'ArgumentOutOfRangeException'});
    assert.throws(() => invoke(platform, 'ToString', [builder, -1, 1], ['int', 'int']), {name: 'ArgumentOutOfRangeException'});
    const empty = platform.heap.string('');
    assert.throws(() => invoke(platform, 'Replace', [builder, empty, null], ['string', 'string']), {name: 'ArgumentException'});
    assert.equal(platform.native(invoke(platform, 'ToString', [builder])), 'a!bc');
    invoke(platform, 'Clear', [builder]);
    assert.equal(invoke(platform, 'get_Length', [builder]), 0);
    assert.equal(platform.native(invoke(platform, 'ToString', [builder])), '');
  });
}
