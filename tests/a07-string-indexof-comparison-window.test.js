import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import * as search from '../packages/bcl-core/src/system/string-search.js';
import * as linear from '../packages/bcl-core/src/system/string-search-linear.js';
import {equalsOrdinalIgnoreCaseRange} from '../packages/bcl-core/src/system/string-compare.js';
import {indexOfWindowParameters, indexOfWindowArguments, indexOfWindowExpression, indexOfWindowAssembly,
  indexOfWindowExpectedFault} from './fixtures/comparers/string-indexof-comparison-window.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-indexof-comparison-window-net10.json', directory), 'utf8'));
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
const successful = reference.rows.filter(row => row.mode >= 4 && row.mode <= 5 && row.fault === null);
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

function contract(name = 'IndexOf', parameters = indexOfWindowParameters) {
  const descriptor = findContracts('System.String', name, false)
    .find(row => row.parameters.join(',') === parameters.join(','));
  assert(descriptor, `Missing String.${name}(${parameters.join(',')})`);
  return descriptor;
}

function assertFault(fault, row) {
  const expected = indexOfWindowExpectedFault(row);
  assert.equal(fault?.name, expected, row.id);
  if (expected === 'NotSupportedException') assert.match(fault.message, /Ordinal.*OrdinalIgnoreCase/, row.id);
  else if (row.parameter) assert(fault.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + fault.message);
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`String.IndexOf window comparison ${pipeline}/${engine}: native absolute UTF-16 offsets`, () => {
      const source = successful.map(row => `Console.WriteLine(${indexOfWindowExpression(row)});`).join('\n');
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, successful.map(row => row.result).join('\n') + '\n');
      } finally {vm.stop();}
    });

    test(`String.IndexOf window comparison ${pipeline}/${engine}: enum locals and released overloads`, () => {
      const source = 'StringComparison mode = StringComparison.OrdinalIgnoreCase; int start = 2; int count = 2;' +
        'Console.WriteLine("aBaB".IndexOf("b", start, count, mode));Console.WriteLine("aBaB".IndexOf("b", start, mode));' +
        'Console.WriteLine("aBaB".IndexOf("b", 0, 1, mode));Console.WriteLine("aBaB".IndexOf("b", mode));' +
        'Console.WriteLine("aBaB".IndexOf("B", start));Console.WriteLine("aBaB".IndexOf("", 4, 0, mode));' +
        'Console.WriteLine("".IndexOf("", 0, 0, mode));Console.WriteLine("aBaB".IndexOf("B", 4, 0, mode));' +
        'mode = StringComparison.Ordinal;Console.WriteLine("aBaB".IndexOf("b", start, count, mode));' +
        'Console.WriteLine("aBaB".LastIndexOf("B", mode));';
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '3\n3\n-1\n1\n3\n4\n0\n-1\n-1\n3\n');
      } finally {vm.stop();}
    });
  }

  test(`String.IndexOf window comparison ${engine}: compiled null/enum/range/culture precedence`, () => {
    const ids = ['range-precedence/nulls/-1/-1/6', 'range-precedence/null-value/-1/-1/6',
      'range-precedence/start-negative/-1/-1/6', 'range-precedence/start-negative/-1/-1/4',
      'range-precedence/start-negative/-1/-1/0', 'range-precedence/count-negative/0/-1/6',
      'range-precedence/count-negative/0/-1/4', 'range-precedence/count-negative/0/-1/0',
      'range-precedence/count-maximum/0/2147483647/5', 'range-precedence/empty-end/3/0/0'];
    for (const id of ids) {
      const row = reference.rows.find(value => value.id === id);
      assert(row, id);
      const vm = create(compile(`Console.WriteLine(${indexOfWindowExpression(row)});`));
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted', row.id + ': ' + result.output);
        assertFault(result.fault, row);
      } finally {vm.stop();}
    }
  });

  test(`String.IndexOf window comparison ${engine}: native matrix before/after managed collection`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const args = reference.rows.map(row => {
          const values = indexOfWindowArguments(row);
          const receiver = platform.managed(values[0], 'string');
          platform.heap.pins.push(receiver);
          const value = row.sameReference ? receiver : platform.managed(values[1], 'string');
          platform.heap.pins.push(value);
          if (row.copyValue) assert.notEqual(receiver.h, value.h, row.id);
          return [receiver, value, values[2], values[3], values[4]];
        });
        const descriptor = contract();
        const whole = contract('IndexOf', ['string', 'System.StringComparison']);
        const allocations = platform.heap.stats.allocations;
        const bytes = platform.heap.stats.allocatedBytes;
        const revision = platform.heap.mutationRevision;
        const check = () => {
          for (let index = 0; index < reference.rows.length; index++) {
            const row = reference.rows[index];
            const invoke = () => platform.invoke(descriptor, args[index]);
            if (indexOfWindowExpectedFault(row)) assert.throws(invoke, fault => {assertFault(fault, row); return true;});
            else {
              assert.equal(invoke(), row.result, row.id);
              if (row.startIndex === 0 && row.count === row.receiver.length) {
                assert.equal(platform.invoke(whole, [args[index][0], args[index][1], row.mode]), row.result, row.id);
              }
            }
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
}

test('String.IndexOf window comparison: independent CIL preserves every native result and guarded culture row', () => {
  const assemblies = [indexOfWindowAssembly(false), indexOfWindowAssembly(true)];
  for (const row of reference.rows) {
    const vm = new CilVirtualMachine(assemblies[Number(row.sameReference)], {arguments: indexOfWindowArguments(row)});
    try {
      const result = vm.run();
      assert.equal(result.state, indexOfWindowExpectedFault(row) ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (indexOfWindowExpectedFault(row)) assertFault(result.fault, row);
      else assert.equal(result.returnValue, row.result, row.id);
    } finally {vm.stop();}
  }
});

function expectedIndex(source, value, start, end) {
  for (let index = start; index <= end - value.length; index++) {
    if (equalsOrdinalIgnoreCaseRange(source, index, value)) return index;
  }
  return -1;
}

test('String.IndexOf window comparison: every window in an exhaustive UTF-16 corpus', () => {
  assert.equal(typeof search.indexOfWindowWithComparison, 'function');
  const alphabet = ['a', 'A', 'é', '\uD801', '\uDC28', '\uDC00'];
  const strings = [''];
  let level = [''];
  for (let length = 1; length <= 3; length++) {
    level = level.flatMap(prefix => alphabet.map(unit => prefix + unit));
    strings.push(...level);
  }
  for (const source of strings) {
    for (const value of strings) {
      for (let start = 0; start <= source.length; start++) {
        for (let end = start; end <= source.length; end++) {
          const expected = expectedIndex(source, value, start, end);
          const label = JSON.stringify([source, value, start, end]);
          assert.equal(search.indexOfWindowWithComparison(undefined, source, [value, start, end - start, 5]), expected, label);
          // Bypass the <=8 candidate path so the Two-Way end bound is independently exercised.
          assert.equal(linear.indexOfOrdinalIgnoreCase(source, value, start, end), expected, label);
          const ordinal = source.indexOf(value, start);
          assert.equal(search.indexOfWindowWithComparison(undefined, source, [value, start, end - start, 4]),
            ordinal > end - value.length ? -1 : ordinal, label);
        }
      }
    }
  }
});

test('String.IndexOf window comparison: ignore-case bounds skip large excluded prefix and suffix', () => {
  assert.equal(typeof search.indexOfWindowWithComparison, 'function');
  const start = 4096;
  for (const needleLength of [8, 9, 32]) {
    for (const tailLength of [128, 512, 2048]) {
      const window = 'é'.repeat(tailLength) + 'b';
      const source = 'x'.repeat(start) + window + 'É'.repeat(4096) + 'B';
      const end = start + window.length;
      const value = 'É'.repeat(needleLength - 1) + 'B';
      let reads = 0;
      const bound = index => assert(index >= start && index < end, `Excluded unit read at ${index}`);
      const view = {
        length: source.length,
        charCodeAt(index) {bound(index); reads++; return source.charCodeAt(index);},
        codePointAt(index) {bound(index); reads++; return source.codePointAt(index);}
      };
      assert.equal(search.indexOfWindowWithComparison(undefined, view, [value, start, window.length, 5]), end - value.length);
      assert(reads <= 64 * (window.length + value.length), `${needleLength}/${tailLength}: ${reads} reads`);
    }
  }
});

test('String.IndexOf window comparison:311 follows builder309/310 and preserves earlier contracts', () => {
  assert.equal(contract().id, 524311);
  assert.equal(findContracts('System.Text.StringBuilder', 'Append', false).find(row => row.parameters.join(',') === 'char').id, 524309);
  assert.equal(findContracts('System.Text.StringBuilder', 'Append', false).find(row => row.parameters.join(',') === 'char,int').id, 524310);
  assert.equal(contract('IndexOf', ['string', 'int', 'System.StringComparison']).id, 524308);
  assert.equal(contract('LastIndexOf', ['string', 'System.StringComparison']).id, 524307);
  assert.equal(contract('IndexOf', ['string', 'System.StringComparison']).id, 524306);
  assert.equal(contract('IndexOf', ['string']).id, 1259);
  assert.equal(contract('IndexOf', ['string', 'int']).id, 1260);
});

test('String.IndexOf window comparison: pinned native bytes retain count precedence and split-pair evidence', () => {
  const source = readFileSync(new URL('string-indexof-comparison-window/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.rows.length, 988);
  const row = id => {
    const result = reference.rows.find(value => value.id === id);
    assert(result, id);
    return result;
  };
  assert.equal(reference.rows.filter(value => value.group === 'ordinal' || value.group === 'precedence').length, 218);
  assert.equal(row('range-precedence/nulls/-1/-1/6').fault, 'NullReferenceException');
  assert.equal(row('range-precedence/null-value/-1/-1/6').parameter, 'value');
  assert.equal(row('range-precedence/start-negative/-1/-1/6').parameter, 'comparisonType');
  assert.equal(row('range-precedence/start-negative/-1/-1/4').parameter, 'startIndex');
  assert.equal(row('range-precedence/count-negative/0/-1/6').parameter, 'comparisonType');
  assert.equal(row('range-precedence/count-negative/0/-1/4').parameter, 'count');
  assert.equal(row('range-precedence/count-negative/0/-1/0').parameter, 'count');
  assert.equal(row('range-precedence/empty-end/3/0/5').result, 3);
  assert.equal(row('range-precedence/identity-short-count/0/3/5').result, -1);
  assert.equal(row('window/pair-high/1/1/5').result, 1);
  assert.equal(row('window/pair-low/2/1/5').result, 2);
  assert.equal(row('window/pair-fold/1/1/5').result, -1);
  assert.equal(row('window/both-cuts/2/3/5').result, 2);
});
