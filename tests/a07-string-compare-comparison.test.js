import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {compareParameters, compareArguments, compareExpression, compareComparisonAssembly,
  expectedCompareFault} from './fixtures/comparers/string-compare-comparison.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-compare-comparison-net10.json', directory), 'utf8'));
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
const ordinal = reference.rows.filter(row => row.group === 'ordinal');
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

function contract() {
  const descriptor = findContracts('System.String', 'Compare', true)
    .find(row => row.parameters.join(',') === compareParameters.join(','));
  assert(descriptor, 'Missing String.Compare(string,string,StringComparison)');
  return descriptor;
}

function assertFault(fault, row) {
  const expected = expectedCompareFault(row);
  assert.equal(fault?.name, expected, row.id);
  if (expected === 'NotSupportedException') assert.match(fault.message, /Ordinal.*OrdinalIgnoreCase/, row.id);
  else if (row.parameter) assert(fault.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + fault.message);
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`String.Compare comparison ${pipeline}/${engine}: native ordinal signs through named enum constants`, () => {
      const source = 'int result;\n' + ordinal.map(row =>
        `result = ${compareExpression(row)}; Console.WriteLine(result < 0 ? -1 : result > 0 ? 1 : 0);`).join('\n');
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, ordinal.map(row => row.sign).join('\n') + '\n');
      } finally {vm.stop();}
    });

    test(`String.Compare comparison ${pipeline}/${engine}: enum locals and arguments retain evaluation order`, () => {
      const source = `class Program {
        static string trace = "";
        static string First() { trace += "A"; return "abc"; }
        static string Second() { trace += "B"; return "ABC"; }
        static StringComparison Mode() { trace += "M"; return StringComparison.OrdinalIgnoreCase; }
        static void Main() {
          Console.WriteLine(string.Compare(First(), Second(), Mode())); Console.WriteLine(trace);
          StringComparison mode = StringComparison.Ordinal;
          Console.WriteLine(string.Compare("abc", "ABC", mode) > 0);
          mode = StringComparison.OrdinalIgnoreCase;
          Console.WriteLine(string.Compare("abc", "ABC", mode));
        }
      }`;
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '0\nABM\nTrue\n0\n');
      } finally {vm.stop();}
    });
  }

  test(`String.Compare comparison ${engine}: invalid modes and unsupported cultures precede shortcuts`, () => {
    const ids = ['invalid/nulls/-1', 'invalid/null-left/6', 'invalid/identity/2147483647',
      'invalid/allocated-equal/-2147483648', 'culture/nulls/0', 'culture/identity/1', 'culture/null-right/2'];
    for (const id of ids) {
      const row = reference.rows.find(value => value.id === id);
      assert(row, id);
      const vm = create(compile(`Console.WriteLine(${compareExpression(row)});`));
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted', row.id + ': ' + result.output);
        assertFault(result.fault, row);
      } finally {vm.stop();}
    }
  });

  test(`String.Compare comparison ${engine}: all native rows use the real platform without managed allocation`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const args = reference.rows.map(row => {
          const values = compareArguments(row);
          const first = platform.managed(values[0], 'string');
          platform.heap.pins.push(first);
          const second = row.sameReference ? first : platform.managed(values[1], 'string');
          platform.heap.pins.push(second);
          if (row.copyRight) assert.notEqual(first.h, second.h, row.id);
          return [first, second, values[2]];
        });
        const descriptor = contract();
        const allocations = platform.heap.stats.allocations;
        const bytes = platform.heap.stats.allocatedBytes;
        const revision = platform.heap.mutationRevision;
        const check = () => {
          for (let index = 0; index < reference.rows.length; index++) {
            const row = reference.rows[index];
            const invoke = () => platform.invoke(descriptor, args[index]);
            if (expectedCompareFault(row)) assert.throws(invoke, fault => {assertFault(fault, row); return true;});
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

  test(`String.Compare comparison ${engine}: long Unicode prefixes do not allocate folded managed strings`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const first = platform.heap.string('é'.repeat(8192) + '\uD800a\uDC00');
        platform.heap.pins.push(first);
        const second = platform.heap.string('É'.repeat(8192) + '\uD800A\uDC00');
        platform.heap.pins.push(second);
        const allocations = platform.heap.stats.allocations;
        assert.equal(Math.sign(platform.invoke(contract(), [first, second, 4])), 1);
        assert.equal(platform.invoke(contract(), [first, second, 5]), 0);
        assert.equal(platform.heap.stats.allocations, allocations);
      });
    } finally {vm.stop();}
  });
}

test('String.Compare comparison: independent CIL covers every native sign, fault and explicit culture guard', () => {
  const assemblies = [compareComparisonAssembly(false), compareComparisonAssembly(true)];
  for (const row of reference.rows) {
    const vm = new CilVirtualMachine(assemblies[Number(row.sameReference)], {arguments: compareArguments(row)});
    try {
      const result = vm.run();
      assert.equal(result.state, expectedCompareFault(row) ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (expectedCompareFault(row)) assertFault(result.fault, row);
      else assert.equal(Math.sign(result.returnValue), row.sign, row.id);
    } finally {vm.stop();}
  }
});

test('String.Compare comparison: one appended contract leaves Equals and comparer ABI unchanged', () => {
  assert.equal(contract().id, 524301);
  assert.equal(contract().result, 'int');
  assert.equal(findContracts('System.String', 'Equals', true).find(row => row.parameters.length === 3).id, 524299);
  assert.equal(findContracts('System.String', 'Equals', false).find(row => row.parameters.length === 2).id, 524300);
  assert.equal(findContracts('System.String', 'CompareOrdinal', true).find(row => row.parameters.length === 5).id, 524298);
  assert.equal(findContracts('System.StringComparer', 'get_OrdinalIgnoreCase', true)[0].id, 524297);
  assert.equal(findContracts('System.Environment', 'GetEnvironmentVariable', true)[0].id, 524289);
});

test('String.Compare comparison: native oracle preserves raw results and precedence evidence', () => {
  const source = readFileSync(new URL('string-compare-comparison/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.rows.length, 122);
  const row = id => reference.rows.find(value => value.id === id);
  assert.equal(row('invalid/nulls/6').fault, 'ArgumentException');
  assert.equal(row('invalid/identity/6').parameter, 'comparisonType');
  assert.equal(row('ordinal/allocated-equal/4').sameReference, false);
  assert.equal(row('ordinal/identity/4').sameReference, true);
  assert.equal(row('culture/identity/0').result, 0);
  assert.equal(row('culture/identity/0').fault, null);
  for (const value of ordinal) {
    assert.equal(value.fault, null, value.id);
    assert.equal(value.sign, Math.sign(value.result), value.id);
  }
});
