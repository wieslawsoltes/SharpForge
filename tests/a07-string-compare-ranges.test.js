import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {rangeParameters, rangeArguments, rangeExpression, compareRangeAssembly} from './fixtures/comparers/string-compare-ranges.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-compare-ranges-net10.json', directory), 'utf8'));
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
const successful = reference.rows.filter(row => row.fault === null);
const failures = reference.rows.filter(row => row.fault !== null);
const programs = new Map();

function compile(source, pipeline = 'bound') {
  const key = pipeline + source;
  if (!programs.has(key)) {
    const result = compileToIL('using System; ' + source, {pipeline});
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    programs.set(key, result);
  }
  return programs.get(key);
}

function contract(parameters) {
  const descriptor = findContracts('System.String', 'CompareOrdinal', true)
    .find(row => row.parameters.join(',') === parameters.join(','));
  assert(descriptor, 'Missing CompareOrdinal(' + parameters.join(',') + ')');
  return descriptor;
}

function assertFault(fault, row) {
  assert.equal(fault?.name, row.fault, row.id);
  assert(fault.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + fault.message);
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`CompareOrdinal ranges ${pipeline}/${engine}: compiled calls match every native successful result`, () => {
      const source = successful.map(row => `Console.WriteLine(${rangeExpression(row)});`).join('\n');
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, successful.map(row => row.result).join('\n') + '\n');
      } finally {vm.stop();}
    });
  }

  test(`CompareOrdinal ranges ${engine}: native invalid ranges preserve fault type and parameter priority`, () => {
    for (const row of failures) {
      const vm = create(compile(`Console.WriteLine(${rangeExpression(row)});`));
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted', row.id);
        assertFault(result.fault, row);
      } finally {vm.stop();}
    }
  });

  test(`CompareOrdinal ranges ${engine}: platform calls allocate no managed text and retain inputs`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    const descriptor = contract(rangeParameters);
    try {
      platform.heap.withRoots([], () => {
        const args = successful.map(row => rangeArguments(row).map((value, index) => {
          if (index !== 0 && index !== 2 || value === null) return value;
          const managed = platform.managed(value, 'string');
          platform.heap.pins.push(managed);
          return managed;
        }));
        const allocations = platform.heap.stats.allocations;
        const bytes = platform.heap.stats.allocatedBytes;
        const revision = platform.heap.mutationRevision;
        for (let index = 0; index < args.length; index++) {
          assert.equal(platform.invoke(descriptor, args[index]), successful[index].result, successful[index].id);
        }
        assert.equal(platform.heap.stats.allocations, allocations);
        assert.equal(platform.heap.stats.allocatedBytes, bytes);
        assert.equal(platform.heap.mutationRevision, revision);
        platform.heap.collect();
        assert.equal(platform.invoke(descriptor, args[0]), successful[0].result);
      });
      assert.equal(platform.heap.pins.length, 0);
    } finally {vm.stop();}
  });

  test(`CompareOrdinal ranges ${engine}: large requested lengths are clipped without normalization or substring allocation`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const first = platform.heap.string('prefix' + 'x'.repeat(8192) + '\uD800');
        platform.heap.pins.push(first);
        const second = platform.heap.string('!' + 'x'.repeat(8192) + '\uDC00');
        platform.heap.pins.push(second);
        const allocations = platform.heap.stats.allocations;
        assert.equal(platform.invoke(contract(rangeParameters), [first, 6, second, 1, 2147483647]), 0xd800 - 0xdc00);
        assert.equal(platform.heap.stats.allocations, allocations);
      });
    } finally {vm.stop();}
  });

  test(`CompareOrdinal ranges ${engine}: released two-argument return values remain unchanged`, () => {
    const vm = create(compile('Console.WriteLine(string.CompareOrdinal("a", "A"));' +
      'Console.WriteLine(string.CompareOrdinal(null, ""));Console.WriteLine(string.CompareOrdinal("same", "same"));'));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, '1\n-1\n0\n');
    } finally {vm.stop();}
  });
}

test('CompareOrdinal ranges: independently assembled CIL matches every native result and fault', () => {
  const assembly = compareRangeAssembly();
  for (const row of reference.rows) {
    const vm = new CilVirtualMachine(assembly, {arguments: rangeArguments(row)});
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) assertFault(result.fault, row);
      else assert.equal(result.returnValue, row.result, row.id);
    } finally {vm.stop();}
  }
});

test('CompareOrdinal ranges: the single A07 append preserves released String and comparer IDs', () => {
  assert.equal(contract(['string', 'string']).id, 1254);
  assert.equal(contract(rangeParameters).id, 524298);
  assert.equal(findContracts('System.StringComparer', 'get_OrdinalIgnoreCase', true)[0].id, 524297);
  assert.equal(findContracts('System.StringComparer', 'get_Ordinal', true)[0].id, 524292);
  assert.equal(findContracts('System.Environment', 'GetEnvironmentVariable', true)[0].id, 524289);
});

test('CompareOrdinal ranges: native capture retains source, runtime and null/validation evidence', () => {
  const source = readFileSync(new URL('string-compare-ranges/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.rows.length, 58);
  assert.equal(reference.rows.find(row => row.id === 'nulls-negative').result, 0);
  assert.equal(reference.rows.find(row => row.id === 'length-before-indices').parameter, 'length');
  assert.equal(reference.rows.find(row => row.id === 'negative-second-before-first-bounds').parameter, 'indexB');
});
