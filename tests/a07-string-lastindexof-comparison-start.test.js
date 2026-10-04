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
import {lastIndexOfStartParameters, lastIndexOfStartArguments, lastIndexOfStartExpression, lastIndexOfStartAssembly,
  lastIndexOfStartExpectedFault} from './fixtures/comparers/string-lastindexof-comparison-start.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-lastindexof-comparison-start-net10.json', directory), 'utf8'));
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

function contract(name = 'LastIndexOf', parameters = lastIndexOfStartParameters) {
  const descriptor = findContracts('System.String', name, false)
    .find(row => row.parameters.join(',') === parameters.join(','));
  assert(descriptor, `Missing String.${name}(${parameters.join(',')})`);
  return descriptor;
}

function assertFault(fault, row) {
  const expected = lastIndexOfStartExpectedFault(row);
  assert.equal(fault?.name, expected, row.id);
  if (expected === 'NotSupportedException') assert.match(fault.message, /Ordinal.*OrdinalIgnoreCase/, row.id);
  else if (row.parameter) assert(fault.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + fault.message);
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`String.LastIndexOf start comparison ${pipeline}/${engine}: native absolute UTF-16 offsets`, () => {
      const source = successful.map(row => `Console.WriteLine(${lastIndexOfStartExpression(row)});`).join('\n');
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, successful.map(row => row.result).join('\n') + '\n');
      } finally {vm.stop();}
    });

    test(`String.LastIndexOf start comparison ${pipeline}/${engine}: enum locals and released overloads`, () => {
      const source = 'StringComparison mode = StringComparison.OrdinalIgnoreCase; int start = 2;' +
        'Console.WriteLine("abcabc".LastIndexOf("BC", start, mode));Console.WriteLine("abcabc".LastIndexOf("BC", 1, mode));' +
        'Console.WriteLine("abcabc".LastIndexOf("BC", 6, mode));Console.WriteLine("abcabc".LastIndexOf("", start, mode));' +
        'Console.WriteLine("abcabc".LastIndexOf("", 6, mode));Console.WriteLine("".LastIndexOf("", -1, mode));' +
        'Console.WriteLine("".LastIndexOf("", 0, mode));Console.WriteLine("".LastIndexOf("a", 0, mode));' +
        'Console.WriteLine("aBaB".LastIndexOf("B"));Console.WriteLine("aBaB".LastIndexOf("b", mode));' +
        'mode = StringComparison.Ordinal;Console.WriteLine("abcabc".LastIndexOf("BC", start, mode));';
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '1\n-1\n4\n3\n6\n0\n0\n-1\n3\n3\n-1\n');
      } finally {vm.stop();}
    });
  }

  test(`String.LastIndexOf start comparison ${engine}: compiled null/enum/range/culture precedence`, () => {
    const ids = ['range-precedence/nulls/-1/6', 'range-precedence/null-value/-1/6',
      'range-precedence/empty-value/-1/6', 'range-precedence/empty-value/-1/4',
      'range-precedence/empty-value/-1/0', 'range-precedence/identity/2147483647/5',
      'range-precedence/empty-both/-2/4', 'range-precedence/empty-both/1/4',
      'range-precedence/empty-both/-1/0', 'range-precedence/empty-value/0/0'];
    for (const id of ids) {
      const row = reference.rows.find(value => value.id === id);
      assert(row, id);
      const vm = create(compile(`Console.WriteLine(${lastIndexOfStartExpression(row)});`));
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted', row.id + ': ' + result.output);
        assertFault(result.fault, row);
      } finally {vm.stop();}
    }
  });

  test(`String.LastIndexOf start comparison ${engine}: native matrix before/after managed collection`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const args = reference.rows.map(row => {
          const values = lastIndexOfStartArguments(row);
          const receiver = platform.managed(values[0], 'string');
          platform.heap.pins.push(receiver);
          const value = row.sameReference ? receiver : platform.managed(values[1], 'string');
          platform.heap.pins.push(value);
          if (row.copyValue) assert.notEqual(receiver.h, value.h, row.id);
          return [receiver, value, values[2], values[3]];
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
            if (lastIndexOfStartExpectedFault(row)) assert.throws(invoke, fault => {assertFault(fault, row); return true;});
            else {
              assert.equal(invoke(), row.result, row.id);
              if (row.startIndex >= row.receiver.length - 1) {
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

test('String.LastIndexOf start comparison: independent CIL preserves every native result and guarded culture row', () => {
  const assemblies = [lastIndexOfStartAssembly(false), lastIndexOfStartAssembly(true)];
  for (const row of reference.rows) {
    const vm = new CilVirtualMachine(assemblies[Number(row.sameReference)], {arguments: lastIndexOfStartArguments(row)});
    try {
      const result = vm.run();
      assert.equal(result.state, lastIndexOfStartExpectedFault(row) ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (lastIndexOfStartExpectedFault(row)) assertFault(result.fault, row);
      else assert.equal(result.returnValue, row.result, row.id);
    } finally {vm.stop();}
  }
});

function expectedLast(source, value, end) {
  for (let index = end - value.length; index >= 0; index--) {
    if (equalsOrdinalIgnoreCaseRange(source, index, value)) return index;
  }
  return -1;
}

test('String.LastIndexOf start comparison: exhaustive prefixes, overlaps and surrogate cuts', () => {
  assert.equal(typeof search.lastIndexOfFromWithComparison, 'function');
  const alphabet = ['a', 'A', 'é', '\uD801', '\uDC28', '\uDC00'];
  const strings = [''];
  let level = [''];
  for (let length = 1; length <= 3; length++) {
    level = level.flatMap(prefix => alphabet.map(unit => prefix + unit));
    strings.push(...level);
  }
  for (const source of strings) {
    for (const value of strings) {
      for (let start = source.length === 0 ? -1 : 0; start <= source.length; start++) {
        const end = Math.min(start + 1, source.length);
        const expected = expectedLast(source, value, end);
        const label = JSON.stringify([source, value, start]);
        assert.equal(search.lastIndexOfFromWithComparison(undefined, source, value, start, 5), expected, label);
        assert.equal(linear.lastIndexOfOrdinalIgnoreCase(source, value, end), expected, label);
        const ordinal = value.length > end ? -1 : source.lastIndexOf(value, end - value.length);
        assert.equal(search.lastIndexOfFromWithComparison(undefined, source, value, start, 4), ordinal, label);
      }
    }
  }
});

test('String.LastIndexOf start comparison: period memory stays linear and excludes a large BMP suffix', () => {
  assert.equal(typeof search.lastIndexOfFromWithComparison, 'function');
  let previous = 0;
  for (const length of [128, 512, 2048]) {
    const source = 'é'.repeat(length + 4096);
    const value = 'É'.repeat(length / 4);
    let reads = 0;
    const view = {
      length: source.length,
      charCodeAt(index) {assert(index >= 0 && index < length, `Excluded suffix read at ${index}`); reads++; return source.charCodeAt(index);}
    };
    assert.equal(search.lastIndexOfFromWithComparison(undefined, view, value, length - 1, 5), length - value.length);
    assert(reads <= 64 * (length + value.length), `${length}: ${reads} reads`);
    if (previous) assert(reads <= previous * 5 + 64, `${length}: growth ${previous} -> ${reads}`);
    previous = reads;
  }
});

test('String.LastIndexOf start comparison:314 follows builder indexer312/313 with earlier IDs stable', () => {
  assert.equal(contract().id, 524314);
  assert.equal(findContracts('System.Text.StringBuilder', 'get_Chars', false)[0].id, 524312);
  assert.equal(findContracts('System.Text.StringBuilder', 'set_Chars', false)[0].id, 524313);
  assert.equal(contract('IndexOf', ['string', 'int', 'int', 'System.StringComparison']).id, 524311);
  assert.equal(contract('IndexOf', ['string', 'int', 'System.StringComparison']).id, 524308);
  assert.equal(contract('LastIndexOf', ['string', 'System.StringComparison']).id, 524307);
  assert.equal(contract('LastIndexOf', ['string']).id, 1261);
});

test('String.LastIndexOf start comparison: pinned native bytes retain empty/start-alias behavior', () => {
  const source = readFileSync(new URL('string-lastindexof-comparison-start/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.rows.length, 990);
  const row = id => {
    const result = reference.rows.find(value => value.id === id);
    assert(result, id);
    return result;
  };
  assert.equal(reference.rows.filter(value => value.group === 'ordinal' || value.group === 'precedence').length, 246);
  assert.equal(row('range-precedence/nulls/-1/6').fault, 'NullReferenceException');
  assert.equal(row('range-precedence/null-value/-1/6').parameter, 'value');
  assert.equal(row('range-precedence/empty-value/-1/6').parameter, 'comparisonType');
  assert.equal(row('range-precedence/empty-value/-1/4').parameter, 'startIndex');
  assert.equal(row('range-precedence/empty-both/-2/4').parameter, 'startIndex');
  assert.equal(row('range-precedence/empty-both/-1/5').result, 0);
  assert.equal(row('range-precedence/empty-both/0/5').result, 0);
  assert.equal(row('prefix/empty-value/0/5').result, 1);
  assert.equal(row('prefix/empty-value/3/5').result, 3);
  assert.equal(row('prefix/pair-high/1/5').result, 1);
  assert.equal(row('prefix/pair-low/2/5').result, 2);
  assert.equal(row('prefix/pair-fold/1/5').result, -1);
  assert.equal(row('prefix/both-cuts/4/5').result, 2);
});
