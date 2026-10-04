import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {findContracts} from '@sharpforge/framework';

const referenceDirectory = new URL('./fixtures/json-escaping/', import.meta.url);
let referencePromise;
const reference = () => referencePromise ??= readFile(new URL('oracle.json', referenceDirectory), 'utf8').then(JSON.parse);
const engines = {
  source: compiled => new VirtualMachine(compiled.image),
  cil: compiled => new CilVirtualMachine(compiled.assembly)
};

function contract(owner, name, parameters) {
  const member = findContracts(owner, name).find(candidate => JSON.stringify(candidate.parameters) === JSON.stringify(parameters));
  assert.ok(member, `Missing ${owner}.${name}(${parameters})`);
  return member;
}

function serialize(platform, value) {
  const member = contract('System.Text.Json.JsonSerializer', 'Serialize', ['object']);
  return platform.native(platform.invoke(member, [value]));
}

function input(fixture) {
  return fixture.units === null ? null : String.fromCharCode(...fixture.units);
}

function sourceLiteral(fixture) {
  if (fixture.units === null) return 'null';
  return '"' + fixture.units.map(unit => '\\u' + unit.toString(16).padStart(4, '0')).join('') + '"';
}

function assertFixture(platform, fixture) {
  platform.heap.withRoots([], () => {
    const value = input(fixture);
    const managed = value === null ? null : platform.heap.string(value);
    platform.heap.pins.push(managed);
    assert.equal(serialize(platform, managed), fixture.scalar, fixture.id + ' scalar');
    const tail = platform.heap.string('tail');
    platform.heap.pins.push(tail);
    const array = platform.heap.allocate('array', 'string[]', [managed, tail, null]);
    assert.equal(serialize(platform, array), fixture.array, fixture.id + ' array');
    const owner = 'Dictionary<string,string>';
    const dictionary = platform.invoke(contract(owner, '.ctor', []), []);
    platform.heap.pins.push(dictionary);
    const key = platform.heap.string('key' + (value ?? ''));
    platform.invoke(contract(owner, 'set_Item', ['string', 'string']), [dictionary, key, managed]);
    assert.equal(serialize(platform, dictionary), fixture.dictionary, fixture.id + ' dictionary');
  });
}

for (const [engine, create] of Object.entries(engines)) {
  test(`A09 ${engine}: default escaping matches native scalar, array and dictionary cases`, async () => {
    const compiled = compileToIL('Console.WriteLine(0);');
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const platform = create(compiled).platform;
    for (const fixture of (await reference()).cases.filter(row => Object.hasOwn(row, 'units'))) assertFixture(platform, fixture);
  });

  test(`A09 ${engine}: compiled serializer calls retain UTF-16 string escaping`, async () => {
    const ids = new Set(['html', 'astral', 'high-surrogate', 'low-surrogate', 'escaped-looking', 'empty', 'null']);
    const fixtures = (await reference()).cases.filter(row => ids.has(row.id));
    const source = 'using System;using System.Text.Json;\n' + fixtures.map(fixture =>
      `Console.WriteLine(JsonSerializer.Serialize(${sourceLiteral(fixture)}));`).join('\n');
    const compiled = compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const result = create(compiled).run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    assert.equal(result.output, fixtures.map(fixture => fixture.scalar).join('\n') + '\n');
  });

  test(`A09 ${engine}: registered string collections use the same default escaping`, async () => {
    const fixture = (await reference()).cases.find(row => row.id === 'html');
    const compiled = compileToIL('Console.WriteLine(0);');
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const platform = create(compiled).platform;
    platform.heap.withRoots([], () => {
      const value = platform.heap.string(input(fixture));
      platform.heap.pins.push(value);
      const tail = platform.heap.string('tail');
      platform.heap.pins.push(tail);
      const array = platform.heap.allocate('array', 'string[]', [value, tail, null]);
      platform.heap.pins.push(array);
      const reversed = platform.heap.allocate('array', 'string[]', [null, tail, value]);
      platform.heap.pins.push(reversed);
      for (const family of ['List', 'Queue', 'Stack', 'HashSet']) {
        const member = contract(`${family}<string>`, '.ctor', ['string[]']);
        const collection = platform.invoke(member, [family === 'Stack' ? reversed : array]);
        assert.equal(serialize(platform, collection), fixture.array, family);
      }
    });
  });

  test(`A09 ${engine}: escape expansion enforces the existing JSON output budget`, async () => {
    const compiled = compileToIL('Console.WriteLine(0);');
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const platform = create(compiled).platform;
    for (const fixture of (await reference()).cases.filter(row => Object.hasOwn(row, 'repeat'))) {
      const value = platform.heap.string(String.fromCharCode(fixture.repeat).repeat(fixture.count));
      if (fixture.length > 1_000_000) {
        assert.throws(() => serialize(platform, value), {name: 'JsonException'}, fixture.id);
      } else {
        const actual = serialize(platform, value);
        assert.equal(actual.length, fixture.length, fixture.id);
        assert.equal(createHash('sha256').update(actual).digest('hex'), fixture.sha256, fixture.id);
        assert.equal(actual.slice(0, 16), fixture.prefix, fixture.id);
        assert.equal(actual.slice(-16), fixture.suffix, fixture.id);
      }
    }
  });

  test(`A09 ${engine}: serializer retains cycle and unsupported-object failures`, () => {
    const compiled = compileToIL('Console.WriteLine(0);');
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const platform = create(compiled).platform;
    const cycle = platform.heap.allocate('array', 'object[]', [null]);
    platform.heap.get(cycle).data[0] = cycle;
    assert.throws(() => serialize(platform, cycle), {name: 'JsonException'});
    const unsupported = platform.heap.object('UnregisteredObject', []);
    assert.throws(() => serialize(platform, unsupported), {name: 'NotSupportedException'});
  });
}

test('A09 default escaping reference pins its source, SDK, runtime and complete ASCII coverage', async () => {
  const report = await reference();
  const source = await readFile(new URL('Program.cs', referenceDirectory));
  assert.equal(report.sourceSHA256, createHash('sha256').update(source).digest('hex'));
  assert.equal(report.toolchain.sdk, '10.0.201');
  assert.equal(report.toolchain.runtime, '10.0.5');
  assert.equal(report.toolchain.referencePack, '10.0.5');
  assert.equal(report.compiled.exitCode, 0);
  assert.equal(report.executed.exitCode, 0);
  assert.equal(report.cases.filter(row => row.id.startsWith('ascii-')).length, 128);
});
