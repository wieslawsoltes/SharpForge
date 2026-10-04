import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import * as stringSearch from '../packages/bcl-core/src/system/string-search.js';
import {equalsOrdinalIgnoreCaseRange} from '../packages/bcl-core/src/system/string-compare.js';
import {lastIndexOfParameters, lastIndexOfArguments, lastIndexOfExpression, lastIndexOfComparisonAssembly,
  lastIndexOfExpectedFault} from './fixtures/comparers/string-lastindexof-comparison.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-lastindexof-comparison-net10.json', directory), 'utf8'));
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

function contract(name = 'LastIndexOf', parameters = lastIndexOfParameters) {
  const descriptor = findContracts('System.String', name, false)
    .find(row => row.parameters.join(',') === parameters.join(','));
  assert(descriptor, `Missing String.${name}(${parameters.join(',')})`);
  return descriptor;
}

function assertFault(fault, row) {
  const expected = lastIndexOfExpectedFault(row);
  assert.equal(fault?.name, expected, row.id);
  if (expected === 'NotSupportedException') assert.match(fault.message, /Ordinal.*OrdinalIgnoreCase/, row.id);
  else if (row.parameter) assert(fault.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + fault.message);
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`String.LastIndexOf comparison ${pipeline}/${engine}: exact native last UTF-16 offsets`, () => {
      const source = successful.map(row => `Console.WriteLine(${lastIndexOfExpression(row)});`).join('\n');
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, successful.map(row => row.result).join('\n') + '\n');
      } finally {vm.stop();}
    });

    test(`String.LastIndexOf comparison ${pipeline}/${engine}: enum locals, overlaps and empty needles`, () => {
      const source = 'StringComparison mode = StringComparison.OrdinalIgnoreCase;' +
        'Console.WriteLine("aBaB".LastIndexOf("b", mode));Console.WriteLine("aBaB".LastIndexOf("B"));' +
        'mode = StringComparison.Ordinal;Console.WriteLine("aBaB".LastIndexOf("b", mode));' +
        'Console.WriteLine("aBaB".LastIndexOf("", mode));Console.WriteLine("".LastIndexOf("", mode));' +
        'mode = StringComparison.OrdinalIgnoreCase;Console.WriteLine("aaaaa".LastIndexOf("AAA", mode));' +
        'Console.WriteLine("aaaaa".IndexOf("AAA", mode));';
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '3\n3\n-1\n4\n0\n2\n0\n');
      } finally {vm.stop();}
    });
  }

  test(`String.LastIndexOf comparison ${engine}: null and mode checks precede empty/identity shortcuts`, () => {
    const cases = ['nulls/6', 'null-value/6', 'empty-receiver-null-value/6', 'identity/6',
      'empty-value/2147483647', 'empty-both/-1', 'identity/0', 'null-value/0', 'null-receiver/0'];
    for (const name of cases) {
      const row = reference.rows.find(value => value.id === `precedence/${name}`);
      assert(row, name);
      const vm = create(compile(`Console.WriteLine(${lastIndexOfExpression(row)});`));
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted', row.id + ': ' + result.output);
        assertFault(result.fault, row);
      } finally {vm.stop();}
    }
  });

  test(`String.LastIndexOf comparison ${engine}: native last/first/Contains results survive GC without managed allocation`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const args = reference.rows.map(row => {
          const values = lastIndexOfArguments(row);
          const receiver = platform.managed(values[0], 'string');
          platform.heap.pins.push(receiver);
          const value = row.sameReference ? receiver : platform.managed(values[1], 'string');
          platform.heap.pins.push(value);
          if (row.copyValue) assert.notEqual(receiver.h, value.h, row.id);
          return [receiver, value, values[2]];
        });
        const members = [['LastIndexOf', 'result'], ['IndexOf', 'firstIndex'], ['Contains', 'contains']]
          .map(([name, field]) => ({member: contract(name), field}));
        const allocations = platform.heap.stats.allocations;
        const bytes = platform.heap.stats.allocatedBytes;
        const revision = platform.heap.mutationRevision;
        const check = () => {
          for (let index = 0; index < reference.rows.length; index++) {
            const row = reference.rows[index];
            for (const {member, field} of members) {
              const invoke = () => platform.invoke(member, args[index]);
              if (lastIndexOfExpectedFault(row)) assert.throws(invoke, fault => {assertFault(fault, row); return true;});
              else {
                const result = invoke();
                assert.equal(field === 'contains' ? Boolean(result) : result, row[field], row.id + '/' + field);
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

  test(`String.LastIndexOf comparison ${engine}: repeated-prefix misses, all overlaps and final surrogate cuts`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const managed = text => {
          const value = platform.heap.string(text);
          platform.heap.pins.push(value);
          return value;
        };
        const rows = ['a', 'é'].flatMap(letter => {
          const text = letter.repeat(1024);
          const value = letter.toUpperCase().repeat(63) + 'B';
          return [[managed(text), managed(value), -1], [managed(text + 'b'), managed(value), 961],
            [managed(text), managed(letter.toUpperCase().repeat(64)), 960]];
        });
        rows.push([managed('x\uD801\uDC28' + 'é'.repeat(128) + '\uD801\uDC28z'),
          managed('\uDC28' + 'É'.repeat(128) + '\uD801'), 2]);
        const descriptor = contract();
        const allocations = platform.heap.stats.allocations;
        const bytes = platform.heap.stats.allocatedBytes;
        for (const [receiver, value, expected] of rows) {
          assert.equal(platform.invoke(descriptor, [receiver, value, 5]), expected);
          assert.equal(platform.invoke(descriptor, [receiver, value, 4]), -1);
        }
        assert.equal(platform.heap.stats.allocations, allocations);
        assert.equal(platform.heap.stats.allocatedBytes, bytes);
      });
    } finally {vm.stop();}
  });
}

