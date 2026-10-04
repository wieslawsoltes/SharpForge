import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {affixParameters, affixArguments, affixExpression, affixComparisonAssembly,
  affixExpectedFault} from './fixtures/comparers/string-affix-comparison.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-affix-comparison-net10.json', directory), 'utf8'));
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

function contract(method) {
  const descriptor = findContracts('System.String', method, false)
    .find(row => row.parameters.join(',') === affixParameters.join(','));
  assert(descriptor, 'Missing String.' + method + '(' + affixParameters.join(',') + ')');
  return descriptor;
}

function assertFault(fault, row) {
  const expected = affixExpectedFault(row);
  assert.equal(fault?.name, expected, row.id);
  if (expected === 'NotSupportedException') assert.match(fault.message, /Ordinal.*OrdinalIgnoreCase/, row.id);
  else if (row.parameter) assert(fault.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + fault.message);
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`String affixes ${pipeline}/${engine}: idiomatic ordinal modes match every native successful result`, () => {
      const source = successful.map(row => `Console.WriteLine(${affixExpression(row)});`).join('\n');
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, successful.map(row => row.result ? 'True' : 'False').join('\n') + '\n');
      } finally {vm.stop();}
    });

    test(`String affixes ${pipeline}/${engine}: enum locals reach both registered methods`, () => {
      const vm = create(compile('StringComparison mode = StringComparison.OrdinalIgnoreCase;' +
        'Console.WriteLine("AbCdef".StartsWith("aBc", mode));Console.WriteLine("abcDeF".EndsWith("dEf", mode));' +
        'mode = StringComparison.Ordinal;' +
        'Console.WriteLine("AbCdef".StartsWith("aBc", mode));Console.WriteLine("abcDeF".EndsWith("dEf", mode));', pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\nTrue\nFalse\nFalse\n');
      } finally {vm.stop();}
    });
  }

  test(`String affixes ${engine}: compiled calls retain receiver/value/mode precedence`, () => {
    const cases = ['nulls/6', 'null-value/6', 'identity/6', 'empty-value/2147483647',
      'identity/0', 'null-value/0', 'null-receiver/0'];
    for (const method of ['StartsWith', 'EndsWith']) {
      for (const name of cases) {
        const row = reference.rows.find(value => value.id === `precedence/${name}/${method}`);
        assert(row, name);
        const vm = create(compile(`Console.WriteLine(${affixExpression(row)});`));
        try {
          const result = vm.run();
          assert.equal(result.state, 'faulted', row.id + ': ' + result.output);
          assertFault(result.fault, row);
        } finally {vm.stop();}
      }
    }
  });

  test(`String affixes ${engine}: platform calls cover the native matrix and explicit culture guards without text allocation`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const args = reference.rows.map(row => {
          const values = affixArguments(row);
          const receiver = platform.managed(values[0], 'string');
          platform.heap.pins.push(receiver);
          const value = row.sameReference ? receiver : platform.managed(values[1], 'string');
          platform.heap.pins.push(value);
          if (row.copyValue) assert.notEqual(receiver.h, value.h, row.id);
          return [receiver, value, values[2]];
        });
        const descriptors = new Map(['StartsWith', 'EndsWith'].map(method => [method, contract(method)]));
        const allocations = platform.heap.stats.allocations;
        const bytes = platform.heap.stats.allocatedBytes;
        const revision = platform.heap.mutationRevision;
        for (let index = 0; index < reference.rows.length; index++) {
          const row = reference.rows[index];
          const invoke = () => platform.invoke(descriptors.get(row.method), args[index]);
          if (affixExpectedFault(row)) assert.throws(invoke, fault => {assertFault(fault, row); return true;});
          else assert.equal(Boolean(invoke()), row.result, row.id);
        }
        assert.equal(platform.heap.stats.allocations, allocations);
        assert.equal(platform.heap.stats.allocatedBytes, bytes);
        assert.equal(platform.heap.mutationRevision, revision);
        platform.heap.collect();
        assert.equal(Boolean(platform.invoke(descriptors.get(reference.rows[0].method), args[0])), true);
      });
      assert.equal(platform.heap.pins.length, 0);
    } finally {vm.stop();}
  });

  test(`String affixes ${engine}: long folded affixes and bounded surrogate cuts allocate no managed strings`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const managed = text => {
          const value = platform.heap.string(text);
          platform.heap.pins.push(value);
          return value;
        };
        const first = managed('é'.repeat(8192) + '\uD801\uDC28');
        const prefix = managed('É'.repeat(8192) + '\uD801');
        const second = managed('\uD801\uDC28' + 'é'.repeat(8192));
        const suffix = managed('\uDC28' + 'É'.repeat(8192));
        const starts = contract('StartsWith');
        const ends = contract('EndsWith');
        const allocations = platform.heap.stats.allocations;
        assert.equal(Boolean(platform.invoke(starts, [first, prefix, 5])), true);
        assert.equal(Boolean(platform.invoke(ends, [second, suffix, 5])), true);
        assert.equal(Boolean(platform.invoke(starts, [first, prefix, 4])), false);
        assert.equal(Boolean(platform.invoke(ends, [second, suffix, 4])), false);
        assert.equal(platform.heap.stats.allocations, allocations);
      });
    } finally {vm.stop();}
  });

  test(`String affixes ${engine}: released one-argument contracts keep their existing behavior`, () => {
    const vm = create(compile('Console.WriteLine("AbCdef".StartsWith("AbC"));' +
      'Console.WriteLine("AbCdef".StartsWith("abc"));Console.WriteLine("abcDeF".EndsWith("DeF"));' +
      'Console.WriteLine("abcDeF".EndsWith("def"));Console.WriteLine("".StartsWith(""));Console.WriteLine("".EndsWith(""));'));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, 'True\nFalse\nTrue\nFalse\nTrue\nTrue\n');
    } finally {vm.stop();}
  });
}

