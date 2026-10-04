import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {enumTypes, enumValue, findContracts, frameworkType} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {comparisonType, comparisonNames, equalsParameters, equalsArguments, equalsExpression,
  equalsComparisonAssembly, expectedFault} from './fixtures/comparers/string-equals-comparison.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-equals-comparison-net10.json', directory), 'utf8'));
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
const successful = reference.rows.filter(row => row.group === 'ordinal' && row.fault === null);
const programs = new Map();

function compile(source, pipeline = 'bound') {
  const key = pipeline + source;
  if (!programs.has(key)) {
    const program = compileToIL('using System; ' + source, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    programs.set(key, program);
  }
  return programs.get(key);
}

function contract(instance) {
  const parameters = equalsParameters(instance);
  const descriptor = findContracts('System.String', 'Equals', !instance)
    .find(row => row.parameters.join(',') === parameters.join(','));
  assert(descriptor, 'Missing String.Equals(' + parameters.join(',') + ')');
  return descriptor;
}

function assertFault(fault, row) {
  const expected = expectedFault(row);
  assert.equal(fault?.name, expected, row.id);
  if (expected === 'NotSupportedException') assert.match(fault.message, /Ordinal.*OrdinalIgnoreCase/, row.id);
  else if (row.parameter) assert(fault.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + fault.message);
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`String.Equals comparison ${pipeline}/${engine}: idiomatic enum constants match native ordinal results`, () => {
      const source = successful.map(row => `Console.WriteLine(${equalsExpression(row)});`).join('\n');
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, successful.map(row => row.result ? 'True' : 'False').join('\n') + '\n');
      } finally {vm.stop();}
    });

    test(`String.Equals comparison ${pipeline}/${engine}: enum locals use the registered parameter type`, () => {
      const vm = create(compile('StringComparison mode = StringComparison.OrdinalIgnoreCase;' +
        'Console.WriteLine(string.Equals("abc", "ABC", mode)); Console.WriteLine("abc".Equals("ABC", mode));' +
        'mode = StringComparison.Ordinal; Console.WriteLine(string.Equals("abc", "ABC", mode));' +
        'Console.WriteLine("abc".Equals("ABC", mode));', pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\nTrue\nFalse\nFalse\n');
      } finally {vm.stop();}
    });
  }

  test(`String.Equals comparison ${engine}: compiled invalid modes and null receivers retain fault precedence`, () => {
    const ids = ['invalid/nulls/-1/static', 'invalid/identity/6/static', 'invalid/allocated-equal/6/instance',
      'invalid/nulls/6/instance', 'ordinal/null-left/5/instance', 'culture/identity/0/static',
      'culture/null-right/3/instance', 'culture/nulls/0/instance'];
    for (const id of ids) {
      const row = reference.rows.find(value => value.id === id);
      assert(row, id);
      const vm = create(compile(`Console.WriteLine(${equalsExpression(row)});`));
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted', row.id + ': ' + result.output);
        assertFault(result.fault, row);
      } finally {vm.stop();}
    }
  });

  test(`String.Equals comparison ${engine}: real platform calls cover all native rows and explicit culture guards`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const args = reference.rows.map(row => {
          const values = equalsArguments(row);
          const first = platform.managed(values[0], 'string');
          platform.heap.pins.push(first);
          const second = row.sameReference ? first : platform.managed(values[1], 'string');
          platform.heap.pins.push(second);
          if (row.copyRight) assert.notEqual(first.h, second.h, row.id);
          return [first, second, values[2]];
        });
        const descriptors = [contract(false), contract(true)];
        const allocations = platform.heap.stats.allocations;
        const bytes = platform.heap.stats.allocatedBytes;
        const revision = platform.heap.mutationRevision;
        for (let index = 0; index < reference.rows.length; index++) {
          const row = reference.rows[index];
          const invoke = () => platform.invoke(descriptors[Number(row.instance)], args[index]);
          if (expectedFault(row)) assert.throws(invoke, fault => {assertFault(fault, row); return true;});
          else assert.equal(Boolean(invoke()), row.result, row.id);
        }
        assert.equal(platform.heap.stats.allocations, allocations);
        assert.equal(platform.heap.stats.allocatedBytes, bytes);
        assert.equal(platform.heap.mutationRevision, revision);
        platform.heap.collect();
        assert.equal(Boolean(platform.invoke(descriptors[0], args[0])), true);
      });
      assert.equal(platform.heap.pins.length, 0);
    } finally {vm.stop();}
  });

  test(`String.Equals comparison ${engine}: large Unicode prefixes allocate no managed folded strings`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const first = platform.heap.string('é'.repeat(8192) + '\uD800a\uDC00');
        platform.heap.pins.push(first);
        const second = platform.heap.string('É'.repeat(8192) + '\uD800A\uDC00');
        platform.heap.pins.push(second);
        const allocations = platform.heap.stats.allocations;
        assert.equal(Boolean(platform.invoke(contract(false), [first, second, 4])), false);
        assert.equal(Boolean(platform.invoke(contract(false), [first, second, 5])), true);
        assert.equal(Boolean(platform.invoke(contract(true), [first, second, 5])), true);
        assert.equal(platform.heap.stats.allocations, allocations);
      });
    } finally {vm.stop();}
  });

  test(`String.Equals comparison ${engine}: released two-string equality remains ordinal`, () => {
    const vm = create(compile('Console.WriteLine(string.Equals("a", "A"));' +
      'Console.WriteLine(string.Equals(null, null));Console.WriteLine(string.Equals("same", "xsame".Substring(1)));'));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, 'False\nTrue\nTrue\n');
    } finally {vm.stop();}
  });
}

