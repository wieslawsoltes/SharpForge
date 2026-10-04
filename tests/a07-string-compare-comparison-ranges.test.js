import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {comparisonRangeParameters, comparisonRangeArguments, comparisonRangeExpression,
  comparisonRangeAssembly, expectedComparisonRangeFault} from './fixtures/comparers/string-compare-comparison-ranges.js';
import {rangeParameters, rangeArguments} from './fixtures/comparers/string-compare-ranges.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-compare-comparison-ranges-net10.json', directory), 'utf8'));
const released = JSON.parse(readFileSync(new URL('string-compare-ranges-net10.json', directory), 'utf8'));
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

function contract(name = 'Compare', parameters = comparisonRangeParameters) {
  const descriptor = findContracts('System.String', name, true)
    .find(row => row.parameters.join(',') === parameters.join(','));
  assert(descriptor, `Missing String.${name}(${parameters.join(',')})`);
  return descriptor;
}

function assertFault(fault, row) {
  const expected = expectedComparisonRangeFault(row);
  assert.equal(fault?.name, expected, row.id);
  if (expected === 'NotSupportedException') assert.match(fault.message, /Ordinal.*OrdinalIgnoreCase/, row.id);
  else if (row.parameter) assert(fault.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + fault.message);
}

function managedArguments(platform, row, values) {
  const first = platform.managed(values[0], 'string');
  platform.heap.pins.push(first);
  const second = row.sameReference ? first : platform.managed(values[2], 'string');
  platform.heap.pins.push(second);
  if (row.copyRight) assert.notEqual(first.h, second.h, row.id);
  values[0] = first;
  values[2] = second;
  return values;
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`String.Compare ranges ${pipeline}/${engine}: every native ordinal success through named modes`, () => {
      const source = 'int result;\n' + successful.map(row =>
        `result = ${comparisonRangeExpression(row)}; Console.WriteLine(result < 0 ? -1 : result > 0 ? 1 : 0);`).join('\n');
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, successful.map(row => row.sign).join('\n') + '\n');
      } finally {vm.stop();}
    });

    test(`String.Compare ranges ${pipeline}/${engine}: enum locals and six arguments retain evaluation order`, () => {
      const source = `class Program {
        static string trace = "";
        static string Text(string mark, string value) { trace += mark; return value; }
        static int Number(string mark, int value) { trace += mark; return value; }
        static StringComparison Mode() { trace += "F"; return StringComparison.OrdinalIgnoreCase; }
        static void Main() {
          Console.WriteLine(string.Compare(Text("A", "xabc"), Number("B", 1),
            Text("C", "yyABC"), Number("D", 2), Number("E", 3), Mode()));
          Console.WriteLine(trace);
          StringComparison mode = StringComparison.Ordinal;
          Console.WriteLine(string.Compare("xabc", 1, "yyABC", 2, 3, mode) > 0);
          mode = StringComparison.OrdinalIgnoreCase;
          Console.WriteLine(string.Compare("xabc", 1, "yyABC", 2, 3, mode));
        }
      }`;
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '0\nABCDEF\nTrue\n0\n');
      } finally {vm.stop();}
    });
  }

  test(`String.Compare ranges ${engine}: compiled faults preserve enum, length, index and shortcut priority`, () => {
    const ids = ['ordinal/length-before-indices/4', 'ordinal/negative-second-before-first-bounds/5',
      'ordinal/zero-first-past-end/5', 'ordinal/equal-negative/4', 'ordinal/allocated-equal-invalid/5',
      'invalid/nulls-invalid-range/-1', 'invalid/identity-invalid-range/6', 'invalid/zero-valid/2147483647',
      'culture/nulls-invalid-range/0', 'culture/identity/1', 'culture/zero-invalid-range/2'];
    for (const id of ids) {
      const row = reference.rows.find(value => value.id === id);
      assert(row, id);
      const vm = create(compile(`Console.WriteLine(${comparisonRangeExpression(row)});`));
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted', row.id + ': ' + result.output);
        assertFault(result.fault, row);
      } finally {vm.stop();}
    }
  });

  test(`String.Compare ranges ${engine}: all native rows use real platform calls and survive collection`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const args = reference.rows.map(row => managedArguments(platform, row, comparisonRangeArguments(row)));
        const descriptor = contract();
        const allocations = platform.heap.stats.allocations;
        const bytes = platform.heap.stats.allocatedBytes;
        const revision = platform.heap.mutationRevision;
        const check = () => {
          for (let index = 0; index < reference.rows.length; index++) {
            const row = reference.rows[index];
            const invoke = () => platform.invoke(descriptor, args[index]);
            if (expectedComparisonRangeFault(row)) assert.throws(invoke, fault => {assertFault(fault, row); return true;});
            else assert.equal(Math.sign(invoke()), row.sign, row.id);
          }
        };
        check();
        assert.equal(platform.heap.stats.allocations, allocations);
        assert.equal(platform.heap.stats.allocatedBytes, bytes);
        assert.equal(platform.heap.mutationRevision, revision);
        platform.heap.collect();
        check();
      });
      assert.equal(platform.heap.pins.length, 0);
    } finally {vm.stop();}
  });

  test(`String.Compare ranges ${engine}: released CompareOrdinal keeps every captured raw result and fault`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const args = released.rows.map(row => managedArguments(platform, row, rangeArguments(row)));
        const descriptor = contract('CompareOrdinal', rangeParameters);
        for (let index = 0; index < released.rows.length; index++) {
          const row = released.rows[index];
          const invoke = () => platform.invoke(descriptor, args[index]);
          if (row.fault) assert.throws(invoke, fault => {assertFault(fault, row); return true;});
          else assert.equal(invoke(), row.result, row.id);
        }
      });
    } finally {vm.stop();}
  });

  test(`String.Compare ranges ${engine}: long folded ranges clip and cut pairs without managed text allocation`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const first = platform.heap.string('x' + 'é'.repeat(8192) + '\uD801\uDC28');
        platform.heap.pins.push(first);
        const second = platform.heap.string('yy' + 'É'.repeat(8192) + '\uD801\uDC00');
        platform.heap.pins.push(second);
        const allocations = platform.heap.stats.allocations;
        assert.equal(Math.sign(platform.invoke(contract(), [first, 1, second, 2, 8193, 4])), 1);
        assert.equal(platform.invoke(contract(), [first, 1, second, 2, 8193, 5]), 0);
        assert.equal(platform.invoke(contract(), [first, 1, second, 2, 2147483647, 5]), 0);
        assert.equal(platform.invoke(contract(), [first, 8194, second, 8195, 1, 5]) > 0, true);
        assert.equal(platform.heap.stats.allocations, allocations);
      });
    } finally {vm.stop();}
  });
}