test('String.LastIndexOf comparison: independent CIL preserves every native offset, fault and culture guard', () => {
  const assemblies = [lastIndexOfComparisonAssembly(false), lastIndexOfComparisonAssembly(true)];
  for (const row of reference.rows) {
    const vm = new CilVirtualMachine(assemblies[Number(row.sameReference)], {arguments: lastIndexOfArguments(row)});
    try {
      const result = vm.run();
      assert.equal(result.state, lastIndexOfExpectedFault(row) ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (lastIndexOfExpectedFault(row)) assertFault(result.fault, row);
      else assert.equal(result.returnValue, row.result, row.id);
    } finally {vm.stop();}
  }
});

test('String.LastIndexOf comparison: independent CIL retains the released single-string signature', () => {
  const vm = new CilVirtualMachine(lastIndexOfComparisonAssembly(false, ['string']), {arguments: ['aBaB', 'B']});
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, 3);
  } finally {vm.stop();}
});

function countedLastSearch(source, needle) {
  let accesses = 0;
  const view = text => ({
    length: text.length,
    charCodeAt(index) {
      assert(index >= 0 && index < text.length);
      accesses++;
      return text.charCodeAt(index);
    },
    codePointAt(index) {
      assert(index >= 0 && index < text.length);
      const point = text.codePointAt(index);
      accesses += point > 0xffff ? 2 : 1;
      return point;
    }
  });
  const result = stringSearch.lastIndexOfWithComparison(undefined, view(source), view(needle), 5);
  return {result, accesses};
}

test('String.LastIndexOf comparison: exhaustive small UTF-16 inputs retain the last bounded match', () => {
  const alphabet = ['a', 'A', 'é', 'É', '\uD801', '\uDC28', '\uDC00'];
  const inputs = [''];
  let layer = [''];
  for (let length = 1; length <= 3; length++) {
    layer = layer.flatMap(prefix => alphabet.map(unit => prefix + unit));
    inputs.push(...layer);
  }
  for (const source of inputs) {
    for (const needle of inputs) {
      let expected = -1;
      for (let start = source.length - needle.length; start >= 0; start--) {
        if (equalsOrdinalIgnoreCaseRange(source, start, needle)) {
          expected = start;
          break;
        }
      }
      const actual = stringSearch.lastIndexOfWithComparison(undefined, source, needle, 5);
      if (actual !== expected) assert.fail(JSON.stringify({source, needle, actual, expected}));
    }
  }
});

test('String.LastIndexOf comparison: continuing periodic matches keeps linear read growth', () => {
  let previous = 0;
  for (const length of [128, 512, 2048]) {
    const size = length / 4;
    const {result, accesses} = countedLastSearch('é'.repeat(length), 'É'.repeat(size));
    assert.equal(result, length - size);
    assert(accesses <= 64 * (length + size) + 64, `${accesses} reads for ${length}/${size}`);
    if (previous) assert(accesses <= 5 * previous + 64, 'All overlapping matches must not restart the search');
    previous = accesses;
  }
});

test('String.LastIndexOf comparison:307 appends after IndexOf and preserves released ABI', () => {
  assert.equal(contract().id, 524307);
  assert.equal(contract('IndexOf').id, 524306);
  assert.equal(contract('Contains').id, 524305);
  assert.equal(contract('LastIndexOf', ['string']).id, 1261);
});

test('String.LastIndexOf comparison: frozen native capture retains empty-at-end and rejection-after-hit evidence', () => {
  const source = readFileSync(new URL('string-lastindexof-comparison/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.rows.length, 246);
  const row = id => reference.rows.find(value => value.id === id);
  assert.equal(row('precedence/nulls/6').fault, 'NullReferenceException');
  assert.equal(row('precedence/null-value/6').parameter, 'value');
  assert.equal(row('precedence/empty-value/6').parameter, 'comparisonType');
  assert.equal(row('ordinal/empty-nonempty-last/4').result, 6);
  assert.equal(row('ordinal/empty-supplementary-last/5').result, 3);
  assert.equal(row('ordinal/supplementary-last-offset/5').result, 7);
  assert.equal(row('ordinal/trailing-rejections-after-hit/5').result, 0);
  assert.equal(row('ordinal/two-endpoint-last/5').result, 129);
  assert.equal(row('ordinal/periodic-all-matches/5').result, 97);
  for (const value of reference.rows) {
    if (value.fault === null) {
      assert.equal(value.contains, value.result >= 0, value.id);
      assert(value.firstIndex <= value.result, value.id);
    }
  }
});
