import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {containsParameters, containsArguments, containsExpression, containsComparisonAssembly,
  containsExpectedFault} from './fixtures/comparers/string-contains-comparison.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-contains-comparison-net10.json', directory), 'utf8'));
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

function contract() {
  const descriptor = findContracts('System.String', 'Contains', false)
    .find(row => row.parameters.join(',') === containsParameters.join(','));
  assert(descriptor, 'Missing String.Contains(' + containsParameters.join(',') + ')');
  return descriptor;
}

function assertFault(fault, row) {
  const expected = containsExpectedFault(row);
  assert.equal(fault?.name, expected, row.id);
  if (expected === 'NotSupportedException') assert.match(fault.message, /Ordinal.*OrdinalIgnoreCase/, row.id);
  else if (row.parameter) assert(fault.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + fault.message);
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`String Contains ${pipeline}/${engine}: idiomatic ordinal modes match every native successful result`, () => {
      const source = successful.map(row => `Console.WriteLine(${containsExpression(row)});`).join('\n');
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, successful.map(row => row.result ? 'True' : 'False').join('\n') + '\n');
      } finally {vm.stop();}
    });

    test(`String Contains ${pipeline}/${engine}: enum locals select ordinal matching`, () => {
      const vm = create(compile('StringComparison mode = StringComparison.OrdinalIgnoreCase;' +
        'Console.WriteLine("abcDeFghi".Contains("CdEf", mode));' +
        'mode = StringComparison.Ordinal;Console.WriteLine("abcDeFghi".Contains("CdEf", mode));' +
        'Console.WriteLine("abcDeFghi".Contains("cDeF", mode));', pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\nFalse\nTrue\n');
      } finally {vm.stop();}
    });
  }

  test(`String Contains ${engine}: compiled calls retain receiver/value/mode precedence`, () => {
    const cases = ['nulls/6', 'null-value/6', 'empty-receiver-null-value/6', 'identity/6',
      'empty-value/2147483647', 'empty-both/-1', 'identity/0', 'null-value/0', 'null-receiver/0'];
    for (const name of cases) {
      const row = reference.rows.find(value => value.id === `precedence/${name}`);
      assert(row, name);
      const vm = create(compile(`Console.WriteLine(${containsExpression(row)});`));
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted', row.id + ': ' + result.output);
        assertFault(result.fault, row);
      } finally {vm.stop();}
    }
  });

  test(`String Contains ${engine}: platform covers native matrix and culture guards without managed allocation`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const args = reference.rows.map(row => {
          const values = containsArguments(row);
          const receiver = platform.managed(values[0], 'string');
          platform.heap.pins.push(receiver);
          const value = row.sameReference ? receiver : platform.managed(values[1], 'string');
          platform.heap.pins.push(value);
          if (row.copyValue) assert.notEqual(receiver.h, value.h, row.id);
          return [receiver, value, values[2]];
        });
        const descriptor = contract();
        const allocations = platform.heap.stats.allocations;
        const bytes = platform.heap.stats.allocatedBytes;
        const revision = platform.heap.mutationRevision;
        for (let index = 0; index < reference.rows.length; index++) {
          const row = reference.rows[index];
          const invoke = () => platform.invoke(descriptor, args[index]);
          if (containsExpectedFault(row)) assert.throws(invoke, fault => {assertFault(fault, row); return true;});
          else assert.equal(Boolean(invoke()), row.result, row.id);
        }
        assert.equal(platform.heap.stats.allocations, allocations);
        assert.equal(platform.heap.stats.allocatedBytes, bytes);
        assert.equal(platform.heap.mutationRevision, revision);
        platform.heap.collect();
        assert.equal(Boolean(platform.invoke(descriptor, args[0])), true);
      });
      assert.equal(platform.heap.pins.length, 0);
    } finally {vm.stop();}
  });

  test(`String Contains ${engine}: bounded repeated-prefix misses, late hits and surrogate cuts preserve inputs`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const managed = text => {
          const value = platform.heap.string(text);
          platform.heap.pins.push(value);
          return value;
        };
        const descriptor = contract();
        const rows = ['a', 'é'].flatMap(letter => {
          const text = letter.repeat(1024);
          const value = letter.toUpperCase().repeat(63) + 'B';
          return [[managed(text), managed(value), false], [managed(text + 'b'), managed(value), true]];
        });
        rows.push([managed('x\uD801\uDC28' + 'é'.repeat(128) + '\uD801\uDC28z'),
          managed('\uDC28' + 'É'.repeat(128) + '\uD801'), true]);
        const allocations = platform.heap.stats.allocations;
        const bytes = platform.heap.stats.allocatedBytes;
        const revision = platform.heap.mutationRevision;
        for (const [receiver, value, expected] of rows) {
          assert.equal(Boolean(platform.invoke(descriptor, [receiver, value, 5])), expected);
          assert.equal(Boolean(platform.invoke(descriptor, [receiver, value, 4])), false);
        }
        assert.equal(platform.heap.stats.allocations, allocations);
        assert.equal(platform.heap.stats.allocatedBytes, bytes);
        assert.equal(platform.heap.mutationRevision, revision);
      });
    } finally {vm.stop();}
  });

  test(`String Contains ${engine}: released one-argument contract keeps its behavior`, () => {
    const vm = create(compile('Console.WriteLine("abcDeFghi".Contains("cDeF"));' +
      'Console.WriteLine("abcDeFghi".Contains("CdEf"));Console.WriteLine("".Contains(""));' +
      'Console.WriteLine("abc".Contains("abcd"));'));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, 'True\nFalse\nTrue\nFalse\n');
    } finally {vm.stop();}
  });
}