test('String.Compare ranges: independent CIL checks every native sign/fault and explicit culture guard', () => {
  const assemblies = [comparisonRangeAssembly(false), comparisonRangeAssembly(true)];
  for (const row of reference.rows) {
    const vm = new CilVirtualMachine(assemblies[Number(row.sameReference)], {arguments: comparisonRangeArguments(row)});
    try {
      const result = vm.run();
      assert.equal(result.state, expectedComparisonRangeFault(row) ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (expectedComparisonRangeFault(row)) assertFault(result.fault, row);
      else assert.equal(Math.sign(result.returnValue), row.sign, row.id);
    } finally {vm.stop();}
  }
});

test('String.Compare ranges: append304 preserves mode-aware whole comparison and affix contracts', () => {
  assert.equal(contract().id, 524304);
  assert.equal(contract('Compare', ['string', 'string', 'System.StringComparison']).id, 524301);
  assert.equal(contract('CompareOrdinal', rangeParameters).id, 524298);
  for (const [method, id] of [['StartsWith', 524302], ['EndsWith', 524303]]) {
    const descriptor = findContracts('System.String', method, false).find(row => row.parameters.length === 2);
    assert.equal(descriptor.id, id);
  }
});

test('String.Compare ranges: unchanged pinned oracle preserves native precedence and bounded pair evidence', () => {
  const source = readFileSync(new URL('string-compare-comparison-ranges/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.rows.length, 292);
  const row = id => reference.rows.find(value => value.id === id);
  assert.equal(row('invalid/nulls-invalid-range/6').parameter, 'comparisonType');
  assert.equal(row('ordinal/nulls-negative/5').result, 0);
  assert.equal(row('ordinal/length-before-indices/5').parameter, 'length');
  assert.equal(row('ordinal/negative-second-before-first-bounds/5').parameter, 'indexB');
  assert.equal(row('ordinal/allocated-equal/5').sameReference, false);
  assert.equal(row('ordinal/surrogate-cut-left/5').sign, 0);
  assert.equal(row('ordinal/surrogate-cut-right/5').sign, 0);
  assert.equal(row('culture/nulls-invalid-range/0').result, 0);
  assert.equal(row('culture/zero-invalid-range/0').parameter, 'indexA');
});
