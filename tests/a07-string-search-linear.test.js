import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {indexOfWithComparison} from '../packages/bcl-core/src/system/string-search.js';
import {indexOfOrdinalIgnoreCase} from '../packages/bcl-core/src/system/string-search-linear.js';
import {equalsOrdinalIgnoreCaseRange} from '../packages/bcl-core/src/system/string-compare.js';
import {simpleUpperPoint} from '../packages/bcl-core/src/system/casing.js';
import {upperCaseRanges} from '../packages/bcl-core/src/system/unicode-upper-case.js';
import {containsComparisonAssembly, containsExpectedFault} from './fixtures/comparers/string-contains-comparison.js';
import {indexOfComparisonAssembly, indexOfExpectedFault} from './fixtures/comparers/string-indexof-comparison.js';

// This is the released bounded matcher and candidate loop, retained only as an independent differential oracle.
function previousSearch(source, needle) {
  for (let start = 0; start <= source.length - needle.length; start++) {
    if (equalsOrdinalIgnoreCaseRange(source, start, needle)) return start;
  }
  return -1;
}

function words(alphabet, maximum) {
  const output = [''];
  let layer = [''];
  for (let length = 1; length <= maximum; length++) {
    layer = layer.flatMap(prefix => alphabet.map(unit => prefix + unit));
    output.push(...layer);
  }
  return output;
}

function assertSearch(source, needle) {
  const expected = previousSearch(source, needle);
  const actual = indexOfWithComparison(undefined, source, needle, 5);
  if (actual !== expected) assert.fail(JSON.stringify({source, needle, actual, expected}));
  const direct = indexOfOrdinalIgnoreCase(source, needle);
  if (direct !== expected) assert.fail(JSON.stringify({source, needle, direct, expected}));
}

test('Linear string search: exhaustive small UTF-16 inputs preserve the released bounded matcher', () => {
  const inputs = words(['a', 'A', 'é', 'É', '\uD801', '\uDC28', '\uDC00'], 3);
  for (const source of inputs) for (const needle of inputs) assertSearch(source, needle);
});

test('Linear string search: exhaustive surrounding units preserve both clipped surrogate boundaries', () => {
  const needles = words(['a', 'A', 'é', '\uD801', '\uDC28', '\uDC00'], 3);
  const surroundings = ['', 'a', '\uD801', '\uDC28', '\uDC00'];
  for (const needle of needles) {
    const folded = needle.replaceAll('a', 'A').replaceAll('é', 'É').replaceAll('\uD801\uDC28', '\uD801\uDC00');
    for (const prefix of surroundings) {
      for (const suffix of surroundings) assertSearch(prefix + needle + suffix, folded);
    }
  }
});

test('Linear string search: mapped scalar widths and UTF-16 categories remain stable', () => {
  for (let row = 0; row < upperCaseRanges.length; row += 4) {
    for (let point = upperCaseRanges[row]; point <= upperCaseRanges[row + 1]; point += upperCaseRanges[row + 3]) {
      const mapped = simpleUpperPoint(point);
      assert.equal(mapped > 0xffff, point > 0xffff, point.toString(16));
      assert(mapped < 0xd800 || mapped > 0xdfff, point.toString(16));
    }
  }
  for (let unit = 0xd800; unit <= 0xdfff; unit++) assert.equal(simpleUpperPoint(unit), unit);
});

function countedSearch(source, needle) {
  let accesses = 0;
  const view = text => ({
    length: text.length,
    charCodeAt(index) {
      assert(index >= 0 && index < text.length, 'Code-unit access must stay within the input');
      accesses++;
      return text.charCodeAt(index);
    },
    codePointAt(index) {
      assert(index >= 0 && index < text.length, 'Scalar access must stay within the input');
      const point = text.codePointAt(index);
      accesses += point > 0xffff ? 2 : 1;
      return point;
    }
  });
  const result = indexOfWithComparison(undefined, view(source), view(needle), 5);
  return {result, accesses};
}

const growthCases = {
  'ASCII repeated-prefix miss': (length, size) => ['a'.repeat(length), 'A'.repeat(size - 1) + 'B'],
  'Unicode repeated-prefix late hit': (length, size) => ['é'.repeat(length) + 'b', 'É'.repeat(size - 1) + 'B'],
  'periodic leading endpoint rejection': (length, size) => ['é'.repeat(length), '\uDC28' + 'É'.repeat(size)],
  'periodic trailing endpoint rejection': (length, size) => ['é'.repeat(length), 'É'.repeat(size) + '\uD801'],
  'periodic two-endpoint rejection': (length, size) => ['éa'.repeat(length / 2), '\uDC28' + 'ÉA'.repeat(size / 2) + '\uD801'],
  'mapped supplementary periodic rejection': (length, size) => [
    '\uD801\uDC28'.repeat(length / 2), '\uDC00' + '\uD801\uDC00'.repeat(size / 2) + '\uD800']
};