test('String Contains: independent CIL matches every native ordinal/fault row and explicit culture guard', () => {
  const assemblies = new Map();
  for (const row of reference.rows) {
    if (!assemblies.has(row.sameReference)) assemblies.set(row.sameReference, containsComparisonAssembly(row.sameReference));
    const vm = new CilVirtualMachine(assemblies.get(row.sameReference), {arguments: containsArguments(row)});
    try {
      const result = vm.run();
      assert.equal(result.state, containsExpectedFault(row) ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (containsExpectedFault(row)) assertFault(result.fault, row);
      else assert.equal(result.returnValue, row.result, row.id);
    } finally {vm.stop();}
  }
});

test('String Contains: contract appends after range Compare without moving released slots', () => {
  assert.equal(contract().id, 524305);
  assert.equal(findContracts('System.String', 'Contains', false).find(row => row.parameters.length === 1).id, 1258);
  assert.equal(findContracts('System.String', 'Compare', true).find(row => row.parameters.length === 6).id, 524304);
  assert.equal(findContracts('System.String', 'EndsWith', false).find(row => row.parameters.length === 2).id, 524303);
  assert.equal(findContracts('System.String', 'Equals', false).find(row => row.parameters.length === 2).id, 524300);
  assert.equal(findContracts('System.String', 'CompareOrdinal', true).find(row => row.parameters.length === 5).id, 524298);
});

test('String Contains: unchanged native capture pins null priority, invalid shortcuts and surrogate boundaries', () => {
  const source = readFileSync(new URL('string-contains-comparison/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.rows.length, 194);
  const row = id => reference.rows.find(value => value.id === id);
  assert.equal(row('precedence/nulls/6').fault, 'NullReferenceException');
  assert.equal(row('precedence/null-value/6').fault, 'ArgumentNullException');
  assert.equal(row('precedence/null-value/6').parameter, 'value');
  assert.equal(row('precedence/empty-value/6').parameter, 'comparisonType');
  assert.equal(row('precedence/identity/0').result, true);
  assert.equal(row('precedence/empty-both/0').result, true);
  for (const length of [7, 15, 31]) {
    for (const name of ['start-split', 'end-split', 'both-split']) assert.equal(row(`ordinal/${name}-${length}/5`).result, true);
  }
});
