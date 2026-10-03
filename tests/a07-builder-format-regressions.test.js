import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, ManagedHeap, ManagedFault, isReference} from '@sharpforge/runtime';
import {frameworkType, findContracts} from '@sharpforge/framework';
import {compositeFormat, MAX} from '@sharpforge/bcl-core';

const builderType = 'System.Text.StringBuilder';
const prefix = 'using System;using System.Text;';
const engines = {
  source: compiled => new VirtualMachine(compiled.image),
  cil: compiled => new CilVirtualMachine(compiled.assembly)
};
const reportURL = new URL('../packages/bcl-core/reference/builder-format/oracle.json', import.meta.url);
let reportPromise;
const report = () => reportPromise ??= readFile(reportURL, 'utf8').then(JSON.parse);

function contract(name, parameters) {
  const member = findContracts(builderType, name).find(candidate => JSON.stringify(candidate.parameters) === JSON.stringify(parameters));
  assert.ok(member, `Missing StringBuilder.${name}(${parameters})`);
  return member;
}

function formatHost() {
  const heap = new ManagedHeap();
  return {heap, native: value => value, vm: {format: value => String(value)},
    bclHost: {isReference, fault(name, message) { throw new ManagedFault(name, message); }}};
}

test('B05 StringBuilder metadata advertises the .NET default MaxCapacity', () => {
  assert.equal(frameworkType(builderType).properties.MaxCapacity.value, 2147483647);
});

for (const [engine, create] of Object.entries(engines)) {
  test(`B05 ${engine}: declared MaxCapacity and runtime agree across constructors`, () => {
    const compiled = compileToIL(prefix + `
      Console.WriteLine(new StringBuilder().MaxCapacity);
      Console.WriteLine(new StringBuilder(1).MaxCapacity);
      Console.WriteLine(new StringBuilder("value", 8).MaxCapacity);`);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const result = create(compiled).run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    assert.equal(result.output, '2147483647\n2147483647\n2147483647\n');
  });

  test(`B05 ${engine}: host allocation limits remain distinct from invalid capacity arguments`, () => {
    const compiled = compileToIL('Console.WriteLine(0);');
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const platform = create(compiled).platform;
    const constructor = contract('.ctor', []);
    const instance = platform.invoke(constructor, []);
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
    });
  });

  test(`B06 ${engine}: AppendFormat supports expanded, explicit and empty params arrays`, () => {
    const compiled = compileToIL(prefix + `
      var builder = new StringBuilder();
      builder.AppendFormat("{0}/{1}/{2}/{3}", 1, 2, 3, 4);
      Console.WriteLine(builder.ToString()); builder.Clear();
      builder.AppendFormat("{0}{1}{2}{3}{4}{5}{6}{7}", 0, 1, 2, 3, 4, 5, 6, 7);
      Console.WriteLine(builder.ToString()); builder.Clear();
      builder.AppendFormat("{0}/{1}/{2}/{3}", new object[] {1, 2, 3, 4});
      Console.WriteLine(builder.ToString()); builder.Clear();
      builder.AppendFormat("literal"); Console.WriteLine(builder.ToString());`);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const result = create(compiled).run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    assert.equal(result.output, '1/2/3/4\n01234567\n1/2/3/4\nliteral\n');
  });

  test(`B06 ${engine}: AppendFormat parsing and partial writes match the pinned native corpus`, async () => {
    const reference = await report();
    const compiled = compileToIL('Console.WriteLine(0);');
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const platform = create(compiled).platform;
    const constructor = contract('.ctor', ['string']);
    const append = contract('AppendFormat', ['string', 'object[]']);
    for (const fixture of reference.cases.filter(row => Object.hasOwn(row, 'format'))) {
      const referenceText = platform.heap.string('prefix|');
      platform.heap.withRoots([referenceText], () => {
        const instance = platform.invoke(constructor, [referenceText]);
        platform.heap.withRoots([instance], () => {
          const format = fixture.format === null ? null : platform.heap.string(fixture.format);
          platform.heap.withRoots([format], () => {
            const values = fixture.arguments?.map(value => typeof value === 'number'
              ? platform.heap.allocate('box', 'int', [value]) : typeof value === 'string' ? platform.heap.string(value) : value);
            const arguments_ = values ? platform.heap.allocate('array', 'object[]', values) : null;
            let error = null;
            try { platform.invoke(append, [instance, format, arguments_]); }
            catch (exception) { error = exception.name; }
            assert.equal(error, fixture.builderError, fixture.id);
            assert.equal(platform.native(platform.invoke(contract('ToString', []), [instance])), fixture.builder, fixture.id);
          });
        });
      });
    }
  });
}

test('B06 composite parser follows pinned .NET whitespace and brace grammar', async () => {
  for (const fixture of (await report()).cases.filter(row => Object.hasOwn(row, 'format'))) {
    const platform = formatHost();
    const values = fixture.arguments?.map(value => typeof value === 'number'
      ? platform.heap.allocate('box', 'int', [value]) : value) ?? null;
    if (fixture.error) {
      assert.throws(() => compositeFormat(platform, fixture.format, values), {name: fixture.error}, fixture.id);
    } else {
      assert.equal(compositeFormat(platform, fixture.format, values), fixture.result, fixture.id);
    }
  }
});

test('B06 native corpus pins its source and exact .NET toolchain', async () => {
  const reference = await report();
  const source = await readFile(new URL('../packages/bcl-core/reference/builder-format/Program.cs', import.meta.url));
  assert.equal(reference.sourceSHA256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.toolchain.sdk, '10.0.201');
  assert.equal(reference.toolchain.runtime, '10.0.5');
  assert.equal(reference.toolchain.referencePack, '10.0.5');
  assert.equal(reference.executed.exitCode, 0);
  assert(reference.cases.length >= 50);
});