test('String.Equals comparison: independent CIL checks every native result/fault and deliberate culture guard', () => {
  const assemblies = new Map();
  for (const row of reference.rows) {
    const key = String(row.instance) + row.sameReference;
    if (!assemblies.has(key)) assemblies.set(key, equalsComparisonAssembly(row.instance, row.sameReference));
    const vm = new CilVirtualMachine(assemblies.get(key), {arguments: equalsArguments(row)});
    try {
      const result = vm.run();
      assert.equal(result.state, expectedFault(row) ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (expectedFault(row)) assertFault(result.fault, row);
      else assert.equal(result.returnValue, row.result, row.id);
    } finally {vm.stop();}
  }
});

test('String.Equals comparison: enum metadata and two appended contracts preserve released ABI', () => {
  const type = frameworkType(comparisonType);
  assert.equal(type?.kind, 'enum');
  assert.deepEqual(type.values, Object.fromEntries(comparisonNames.map((name, index) => [name, index])));
  for (const [index, name] of comparisonNames.entries()) {
    assert.deepEqual(enumValue('StringComparison.' + name), {type: comparisonType, value: index});
  }
  assert.equal(enumTypes.indexOf('Microsoft.UI.Xaml.Controls.Orientation'), 0);
  assert.equal(enumTypes.indexOf('Microsoft.UI.Xaml.Visibility'), 3);
  assert.equal(enumTypes.indexOf('System.Text.Json.JsonValueKind'), 14);
  assert.equal(enumTypes.indexOf(comparisonType), 15);
  assert.equal(contract(false).id, 524299);
  assert.equal(contract(true).id, 524300);
  assert.equal(findContracts('System.String', 'Equals', true).find(row => row.parameters.length === 2).id, 1253);
  assert.equal(findContracts('System.String', 'CompareOrdinal', true).find(row => row.parameters.length === 5).id, 524298);
  assert.equal(findContracts('System.StringComparer', 'get_OrdinalIgnoreCase', true)[0].id, 524297);
  assert.equal(findContracts('System.Environment', 'GetEnvironmentVariable', true)[0].id, 524289);
});

test('String.Equals comparison: unchanged native oracle retains invalid-enum and null-receiver evidence', () => {
  const source = readFileSync(new URL('string-equals-comparison/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.rows.length, 220);
  const row = id => reference.rows.find(value => value.id === id);
  assert.equal(row('invalid/nulls/6/static').fault, 'ArgumentException');
  assert.equal(row('invalid/identity/6/instance').parameter, 'comparisonType');
  assert.equal(row('invalid/nulls/6/instance').fault, 'NullReferenceException');
  assert.equal(row('ordinal/allocated-equal/4/static').sameReference, false);
  assert.equal(row('ordinal/identity/4/static').sameReference, true);
  assert.equal(row('culture/identity/0/static').result, true);
  assert.equal(row('culture/identity/0/static').fault, null);
});
