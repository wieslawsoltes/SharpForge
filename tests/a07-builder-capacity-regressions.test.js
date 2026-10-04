import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {frameworkType, findContracts} from '@sharpforge/framework';
import {MAX} from '@sharpforge/bcl-core';

const builderType = 'System.Text.StringBuilder';
const engines = {
  source: compiled => new VirtualMachine(compiled.image),
  cil: compiled => new CilVirtualMachine(compiled.assembly)
};
const referenceDirectory = new URL('../packages/bcl-core/reference/builder-format/', import.meta.url);
const report = () => readFile(new URL('oracle.json', referenceDirectory), 'utf8').then(JSON.parse);

function contract(name, parameters) {
  const member = findContracts(builderType, name).find(candidate => JSON.stringify(candidate.parameters) === JSON.stringify(parameters));
  assert.ok(member, `Missing StringBuilder.${name}(${parameters})`);
  return member;
}

test('B05 StringBuilder metadata advertises the .NET default MaxCapacity', () => {
  assert.equal(frameworkType(builderType).properties.MaxCapacity.value, 2147483647);
});

for (const [engine, create] of Object.entries(engines)) {
  test(`B05 ${engine}: constructor capacities match pinned .NET defaults`, async () => {
    const compiled = compileToIL(`using System;using System.Text;
      var a = new StringBuilder(); var b = new StringBuilder(1);
      var c = new StringBuilder(0); var d = new StringBuilder("abc", 4);
      Console.WriteLine(a.Capacity); Console.WriteLine(a.MaxCapacity);
      Console.WriteLine(b.Capacity); Console.WriteLine(b.MaxCapacity);
      Console.WriteLine(c.Capacity); Console.WriteLine(c.MaxCapacity);
      Console.WriteLine(d.Capacity); Console.WriteLine(d.MaxCapacity);`);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const result = create(compiled).run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    const reference = await report();
    const expected = ['default', 'capacity', 'zero-capacity', 'text-capacity'].flatMap(id => {
      const fixture = reference.cases.find(row => row.id === id);
      return [fixture.capacity, fixture.maximum];
    });
    assert.equal(result.output, expected.join('\n') + '\n');
  });

  test(`B05 ${engine}: host allocation limits differ from invalid capacity arguments`, () => {
    const compiled = compileToIL('Console.WriteLine(0);');
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const platform = create(compiled).platform;
    const instance = platform.invoke(contract('.ctor', []), []);
    platform.heap.withRoots([instance], () => {
      for (const name of ['set_Capacity', 'EnsureCapacity', 'set_Length']) {
        const member = contract(name, ['int']);
        assert.throws(() => platform.invoke(member, [instance, -1]), {name: 'ArgumentOutOfRangeException'}, name);
        assert.throws(() => platform.invoke(member, [instance, MAX + 1]), {name: 'OutOfMemoryException'}, name);
      }
      assert.throws(() => platform.invoke(contract('.ctor', ['int']), [-1]), {name: 'ArgumentOutOfRangeException'});
      assert.throws(() => platform.invoke(contract('.ctor', ['int']), [MAX + 1]), {name: 'OutOfMemoryException'});
      assert.equal(platform.invoke(contract('get_Length', []), [instance]), 0);
      assert.equal(platform.invoke(contract('get_Capacity', []), [instance]), 16);
      assert.equal(platform.invoke(contract('get_MaxCapacity', []), [instance]), 2147483647);
      platform.invoke(contract('EnsureCapacity', ['int']), [instance, MAX]);
      assert.equal(platform.invoke(contract('get_Capacity', []), [instance]), MAX);
      platform.invoke(contract('Clear', []), [instance]);
      assert.equal(platform.native(platform.invoke(contract('ToString', []), [instance])), '');
    });
  });

  test(`B05 ${engine}: growth at the host text boundary fails before mutating the builder`, () => {
    const compiled = compileToIL('Console.WriteLine(0);');
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const platform = create(compiled).platform;
    const instance = platform.invoke(contract('.ctor', []), []);
    platform.heap.withRoots([instance], () => {
      platform.invoke(contract('set_Length', ['int']), [instance, MAX]);
      assert.equal(platform.invoke(contract('get_Length', []), [instance]), MAX);
      const value = platform.heap.string('x');
      platform.heap.withRoots([value], () => {
        assert.throws(() => platform.invoke(contract('Append', ['string']), [instance, value]), {name: 'OutOfMemoryException'});
        assert.throws(() => platform.invoke(contract('Insert', ['int', 'string']), [instance, 0, value]), {name: 'OutOfMemoryException'});
        const previous = platform.heap.string('\0');
        platform.heap.withRoots([previous], () => {
          const replacement = platform.heap.string('xx');
          assert.throws(() => platform.invoke(contract('Replace', ['string', 'string']), [instance, previous, replacement]),
            {name: 'OutOfMemoryException'});
        });
      });
      assert.equal(platform.invoke(contract('get_Length', []), [instance]), MAX);
      assert.equal(platform.native(platform.invoke(contract('ToString', []), [instance])), '\0'.repeat(MAX));
    });
  });
}

test('B05 native constructor evidence pins its source and exact .NET toolchain', async () => {
  const reference = await report();
  const source = await readFile(new URL('Program.cs', referenceDirectory));
  assert.equal(reference.sourceSHA256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.toolchain.sdk, '10.0.201');
  assert.equal(reference.toolchain.runtime, '10.0.5');
  assert.equal(reference.toolchain.referencePack, '10.0.5');
  assert.equal(reference.executed.exitCode, 0);
  assert.equal(reference.cases.find(row => row.id === 'negative-capacity').error, 'ArgumentOutOfRangeException');
});