for (const [name, create] of Object.entries(growthCases)) {
  test(`Linear string search: counted access stays linear for ${name}`, () => {
    let previous = 0;
    for (const length of [128, 512, 2048]) {
      const [source, needle] = create(length, length / 4);
      const {result, accesses} = countedSearch(source, needle);
      assert.equal(result, previousSearch(source, needle));
      assert(accesses <= 64 * (source.length + needle.length) + 64,
        `${name}: ${accesses} unit accesses for n=${source.length}, m=${needle.length}`);
      if (previous) assert(accesses <= 5 * previous + 64, `${name}: quadrupling input must not cause quadratic access growth`);
      previous = accesses;
    }
  });
}

const boundaryCases = [
  ['\uD801\uDC28', '\uDC28'], ['\uD801\uDC28', '\uDC00'], ['\uD801\uDC28', '\uD801'],
  ['\uD801\uDC28a\uD801\uDC28', '\uDC28A\uD801'],
  ['\uD801\uDC28\uD801\uDC28', '\uDC28\uD801'],
  ['\uD801\uDC28', '\uDC28\uD801'], ['\uDC28\uD801', '\uDC28\uD801'],
  ['\uD801\uD801\uDC28\uDC28', '\uD801\uDC28'],
  ['é'.repeat(512), '\uDC28' + 'É'.repeat(63) + '\uD801'],
  ['é'.repeat(512) + '\uDC28' + 'é'.repeat(63) + '\uD801', '\uDC28' + 'É'.repeat(63) + '\uD801'],
  ['éa'.repeat(256) + '\uDC28éaéa\uD801', '\uDC28ÉAÉA\uD801'],
  ['ab'.repeat(128) + 'aBc', 'AB'.repeat(32) + 'ABC'],
  ['é'.repeat(1024) + 'b', 'É'.repeat(127) + 'B'],
  ['é'.repeat(1024), 'É'.repeat(127) + 'B'],
  ['x\0\uD801\uDC28\0z', '\0\uD801\uDC00\0'],
  ['x\u017Fz', 'S'], ['x\u{16ebb}z', '\u{16ea0}']
];

const thresholdCases = [8, 9].flatMap(length => {
  const lower = 'é'.repeat(length - 2);
  const upper = 'É'.repeat(length - 2);
  return [
    ['a'.repeat(48) + 'b', 'A'.repeat(length - 1) + 'B'],
    ['é'.repeat(48), 'É'.repeat(length - 1) + 'B'],
    ['x\uD801\uDC28' + lower + '\uD801\uDC28z', '\uDC28' + upper + '\uD801'],
    [lower.repeat(4) + '\uDC28' + lower + '\uD801', '\uDC28' + upper + '\uD801'],
    ['ab'.repeat(32) + 'C', ('AB'.repeat(4) + 'C').slice(-length)]
  ];
});

test('Linear string search: eight/nine-unit threshold retains offsets and bounded access', () => {
  for (const [source, needle] of thresholdCases) {
    assert(needle.length === 8 || needle.length === 9);
    assertSearch(source, needle);
  }
  for (const size of [8, 9]) {
    let previous = 0;
    for (const length of [128, 512, 2048]) {
      const source = 'é'.repeat(length);
      const needle = 'É'.repeat(size - 1) + 'B';
      const {result, accesses} = countedSearch(source, needle);
      assert.equal(result, -1);
      assert(accesses <= 64 * (source.length + needle.length) + 64);
      if (previous) assert(accesses <= 5 * previous + 64);
      previous = accesses;
    }
  }
});

const executionCases = [...boundaryCases, ...thresholdCases];

test('Linear string search: periodic endpoint rejections preserve earliest offsets', () => {
  for (const [source, needle] of boundaryCases) assertSearch(source, needle);
  for (const needle of words(['\uD801', '\uDC28', '\uDC00'], 2)) {
    for (const source of words(['\uD801', '\uDC28', '\uDC00'], 4)) assertSearch(source, needle);
  }
});

