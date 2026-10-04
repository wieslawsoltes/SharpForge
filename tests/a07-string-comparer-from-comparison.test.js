import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {comparerType, factoryParameters, fromUnits, expectedFactoryFault, factoryExpression,
  factoryComparisonAssembly, factoryIdentityAssembly} from './fixtures/comparers/string-comparer-from-comparison.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-comparer-from-comparison-net10.json', directory), 'utf8'));
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
const stringInterface = 'System.Collections.Generic.IComparer`1<string>';
const objectInterface = 'System.Collections.IComparer';
const listType = 'System.Collections.Generic.List`1<string>';
const programs = new Map();
const ordinalRows = reference.rows.filter(row => row.culture === '' && row.mode >= 4 && row.mode <= 5);

function compile(source, pipeline = 'bound') {
  const key = pipeline + source;
  if (!programs.has(key)) {
    const program = compileToIL('using System;using System.Collections.Generic;' + source, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    programs.set(key, program);
  }
  return programs.get(key);
}

function contract(owner, name, parameters = []) {
  const descriptor = findContracts(owner, name).find(row => row.parameters.join(',') === parameters.join(','));
  assert(descriptor, `Missing ${owner}.${name}(${parameters.join(',')})`);
  return descriptor;
}

function assertFault(error, row) {
  assert.equal(error?.name, expectedFactoryFault(row));
  if (row.parameter) assert.match(error.message, /\(Parameter 'comparisonType'\)/);
  else assert.match(error.message, /StringComparer.FromComparison.*Ordinal.*OrdinalIgnoreCase/);
}

function pin(platform, value) {
  const reference = platform.managed(value, 'string');
  platform.heap.pins.push(reference);
  return reference;
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`StringComparer.FromComparison ${pipeline}/${engine}: native signs, interface calls and sorting`, () => {
      const lines = [], expected = [];
      for (const row of ordinalRows) {
        const getter = row.mode === 4 ? 'Ordinal' : 'OrdinalIgnoreCase';
        lines.push(`{ StringComparison mode = StringComparison.${getter}; var comparer = StringComparer.FromComparison(mode);`);
        lines.push(`Console.WriteLine(Object.ReferenceEquals(comparer, StringComparer.${getter}));`);
        lines.push('Console.WriteLine(Object.ReferenceEquals(comparer, StringComparer.FromComparison(mode)));');
        expected.push('True', 'True');
        lines.push('IComparer<string> view = comparer;');
        for (const [index, pair] of reference.pairs.entries()) {
          const args = [pair.first, pair.second].map(value => JSON.stringify(fromUnits(value))).join(',');
          for (const name of ['comparer', 'view']) {
            lines.push(`{ int order = ${name}.Compare(${args}); Console.WriteLine(order < 0 ? -1 : order > 0 ? 1 : 0); }`);
            expected.push(row.signs[index]);
          }
        }
        lines.push('var values = new List<string>(new string[] {"z", "A", null, "m", "B"});');
        lines.push(`values.Sort(${factoryExpression(row.mode)});`);
        for (const [index, value] of row.sorted.entries()) {
          lines.push(`Console.WriteLine(values[${index}] == ${JSON.stringify(fromUnits(value))});`);
          expected.push('True');
        }
        lines.push('}');
      }
      const vm = create(compile(lines.join('\n'), pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, expected.join('\n') + '\n');
      } finally {vm.stop();}
    });
  }

  test(`StringComparer.FromComparison ${engine}: invalid enum and unsupported culture remain distinct`, () => {
    for (const row of reference.rows.filter(value => value.culture === '' && expectedFactoryFault(value))) {
      const vm = create(compile(`var comparer = ${factoryExpression(row.mode)}; Console.WriteLine(comparer.Compare(null, null));`));
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted', String(row.mode));
        assertFault(result.fault, row);
      } finally {vm.stop();}
    }
  });

  test(`StringComparer.FromComparison ${engine}: exact singleton handles survive GC and snapshots without warm allocations`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      const factory = contract(comparerType, 'FromComparison', factoryParameters);
      const first = platform.invoke(factory, [4]);
      const second = platform.invoke(contract(comparerType, 'get_OrdinalIgnoreCase'), []);
      const allocations = platform.heap.stats.allocations;
      const bytes = platform.heap.stats.allocatedBytes;
      const revision = platform.heap.mutationRevision;
      for (let index = 0; index < 20; index++) {
        assert.equal(platform.invoke(factory, [4]), first);
        assert.equal(platform.invoke(contract(comparerType, 'get_Ordinal'), []), first);
        assert.equal(platform.invoke(factory, [5]), second);
      }
      assert.notDeepEqual(first, second);
      assert.equal(platform.heap.stats.allocations, allocations);
      assert.equal(platform.heap.stats.allocatedBytes, bytes);
      assert.equal(platform.heap.mutationRevision, revision);
      const heap = platform.heap.snapshot();
      const state = platform.snapshot();
      platform.heap.collect();
      platform.heap.restore(heap);
      platform.restore(state);
      assert.deepEqual(platform.invoke(factory, [4]), first);
      assert.deepEqual(platform.invoke(factory, [5]), second);
      platform.heap.withRoots([], () => {
        const compare = contract(stringInterface, 'Compare', ['string', 'string']);
        assert.equal(platform.invoke(compare, [second, pin(platform, 'a'), pin(platform, 'A')]), 0);
      });
      assert.equal(platform.heap.pins.length, 0);
    } finally {vm.stop();}
  });

  test(`StringComparer.FromComparison ${engine}: all native factory rows and existing Array.BinarySearch consumers`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const factory = contract(comparerType, 'FromComparison', factoryParameters);
        const compare = contract(comparerType, 'Compare', ['string', 'string']);
        for (const row of reference.rows) {
          if (expectedFactoryFault(row)) {
            assert.throws(() => platform.invoke(factory, [row.mode]), error => {assertFault(error, row); return true;});
            continue;
          }
          const comparer = platform.invoke(factory, [row.mode]);
          for (const [index, pair] of reference.pairs.entries()) {
            const args = [comparer, pin(platform, fromUnits(pair.first)), pin(platform, fromUnits(pair.second))];
            assert.equal(Math.sign(platform.invoke(compare, args)), row.signs[index]);
          }
          const values = row.sorted.map(value => pin(platform, fromUnits(value)));
          const array = platform.heap.allocate('array', 'string[]', values);
          platform.heap.pins.push(array);
          const binary = contract('System.Array', 'BinarySearch', ['System.Array', 'object', objectInterface]);
          for (const [index, value] of [null, 'A', 'm', '!', 'zz'].entries()) {
            assert.equal(platform.invoke(binary, [array, pin(platform, value), comparer]), row.searches[index]);
          }
        }
      });
    } finally {vm.stop();}
  });
}

