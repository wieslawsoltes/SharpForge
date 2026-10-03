import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, ManagedHeap, ManagedFault, isReference} from '@sharpforge/runtime';
import {contracts, findContracts} from '@sharpforge/framework';
import {frameworkBuiltin} from '@sharpforge/bytecode';
import {compositeFormat, createBclRegistry, MAX} from '@sharpforge/bcl-core';

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

function assertText(actual, expected, summary, id) {
  if (!summary) return assert.equal(actual, expected, id);
  assert.equal(actual.length, summary.length, id);
  assert.equal(createHash('sha256').update(actual).digest('hex'), summary.sha256, id);
  assert.equal(actual.slice(0, 16), summary.prefix, id);
  assert.equal(actual.slice(-16), summary.suffix, id);
}

function managedArguments(platform, values) {
  if (values === null) return null;
  return platform.heap.withRoots([], () => {
    const items = values.map(value => {
      const managed = typeof value === 'number' ? platform.heap.allocate('box', 'int', [value])
        : typeof value === 'string' ? platform.heap.string(value) : value;
      platform.heap.pins.push(managed);
      return managed;
    });
    return platform.heap.allocate('array', 'object[]', items);
  });
}

function assertBuilderFixture(platform, fixture) {
  platform.heap.withRoots([], () => {
    const initial = platform.heap.string('prefix|');
    platform.heap.pins.push(initial);
    const instance = platform.invoke(contract('.ctor', ['string']), [initial]);
    platform.heap.pins.push(instance);
    const format = fixture.format === null ? null : platform.heap.string(fixture.format);
    platform.heap.pins.push(format);
    const args = managedArguments(platform, fixture.arguments);
    let error = null;
    try { platform.invoke(contract('AppendFormat', ['string', 'object[]']), [instance, format, args]); }
    catch (exception) { error = exception.name; }
    const hostLimit = fixture.builderSummary?.length > MAX;
    assert.equal(error, hostLimit ? 'OutOfMemoryException' : fixture.builderError, fixture.id);
    const actual = platform.native(platform.invoke(contract('ToString', []), [instance]));
    if (hostLimit) assert.equal(actual, 'prefix|', fixture.id);
    else assertText(actual, fixture.builder, fixture.builderSummary, fixture.id);
  });
}

for (const [engine, create] of Object.entries(engines)) {
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
    for (const fixture of reference.cases.filter(row => Object.hasOwn(row, 'format'))) {
      assertBuilderFixture(platform, fixture);
    }
  });

  test(`B06 ${engine}: params formatting preserves boxed integer types and argument evaluation order`, () => {
    const compiled = compileToIL(prefix + `
      var builder = new StringBuilder(); int next = 0;
      builder.AppendFormat("{0:D3}/{1}/{2}/{3}", 42, ++next, ++next, ++next);
      Console.WriteLine(builder.ToString()); builder.Clear();
      builder.AppendFormat("{0:D3}", new object[] {42}); Console.WriteLine(builder.ToString());
      Console.WriteLine(next);`);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const result = create(compiled).run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    assert.equal(result.output, '042/1/2/3\n042\n3\n');
  });
}

test('B06 params overload uses reserved A07 ID while released StringBuilder IDs remain intact', () => {
  const member = contract('AppendFormat', ['string', 'object[]']);
  assert.equal(member.id, 524288);
  assert.equal(member.paramsIndex, 1);
  assert.equal(frameworkBuiltin(member).contract, member);
  assert.deepEqual(contracts.filter(row => row.owner === builderType && row.id < 65536).map(row => row.id),
    Array.from({length: 26}, (_, index) => 795 + index));
});

test('B06 module extension hooks register separately and reject malformed or async hooks', () => {
  const calls = [];
  const contribution = {
    name: 'sample', families: ['sample'], group: 'released',
    contracts: () => calls.push('released'), extensionContracts: () => calls.push('extended'),
    invoke: () => ({handled: false})
  };
  const registry = createBclRegistry([contribution]);
  registry.register({}, {group: 'released'});
  registry.register({}, {group: 'extensions'});
  assert.deepEqual(calls, ['released', 'extended']);
  calls.length = 0;
  registry.register({});
  assert.deepEqual(calls, ['released', 'extended']);
  calls.length = 0;
  registry.register({}, {names: ['sample']});
  assert.deepEqual(calls, ['released', 'extended']);
  assert.throws(() => createBclRegistry([{...contribution, extensionContracts: true}]), TypeError);
  const asynchronous = createBclRegistry([{...contribution, extensionContracts: () => Promise.resolve()}]);
  assert.throws(() => asynchronous.register({}, {group: 'extensions'}), /must be synchronous/);
  assert.throws(() => asynchronous.register({}), /must be synchronous/);
});

test('B06 composite parser follows pinned .NET whitespace and brace grammar', async () => {
  for (const fixture of (await report()).cases.filter(row => Object.hasOwn(row, 'format'))) {
    const platform = formatHost();
    const values = fixture.arguments?.map(value => typeof value === 'number'
      ? platform.heap.allocate('box', 'int', [value]) : value) ?? null;
    if (fixture.error) {
      assert.throws(() => compositeFormat(platform, fixture.format, values), {name: fixture.error}, fixture.id);
    } else {
      assertText(compositeFormat(platform, fixture.format, values), fixture.result, fixture.resultSummary, fixture.id);
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