test('Linear string search: long periodic and nonperiodic cores agree across every surrounding boundary', () => {
  const cores = ['aAé', '\uD801\uDC28a', '\uDC28a\uD801', 'ababa', '\0éa', '\uD801a\uDC28'];
  for (const core of cores) {
    for (const repetitions of [2, 5, 17]) {
      const body = core.repeat(repetitions);
      const upper = body.replaceAll('a', 'A').replaceAll('é', 'É').replaceAll('\uD801\uDC28', '\uD801\uDC00');
      for (const [prefix, suffix] of [['', ''], ['\uDC28', ''], ['', '\uD801'], ['\uDC28', '\uD801']]) {
        for (const terminal of ['', 'B', '\0']) {
          const needle = prefix + upper + terminal + suffix;
          assertSearch(body + body, needle);
          assertSearch(body + body + prefix + body + terminal + suffix, needle);
          assertSearch('x' + body + 'y' + prefix + body + terminal + suffix + body, needle);
        }
      }
    }
  }
});

const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
const parameters = 'string,System.StringComparison';
const descriptor = method => findContracts('System.String', method, false).find(row => row.parameters.join(',') === parameters);
const compiled = new Map();

function compile(source, pipeline = 'bound') {
  const key = pipeline + source;
  if (!compiled.has(key)) {
    const program = compileToIL('using System;' + source, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    compiled.set(key, program);
  }
  return compiled.get(key);
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`Linear string search ${pipeline}/${engine}: earliest offsets and Contains agree across endpoints and eight/nine units`, () => {
      const source = executionCases.map(([receiver, value]) =>
        `Console.WriteLine((${JSON.stringify(receiver)}).IndexOf(${JSON.stringify(value)}, StringComparison.OrdinalIgnoreCase));` +
        `Console.WriteLine((${JSON.stringify(receiver)}).Contains(${JSON.stringify(value)}, StringComparison.OrdinalIgnoreCase));`).join('\n');
      const expected = executionCases.map(([receiver, value]) => {
        const index = previousSearch(receiver, value);
        return index + '\n' + (index >= 0 ? 'True' : 'False');
      }).join('\n') + '\n';
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, expected);
      } finally {vm.stop();}
    });
  }

  test(`Linear string search ${engine}: unchanged native Contains and IndexOf oracles, faults and allocation counts`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
    const references = [
      ['Contains', 'string-contains-comparison-net10.json', containsExpectedFault],
      ['IndexOf', 'string-indexof-comparison-net10.json', indexOfExpectedFault]
    ];
    try {
      for (const [method, filename, faultFor] of references) {
        const reference = JSON.parse(readFileSync(new URL(filename, directory), 'utf8'));
        const member = descriptor(method);
        platform.heap.withRoots([], () => {
          const managed = units => {
            const value = platform.managed(units === null ? null : String.fromCharCode(...units), 'string');
            platform.heap.pins.push(value);
            return value;
          };
          const cases = reference.rows.map(row => {
            const receiver = managed(row.receiver);
            return {row, args: [receiver, row.sameReference ? receiver : managed(row.value), row.mode]};
          });
          const allocations = platform.heap.stats.allocations;
          const bytes = platform.heap.stats.allocatedBytes;
          const revision = platform.heap.mutationRevision;
          for (const {row, args} of cases) {
            const fault = faultFor(row);
            if (fault) assert.throws(() => platform.invoke(member, args), error => error.name === fault, row.id);
            else {
              const result = platform.invoke(member, args);
              assert.equal(method === 'Contains' ? Boolean(result) : result, row.result, row.id);
            }
          }
          assert.equal(platform.heap.stats.allocations, allocations);
          assert.equal(platform.heap.stats.allocatedBytes, bytes);
          assert.equal(platform.heap.mutationRevision, revision);
          platform.heap.collect();
          const result = platform.invoke(member, cases[0].args);
          assert.equal(method === 'Contains' ? Boolean(result) : result, cases[0].row.result);
        });
        assert.equal(platform.heap.pins.length, 0);
      }
    } finally {vm.stop();}
  });
}

test('Linear string search: independently assembled CIL preserves the first UTF-16 match', () => {
  const assemblies = [indexOfComparisonAssembly(), containsComparisonAssembly()];
  for (const [source, needle] of executionCases) {
    const expected = previousSearch(source, needle);
    for (let method = 0; method < assemblies.length; method++) {
      const vm = new CilVirtualMachine(assemblies[method], {arguments: [source, needle, 5]});
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.returnValue, method === 0 ? expected : expected >= 0);
      } finally {vm.stop();}
    }
  }
});
