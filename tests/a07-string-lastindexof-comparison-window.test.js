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
import {lastIndexOfWindowParameters, lastIndexOfWindowArguments, lastIndexOfWindowExpression, lastIndexOfWindowAssembly,
  lastIndexOfWindowExpectedFault} from './fixtures/comparers/string-lastindexof-comparison-window.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-lastindexof-comparison-window-net10.json', directory), 'utf8'));
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

function contract(name = 'LastIndexOf', parameters = lastIndexOfWindowParameters) {
  const descriptor = findContracts('System.String', name, false)
    .find(row => row.parameters.join(',') === parameters.join(','));
  assert(descriptor, `Missing String.${name}(${parameters.join(',')})`);
  return descriptor;
}

function assertFault(fault, row) {
  const expected = lastIndexOfWindowExpectedFault(row);
  assert.equal(fault?.name, expected, row.id);
  if (expected === 'NotSupportedException') assert.match(fault.message, /Ordinal.*OrdinalIgnoreCase/, row.id);
  else if (row.parameter) assert(fault.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + fault.message);
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`String.LastIndexOf window comparison ${pipeline}/${engine}: native absolute UTF-16 offsets`, () => {
      const source = successful.map(row => `Console.WriteLine(${lastIndexOfWindowExpression(row)});`).join('\n');
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, successful.map(row => row.result).join('\n') + '\n');
      } finally {vm.stop();}
    });

    test(`String.LastIndexOf window comparison ${pipeline}/${engine}: enum locals and released overloads`, () => {
      const source = 'StringComparison mode = StringComparison.OrdinalIgnoreCase; int start = 5; int count = 3;' +
        'Console.WriteLine("abcabc".LastIndexOf("BC", start, count, mode));Console.WriteLine("abcabc".LastIndexOf("BC", 5, 1, mode));' +
        'Console.WriteLine("abcabc".LastIndexOf("BC", 6, 1, mode));Console.WriteLine("abcabc".LastIndexOf("BC", 6, 3, mode));' +
        'Console.WriteLine("abcabc".LastIndexOf("", 2, 0, mode));Console.WriteLine("".LastIndexOf("", -1, -1, mode));' +
        'Console.WriteLine("".LastIndexOf("a", 0, (-2147483647 - 1), mode));' +
        'Console.WriteLine("abc".LastIndexOf("c", 3, 1, mode));Console.WriteLine("abc".LastIndexOf("c", 3, 2, mode));' +
        'Console.WriteLine("aBaB".LastIndexOf("B"));Console.WriteLine("aBaB".LastIndexOf("b", mode));' +
        'Console.WriteLine("aBaB".LastIndexOf("b", 2, mode));';
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '4\n-1\n-1\n4\n3\n0\n-1\n-1\n2\n3\n3\n1\n');
      } finally {vm.stop();}
    });
  }

  test(`String.LastIndexOf window comparison ${engine}: compiled null/enum/range/culture precedence`, () => {
    const ids = ['range-precedence/nulls/-1/-1/6', 'range-precedence/null-value/-1/-1/6',
      'range-precedence/start-negative/-1/-1/6', 'range-precedence/start-negative/-1/-1/4',
      'range-precedence/start-negative/-1/-1/0', 'range-precedence/count-negative/2/-1/6',
      'range-precedence/count-negative/2/-1/4', 'range-precedence/count-negative/2/-1/0',
      'range-precedence/empty-bad-start/-2/0/4', 'empty/empty-value/-1/-2147483648/0',
      'length-alias/c/3/5/5', 'length-alias/empty-value/3/-1/5'];
    for (const id of ids) {
      const row = reference.rows.find(value => value.id === id);
      assert(row, id);
      const vm = create(compile(`Console.WriteLine(${lastIndexOfWindowExpression(row)});`));
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted', row.id + ': ' + result.output);
        assertFault(result.fault, row);
      } finally {vm.stop();}
    }
  });

  test(`String.LastIndexOf window comparison ${engine}: native matrix before/after managed collection`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const args = reference.rows.map(row => {
          const values = lastIndexOfWindowArguments(row);
          const receiver = platform.managed(values[0], 'string');
          platform.heap.pins.push(receiver);
          const value = row.sameReference ? receiver : platform.managed(values[1], 'string');
          platform.heap.pins.push(value);
          if (row.copyValue) assert.notEqual(receiver.h, value.h, row.id);
          return [receiver, value, values[2], values[3], values[4]];
        });
        const descriptor = contract();
        const whole = contract('LastIndexOf', ['string', 'System.StringComparison']);
        const allocations = platform.heap.stats.allocations;
        const bytes = platform.heap.stats.allocatedBytes;
        const revision = platform.heap.mutationRevision;
        const check = () => {
          for (let index = 0; index < reference.rows.length; index++) {
            const row = reference.rows[index];
            const invoke = () => platform.invoke(descriptor, args[index]);
            if (lastIndexOfWindowExpectedFault(row)) assert.throws(invoke, fault => {assertFault(fault, row); return true;});
            else {
              assert.equal(invoke(), row.result, row.id);
              if (row.group === 'ordinal' || row.group === 'precedence') {
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

test('String.LastIndexOf window comparison: independent CIL preserves every native result and guarded culture row', () => {
  const assemblies = [lastIndexOfWindowAssembly(false), lastIndexOfWindowAssembly(true)];
  for (const row of reference.rows) {
    const vm = new CilVirtualMachine(assemblies[Number(row.sameReference)], {arguments: lastIndexOfWindowArguments(row)});
    try {
      const result = vm.run();
      assert.equal(result.state, lastIndexOfWindowExpectedFault(row) ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (lastIndexOfWindowExpectedFault(row)) assertFault(result.fault, row);
      else assert.equal(result.returnValue, row.result, row.id);
    } finally {vm.stop();}
  }
});

function expectedLast(source, value, beginning, end) {
  for (let index = end - value.length; index >= beginning; index--) {
    if (equalsOrdinalIgnoreCaseRange(source, index, value)) return index;
  }
  return -1;
}

test('String.LastIndexOf window comparison: exhaustive windows, overlaps and both surrogate cuts', () => {
  assert.equal(typeof search.lastIndexOfWindowWithComparison, 'function');
  const alphabet = ['a', 'A', 'é', '\uD801', '\uDC28', '\uDC00'];
  const strings = [''];
  let level = [''];
  for (let length = 1; length <= 3; length++) {
    level = level.flatMap(prefix => alphabet.map(unit => prefix + unit));
    strings.push(...level);
  }
  for (const source of strings) {
    for (const value of strings) {
      for (let end = 0; end <= source.length; end++) {
        for (let beginning = 0; beginning <= end; beginning++) {
          // Nonempty receivers cannot specify an empty prefix at -1; other empty windows remain covered.
          if (end === 0 && source.length !== 0) continue;
          const expected = expectedLast(source, value, beginning, end);
          const args = [value, end - 1, end - beginning, 5];
          const label = JSON.stringify([source, value, beginning, end]);
          assert.equal(search.lastIndexOfWindowWithComparison(undefined, source, args), expected, label);
          assert.equal(linear.lastIndexOfOrdinalIgnoreCase(source, value, end, beginning), expected, label);
          const ordinal = value.length > end - beginning ? -1 : source.lastIndexOf(value, end - value.length);
          args[3] = 4;
          assert.equal(search.lastIndexOfWindowWithComparison(undefined, source, args),
            ordinal < beginning ? -1 : ordinal, label);
        }
      }
    }
  }
});

test('String.LastIndexOf window comparison: period memory remains linear inside BMP bounds', () => {
  assert.equal(typeof search.lastIndexOfWindowWithComparison, 'function');
  const beginning = 4096;
  let previous = 0;
  for (const length of [128, 512, 2048]) {
    const source = 'é'.repeat(beginning + length + 4096);
    const end = beginning + length;
    const value = 'É'.repeat(length / 4);
    let reads = 0;
    const view = {
      length: source.length,
      charCodeAt(index) {
        assert(index >= beginning && index < end, `Excluded unit read at ${index}`);
        reads++;
        return source.charCodeAt(index);
      }
    };
    assert.equal(search.lastIndexOfWindowWithComparison(undefined, view, [value, end - 1, length, 5]), end - value.length);
    assert(reads <= 64 * (length + value.length), `${length}: ${reads} reads`);
    if (previous) assert(reads <= previous * 5 + 64, `${length}: growth ${previous} -> ${reads}`);
    previous = reads;
  }
});

test('String.LastIndexOf window comparison:318 follows signed/unsigned Append316/317 without shifting IDs', () => {
  assert.equal(contract().id, 524318);
  assert.equal(findContracts('System.Text.StringBuilder', 'Append', false).find(row => row.parameters.join(',') === 'long').id, 524316);
  assert.equal(findContracts('System.Text.StringBuilder', 'Append', false).find(row => row.parameters.join(',') === 'ulong').id, 524317);
  assert.equal(contract('LastIndexOf', ['string', 'int', 'System.StringComparison']).id, 524314);
  assert.equal(contract('IndexOf', ['string', 'int', 'int', 'System.StringComparison']).id, 524311);
  assert.equal(contract('LastIndexOf', ['string', 'System.StringComparison']).id, 524307);
  assert.equal(contract('LastIndexOf', ['string']).id, 1261);
});

test('String.LastIndexOf window comparison: frozen native normalization and fault evidence', () => {
  const source = readFileSync(new URL('string-lastindexof-comparison-window/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.rows.length, 1402);
  const row = id => {
    const result = reference.rows.find(value => value.id === id);
    assert(result, id);
    return result;
  };
  assert.equal(reference.rows.filter(value => value.group === 'ordinal' || value.group === 'precedence').length, 246);
  assert.equal(row('range-precedence/nulls/-1/-1/6').fault, 'NullReferenceException');
  assert.equal(row('range-precedence/null-value/-1/-1/6').parameter, 'value');
  assert.equal(row('range-precedence/start-negative/-1/-1/6').parameter, 'comparisonType');
  assert.equal(row('range-precedence/start-negative/-1/-1/4').parameter, 'startIndex');
  assert.equal(row('range-precedence/count-negative/2/-1/4').parameter, 'count');
  assert.equal(row('empty/empty-value/-1/-2147483648/5').result, 0);
  assert.equal(row('empty/empty-value/0/2147483647/5').result, 0);
  assert.equal(row('empty/nonempty-value/0/-1/5').result, -1);
  assert.equal(row('length-alias/c/3/1/5').result, -1);
  assert.equal(row('length-alias/c/3/2/5').result, 2);
  assert.equal(row('length-alias/abc/3/4/5').result, 0);
  assert.equal(row('length-alias/abc/3/5/5').parameter, 'count');
  assert.equal(row('window/pair-high/1/1/5').result, 1);
  assert.equal(row('window/pair-low/2/1/5').result, 2);
  assert.equal(row('window/both-cuts/4/3/5').result, 2);
});