test('String affixes: independent CIL matches every native ordinal/fault row and explicit culture guard', () => {
  const assemblies = new Map();
  for (const row of reference.rows) {
    const key = row.method + row.sameReference;
    if (!assemblies.has(key)) assemblies.set(key, affixComparisonAssembly(row.method, row.sameReference));
    const vm = new CilVirtualMachine(assemblies.get(key), {arguments: affixArguments(row)});
    try {
      const result = vm.run();
      assert.equal(result.state, affixExpectedFault(row) ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (affixExpectedFault(row)) assertFault(result.fault, row);
      else assert.equal(result.returnValue, row.result, row.id);
    } finally {vm.stop();}
  }
});

test('String affixes: contracts append after Compare without moving released slots', () => {
  assert.equal(contract('StartsWith').id, 524302);
  assert.equal(contract('EndsWith').id, 524303);
  assert.equal(findContracts('System.String', 'Compare', true).find(row => row.parameters.length === 3).id, 524301);
  assert.equal(findContracts('System.String', 'Equals', false).find(row => row.parameters.length === 2).id, 524300);
  assert.equal(findContracts('System.String', 'CompareOrdinal', true).find(row => row.parameters.length === 5).id, 524298);
  assert.equal(findContracts('System.String', 'StartsWith', false).find(row => row.parameters.length === 1).id, 1262);
  assert.equal(findContracts('System.String', 'EndsWith', false).find(row => row.parameters.length === 1).id, 1263);
});

test('String affixes: unchanged native capture pins null priority, invalid shortcuts and surrogate boundaries', () => {
  const source = readFileSync(new URL('string-affix-comparison/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.rows.length, 264);
  const row = id => reference.rows.find(value => value.id === id);
  for (const method of ['StartsWith', 'EndsWith']) {
    assert.equal(row(`precedence/nulls/6/${method}`).fault, 'NullReferenceException');
    assert.equal(row(`precedence/null-value/6/${method}`).fault, 'ArgumentNullException');
    assert.equal(row(`precedence/null-value/6/${method}`).parameter, 'value');
    assert.equal(row(`precedence/empty-value/6/${method}`).parameter, 'comparisonType');
    assert.equal(row(`precedence/identity/0/${method}`).result, true);
  }
  for (const length of [7, 15, 31]) {
    assert.equal(row(`ordinal/prefix-split-${length}/5/StartsWith`).result, true);
    assert.equal(row(`ordinal/suffix-split-${length}/5/EndsWith`).result, true);
  }
});
