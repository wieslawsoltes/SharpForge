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
import {indexOfStartParameters, indexOfStartArguments, indexOfStartExpression, indexOfStartAssembly,
  indexOfStartExpectedFault} from './fixtures/comparers/string-indexof-comparison-start.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-indexof-comparison-start-net10.json', directory), 'utf8'));
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

function contract(name = 'IndexOf', parameters = indexOfStartParameters) {
  const descriptor = findContracts('System.String', name, false)
    .find(row => row.parameters.join(',') === parameters.join(','));
  assert(descriptor, `Missing String.${name}(${parameters.join(',')})`);
  return descriptor;
}

function assertFault(fault, row) {
  const expected = indexOfStartExpectedFault(row);
  assert.equal(fault?.name, expected, row.id);
  if (expected === 'NotSupportedException') assert.match(fault.message, /Ordinal.*OrdinalIgnoreCase/, row.id);
  else if (row.parameter) assert(fault.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + fault.message);
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`String.IndexOf start comparison ${pipeline}/${engine}: native absolute UTF-16 offsets`, () => {
      const source = successful.map(row => `Console.WriteLine(${indexOfStartExpression(row)});`).join('\n');
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, successful.map(row => row.result).join('\n') + '\n');
      } finally {vm.stop();}
    });

    test(`String.IndexOf start comparison ${pipeline}/${engine}: enum locals and released overloads`, () => {
      const source = 'StringComparison mode = StringComparison.OrdinalIgnoreCase; int start = 2;' +
        'Console.WriteLine("aBaB".IndexOf("b", start, mode));Console.WriteLine("aBaB".IndexOf("b", mode));' +
        'Console.WriteLine("aBaB".IndexOf("B", start));Console.WriteLine("aBaB".IndexOf("B"));' +
        'Console.WriteLine("aBaB".IndexOf("", 4, mode));Console.WriteLine("".IndexOf("", 0, mode));' +
        'Console.WriteLine("aBaB".IndexOf("B", 4, mode));mode = StringComparison.Ordinal;' +
        'Console.WriteLine("aBaB".IndexOf("b", start, mode));Console.WriteLine("aBaB".LastIndexOf("B", mode));';
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '3\n1\n3\n1\n4\n0\n-1\n-1\n3\n');
      } finally {vm.stop();}
    });
  }

  test(`String.IndexOf start comparison ${engine}: compiled null/enum/range/culture precedence`, () => {
    const ids = ['range-precedence/nulls/-1/6', 'range-precedence/null-value/-1/6',
      'range-precedence/empty-value/-1/6', 'range-precedence/empty-value/-1/4',
      'range-precedence/empty-value/-1/0', 'range-precedence/identity/2147483647/5',
      'precedence/empty-value/0/0', 'precedence/identity/0/6', 'precedence/null-value/0/0'];
    for (const id of ids) {
      const row = reference.rows.find(value => value.id === id);
      assert(row, id);
      const vm = create(compile(`Console.WriteLine(${indexOfStartExpression(row)});`));
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted', row.id + ': ' + result.output);
        assertFault(result.fault, row);
      } finally {vm.stop();}
    }
  });

  test(`String.IndexOf start comparison ${engine}: native matrix before/after managed collection`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const args = reference.rows.map(row => {
          const values = indexOfStartArguments(row);
          const receiver = platform.managed(values[0], 'string');
          platform.heap.pins.push(receiver);
          const value = row.sameReference ? receiver : platform.managed(values[1], 'string');
          platform.heap.pins.push(value);
          if (row.copyValue) assert.notEqual(receiver.h, value.h, row.id);
          return [receiver, value, values[2], values[3]];
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
            if (indexOfStartExpectedFault(row)) assert.throws(invoke, fault => {assertFault(fault, row); return true;});
            else {
              assert.equal(invoke(), row.result, row.id);
              if (row.startIndex === 0) {
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

test('String.IndexOf start comparison: independent CIL preserves every native result and guarded culture row', () => {
  const assemblies = [indexOfStartAssembly(false), indexOfStartAssembly(true)];
  for (const row of reference.rows) {
    const vm = new CilVirtualMachine(assemblies[Number(row.sameReference)], {arguments: indexOfStartArguments(row)});
    try {
      const result = vm.run();
      assert.equal(result.state, indexOfStartExpectedFault(row) ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (indexOfStartExpectedFault(row)) assertFault(result.fault, row);
      else assert.equal(result.returnValue, row.result, row.id);
    } finally {vm.stop();}
  }
});

function expectedIndex(source, value, start) {
  for (let index = start; index <= source.length - value.length; index++) {
    if (equalsOrdinalIgnoreCaseRange(source, index, value)) return index;
  }
  return -1;
}

test('String.IndexOf start comparison: exhaustive first offsets for every lower bound and surrogate cut', () => {
  assert.equal(typeof search.indexOfFromWithComparison, 'function');
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
        const expected = expectedIndex(source, value, start);
        const label = JSON.stringify([source, value, start]);
        assert.equal(search.indexOfFromWithComparison(undefined, source, value, start, 5), expected, label);
        // Exercise Two-Way directly even for <=8-unit needles routed through the production fast path.
        assert.equal(linear.indexOfOrdinalIgnoreCase(source, value, start), expected, label);
      }
    }
  }
});

test('String.IndexOf start comparison: bounded reads exclude long prefixes and stay linear on periodic tails', () => {
  assert.equal(typeof search.indexOfFromWithComparison, 'function');
  const start = 4096;
  for (const needleLength of [8, 9, 32]) {
    for (const tailLength of [128, 512, 2048]) {
      const source = 'x'.repeat(start) + 'é'.repeat(tailLength) + 'b';
      const value = 'É'.repeat(needleLength - 1) + 'B';
      let reads = 0;
      const view = {
        length: source.length,
        charCodeAt(index) {assert(index >= start, `Excluded prefix read at ${index}`); reads++; return source.charCodeAt(index);},
        codePointAt(index) {assert(index >= start, `Excluded prefix read at ${index}`); reads++; return source.codePointAt(index);}
      };
      assert.equal(search.indexOfFromWithComparison(undefined, view, value, start, 5), source.length - value.length);
      assert(reads <= 64 * (tailLength + value.length + 1), `${needleLength}/${tailLength}: ${reads} reads`);
    }
  }
});

test('String.IndexOf start comparison:308 appends after307 and preserves old same-name contracts', () => {
  assert.equal(contract().id, 524308);
  assert.equal(contract('LastIndexOf', ['string', 'System.StringComparison']).id, 524307);
  assert.equal(contract('IndexOf', ['string', 'System.StringComparison']).id, 524306);
  assert.equal(contract('IndexOf', ['string']).id, 1259);
  assert.equal(contract('IndexOf', ['string', 'int']).id, 1260);
});

test('String.IndexOf start comparison: pinned native bytes and explicit precedence evidence', () => {
  const source = readFileSync(new URL('string-indexof-comparison-start/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.rows.length, 832);
  const row = id => {
    const result = reference.rows.find(value => value.id === id);
    assert(result, id);
    return result;
  };
  assert.equal(reference.rows.filter(value => value.group === 'ordinal' || value.group === 'precedence').length, 218);
  assert.equal(row('range-precedence/nulls/-1/6').fault, 'NullReferenceException');
  assert.equal(row('range-precedence/null-value/-1/6').parameter, 'value');
  assert.equal(row('range-precedence/empty-value/-1/6').parameter, 'comparisonType');
  assert.equal(row('range-precedence/empty-value/-1/4').parameter, 'startIndex');
  assert.equal(row('range-precedence/empty-value/-1/0').parameter, 'startIndex');
  assert.equal(row('window/empty-pair/1/5').result, 1);
  assert.equal(row('window/empty-pair/3/5').result, 3);
  assert.equal(row('window/low-cut/1/5').result, 1);
  assert.equal(row('window/low-cut/2/5').result, 4);
  assert.equal(row('window/paired-fold/1/5').result, 3);
  assert.equal(row('window/next-folded/4/5').result, 6);
});