test('StringComparer.FromComparison independent CIL: native modes, true interface dispatch and getter identity', () => {
  const routes = [[comparerType, ['string', 'string']], [stringInterface, ['string', 'string']],
    [comparerType, ['object', 'object']], [objectInterface, ['object', 'object']]];
  for (const [owner, parameters] of routes) {
    const assembly = factoryComparisonAssembly(owner, parameters);
    for (const row of reference.rows) {
      const pairs = expectedFactoryFault(row) ? reference.pairs.slice(0, 1) : reference.pairs;
      for (const [index, pair] of pairs.entries()) {
        const vm = new CilVirtualMachine(assembly, {arguments: [row.mode, fromUnits(pair.first), fromUnits(pair.second)]});
        try {
          const result = vm.run();
          assert.equal(result.state, expectedFactoryFault(row) ? 'faulted' : 'terminated', result.fault?.stack);
          if (expectedFactoryFault(row)) assertFault(result.fault, row);
          else assert.equal(Math.sign(result.returnValue), row.signs[index]);
        } finally {vm.stop();}
      }
    }
  }
  for (const mode of [4, 5]) {
    const vm = new CilVirtualMachine(factoryIdentityAssembly(mode));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(Boolean(result.returnValue), true);
    } finally {vm.stop();}
  }
});

test('StringComparer.FromComparison appends 322 without shifting released getter and factory consumer IDs', () => {
  assert.equal(contract(comparerType, 'FromComparison', factoryParameters).id, 524322);
  assert.equal(contract(comparerType, 'get_Ordinal').id, 524292);
  assert.equal(contract(comparerType, 'get_OrdinalIgnoreCase').id, 524297);
  assert.equal(contract(comparerType, 'Compare', ['string', 'string']).id, 524293);
  assert.equal(contract(listType, 'Sort', [stringInterface]).id, 589824);
  assert.equal(contract('System.String', 'LastIndexOf', ['string', 'int', 'int', 'System.StringComparison']).id, 524318);
});

test('StringComparer.FromComparison native evidence pins enum faults, culture controls and singleton identities', () => {
  const source = readFileSync(new URL('string-comparer-from-comparison/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.rows.length, 20);
  assert.equal(reference.pairs.length, 19);
  for (const row of reference.rows) {
    if (row.mode < 0 || row.mode > 5) {
      assert.equal(row.fault, 'ArgumentException');
      assert.equal(row.parameter, 'comparisonType');
    } else {
      assert.equal(row.fault, null);
      assert.equal(row.sameGetter, row.mode >= 2);
      assert.equal(row.sameFactory, row.mode >= 2);
      assert.equal(row.sameGetterRepeat, row.mode >= 2);
      assert.equal(row.distinctOpposite, true);
    }
  }
  const invariant = reference.rows.find(row => row.culture === '' && row.mode === 1);
  const turkish = reference.rows.find(row => row.culture === 'tr-TR' && row.mode === 1);
  assert.notEqual(invariant.signs[6], turkish.signs[6], 'Native CurrentCultureIgnoreCase observes the selected culture');
});
