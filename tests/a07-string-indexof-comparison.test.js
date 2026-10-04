import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {indexOfParameters, indexOfArguments, indexOfExpression, indexOfComparisonAssembly,
  indexOfExpectedFault} from './fixtures/comparers/string-indexof-comparison.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-indexof-comparison-net10.json', directory), 'utf8'));
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

function contract(name = 'IndexOf', parameters = indexOfParameters) {
  const descriptor = findContracts('System.String', name, false)
    .find(row => row.parameters.join(',') === parameters.join(','));
  assert(descriptor, `Missing String.${name}(${parameters.join(',')})`);
  return descriptor;
}

function assertFault(fault, row) {
  const expected = indexOfExpectedFault(row);
  assert.equal(fault?.name, expected, row.id);
  if (expected === 'NotSupportedException') assert.match(fault.message, /Ordinal.*OrdinalIgnoreCase/, row.id);
  else if (row.parameter) assert(fault.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + fault.message);
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`String.IndexOf comparison ${pipeline}/${engine}: all native first-match UTF-16 offsets`, () => {
      const source = successful.map(row => `Console.WriteLine(${indexOfExpression(row)});`).join('\n');
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, successful.map(row => row.result).join('\n') + '\n');
      } finally {vm.stop();}
    });

    test(`String.IndexOf comparison ${pipeline}/${engine}: enum and int overloads with equal arity stay distinct`, () => {
      const source = 'StringComparison mode = StringComparison.OrdinalIgnoreCase; int start = 2;' +
        'Console.WriteLine("aBaB".IndexOf("b", mode));Console.WriteLine("aBaB".IndexOf("B", start));' +
        'mode = StringComparison.Ordinal;Console.WriteLine("aBaB".IndexOf("b", mode));' +
        'Console.WriteLine("aBaB".IndexOf("B", 1));Console.WriteLine("aBaB".IndexOf("B", 4));' +
        'Console.WriteLine("aBaB".IndexOf("", 4));Console.WriteLine("aBaB".IndexOf("B"));';
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '1\n3\n-1\n1\n-1\n4\n1\n');
      } finally {vm.stop();}
    });
  }

  test(`String.IndexOf comparison ${engine}: compiled calls keep receiver/value/mode and empty priority`, () => {
    const cases = ['nulls/6', 'null-value/6', 'empty-receiver-null-value/6', 'identity/6',
      'empty-value/2147483647', 'empty-both/-1', 'identity/0', 'null-value/0', 'null-receiver/0'];
    for (const name of cases) {
      const row = reference.rows.find(value => value.id === `precedence/${name}`);
      assert(row, name);
      const vm = create(compile(`Console.WriteLine(${indexOfExpression(row)});`));
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted', row.id + ': ' + result.output);
        assertFault(result.fault, row);
      } finally {vm.stop();}
    }
  });

  test(`String.IndexOf comparison ${engine}: all native results retain Contains behavior before and after collection`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const args = reference.rows.map(row => {
          const values = indexOfArguments(row);
          const receiver = platform.managed(values[0], 'string');
          platform.heap.pins.push(receiver);
          const value = row.sameReference ? receiver : platform.managed(values[1], 'string');
          platform.heap.pins.push(value);
          if (row.copyValue) assert.notEqual(receiver.h, value.h, row.id);
          return [receiver, value, values[2]];
        });
        const descriptor = contract();
        const contains = contract('Contains');
        const allocations = platform.heap.stats.allocations;
        const bytes = platform.heap.stats.allocatedBytes;
        const revision = platform.heap.mutationRevision;
        const check = () => {
          for (let index = 0; index < reference.rows.length; index++) {
            const row = reference.rows[index];
            const invoke = () => platform.invoke(descriptor, args[index]);
            const invokeContains = () => platform.invoke(contains, args[index]);
            if (indexOfExpectedFault(row)) {
              assert.throws(invoke, fault => {assertFault(fault, row); return true;});
              assert.throws(invokeContains, fault => {assertFault(fault, row); return true;});
            } else {
              assert.equal(invoke(), row.result, row.id);
              assert.equal(Boolean(invokeContains()), row.contains, row.id);
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

  test(`String.IndexOf comparison ${engine}: repeated-prefix misses and late hits keep exact unit offsets`, () => {
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
          return [[managed(text), managed(value), -1], [managed(text + 'b'), managed(value), 961]];
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

  test(`String.IndexOf comparison ${engine}: released int overload retains out-of-range faults`, () => {
    for (const start of [-1, 5]) {
      const vm = create(compile(`Console.WriteLine("aBaB".IndexOf("B", ${start}));`));
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted', result.output);
        assert.equal(result.fault?.name, 'ArgumentOutOfRangeException');
      } finally {vm.stop();}
    }
  });
}

test('String.IndexOf comparison: independent CIL preserves every native offset, fault and culture guard', () => {
  const assemblies = [indexOfComparisonAssembly(false), indexOfComparisonAssembly(true)];
  for (const row of reference.rows) {
    const vm = new CilVirtualMachine(assemblies[Number(row.sameReference)], {arguments: indexOfArguments(row)});
    try {
      const result = vm.run();
      assert.equal(result.state, indexOfExpectedFault(row) ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (indexOfExpectedFault(row)) assertFault(result.fault, row);
      else assert.equal(result.returnValue, row.result, row.id);
    } finally {vm.stop();}
  }
});

test('String.IndexOf comparison: independent CIL binds the released same-arity int signature', () => {
  const vm = new CilVirtualMachine(indexOfComparisonAssembly(false, ['string', 'int']), {arguments: ['aBaB', 'B', 2]});
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, 3);
  } finally {vm.stop();}
});

test('String.IndexOf comparison:306 appends after Contains and retains released IndexOf ABI', () => {
  assert.equal(contract().id, 524306);
  assert.equal(contract('Contains').id, 524305);
  assert.equal(contract('IndexOf', ['string']).id, 1259);
  assert.equal(contract('IndexOf', ['string', 'int']).id, 1260);
  assert.equal(findContracts('System.String', 'Compare', true).find(row => row.parameters.length === 6).id, 524304);
});

test('String.IndexOf comparison: pinned native capture retains offset and exception-priority evidence', () => {
  const source = readFileSync(new URL('string-indexof-comparison/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.rows.length, 218);
  const row = id => reference.rows.find(value => value.id === id);
  assert.equal(row('precedence/nulls/6').fault, 'NullReferenceException');
  assert.equal(row('precedence/null-value/6').parameter, 'value');
  assert.equal(row('precedence/empty-value/6').parameter, 'comparisonType');
  assert.equal(row('ordinal/supplementary-prefix-offset/4').result, 4);
  assert.equal(row('ordinal/first-folded-before-exact/5').result, 0);
  assert.equal(row('ordinal/low-half-first/5').result, 1);
  assert.equal(row('precedence/empty-both/0').result, 0);
  for (const value of reference.rows) {
    if (value.fault === null) assert.equal(value.contains, value.result >= 0, value.id);
  }
});
