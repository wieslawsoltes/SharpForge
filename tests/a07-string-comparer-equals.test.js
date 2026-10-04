import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts, frameworkType} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {comparerType, equalsParameters, fromUnits, getterName, comparerEqualsSource,
  comparerEqualsAssembly} from './fixtures/comparers/string-comparer-equals.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-comparer-equals-net10.json', directory), 'utf8'));
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
const programs = new Map();

function compile(source, pipeline = 'bound') {
  const key = pipeline + source;
  if (!programs.has(key)) {
    const program = compileToIL('using System;' + source, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    programs.set(key, program);
  }
  return programs.get(key);
}

function contract(name, parameters = [], owner = comparerType) {
  const descriptor = findContracts(owner, name).find(row => row.parameters.join(',') === parameters.join(','));
  assert(descriptor, `Missing ${owner}.${name}(${parameters.join(',')})`);
  return descriptor;
}

function receiver(platform, row) {
  if (row.nullReceiver) return null;
  return row.factory ? platform.invoke(contract('FromComparison', ['System.StringComparison']), [row.mode])
    : platform.invoke(contract('get_' + getterName(row.mode)), []);
}

function pin(platform, value) {
  const reference = platform.managed(value, 'string');
  platform.heap.pins.push(reference);
  return reference;
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`StringComparer.Equals ${pipeline}/${engine}: native nullable and Unicode results through getters/factory`, () => {
      const rows = reference.rows.filter(row => row.fault === null);
      const vm = create(compile(rows.map(comparerEqualsSource).join('\n'), pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, rows.map(row => row.result ? 'True' : 'False').join('\n') + '\n');
      } finally {vm.stop();}
    });

    test(`StringComparer.Equals ${pipeline}/${engine}: null receiver precedes all equality shortcuts`, () => {
      for (const row of reference.rows.filter(row => row.fault !== null)) {
        const vm = create(compile(comparerEqualsSource(row), pipeline));
        try {
          const result = vm.run();
          assert.equal(result.state, 'faulted', row.id);
          assert.equal(result.fault?.name, row.fault, row.id);
        } finally {vm.stop();}
      }
    });

    test(`StringComparer.Equals ${pipeline}/${engine}: two-string overload retains Compare and reference controls`, () => {
      const source = 'var comparer = StringComparer.OrdinalIgnoreCase;' +
        'Console.WriteLine(comparer.Equals("a", "A"));Console.WriteLine(comparer.Compare("a", "A") == 0);' +
        'Console.WriteLine(Object.ReferenceEquals(comparer, StringComparer.FromComparison(StringComparison.OrdinalIgnoreCase)));' +
        'Console.WriteLine(Object.ReferenceEquals(comparer, StringComparer.Ordinal));' +
        'Console.WriteLine(string.Equals("a", "A", StringComparison.OrdinalIgnoreCase));' +
        'Console.WriteLine(string.Equals("a", "A", StringComparison.Ordinal));';
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\nTrue\nTrue\nFalse\nTrue\nFalse\n');
      } finally {vm.stop();}
    });
  }

  test(`StringComparer.Equals ${engine}: pinned native matrix survives collection with no managed allocation`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const calls = reference.rows.map(row => {
          const comparer = receiver(platform, row);
          const first = pin(platform, fromUnits(row.first));
          const second = row.sameReference ? first : pin(platform, fromUnits(row.second));
          if (row.copyValue) assert.notEqual(first.h, second.h, row.id);
          return [comparer, first, second];
        });
        const equals = contract('Equals', equalsParameters);
        const compare = contract('Compare', equalsParameters);
        const allocations = platform.heap.stats.allocations;
        const bytes = platform.heap.stats.allocatedBytes;
        const revision = platform.heap.mutationRevision;
        const check = () => {
          for (const [index, row] of reference.rows.entries()) {
            if (row.fault) assert.throws(() => platform.invoke(equals, calls[index]), {name: row.fault});
            else {
              assert.equal(platform.invoke(equals, calls[index]), row.result, row.id);
              assert.equal(Math.sign(platform.invoke(compare, calls[index])), row.compareSign, row.id);
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

  test(`StringComparer.Equals ${engine}: unsupported comparer records cannot pass null/identity shortcuts`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const platform = vm.platform;
    try {
      platform.heap.withRoots([], () => {
        const comparer = platform.make(comparerType, {'$comparison': 'unsupported'});
        platform.heap.pins.push(comparer);
        const descriptor = contract('Equals', equalsParameters);
        assert.throws(() => platform.invoke(descriptor, [comparer, null, null]), {name: 'NotSupportedException'});
        const shared = pin(platform, 'same');
        assert.throws(() => platform.invoke(descriptor, [comparer, shared, shared]), {name: 'NotSupportedException'});
      });
    } finally {vm.stop();}
  });
}

test('StringComparer.Equals independent CIL: exact two-string call retains native results and null faults', () => {
  const assemblies = new Map();
  for (const row of reference.rows) {
    const key = [row.mode, row.factory, row.sameReference, row.nullReceiver].join('/');
    if (!assemblies.has(key)) assemblies.set(key, comparerEqualsAssembly(row));
    const vm = new CilVirtualMachine(assemblies.get(key), {arguments: [fromUnits(row.first), fromUnits(row.second)]});
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) assert.equal(result.fault?.name, row.fault);
      else assert.equal(Boolean(result.returnValue), row.result, row.id);
    } finally {vm.stop();}
  }
});

test('StringComparer.Equals appends one two-string contract at329 without equality interface or hash expansion', () => {
  assert.equal(contract('Equals', equalsParameters).id, 524329);
  assert.equal(contract('FromComparison', ['System.StringComparison']).id, 524322);
  assert.equal(contract('get_Ordinal').id, 524292);
  assert.equal(contract('get_OrdinalIgnoreCase').id, 524297);
  assert.equal(contract('Compare', equalsParameters).id, 524293);
  assert.equal(contract('Append', ['uint'], 'System.Text.StringBuilder').id, 524328);
  assert.deepEqual(findContracts(comparerType, 'Equals').map(row => row.parameters), [equalsParameters]);
  assert.equal(findContracts(comparerType, 'GetHashCode').length, 0);
  assert.deepEqual(frameworkType(comparerType).interfaces, ['System.Collections.Generic.IComparer`1<string>', 'System.Collections.IComparer']);
});

test('StringComparer.Equals native evidence freezes actual identity and Compare agreement', () => {
  const source = readFileSync(new URL('string-comparer-equals/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.rows.length, 172);
  for (const row of reference.rows) {
    if (row.nullReceiver) assert.equal(row.fault, 'NullReferenceException');
    else {
      assert.equal(row.fault, null);
      assert.equal(row.result, row.compareSign === 0, row.id);
    }
    if (row.copyValue) assert.equal(row.identity, false);
    if (row.sameReference) assert.equal(row.identity, true);
  }
  const result = id => reference.rows.find(row => row.id === id)?.result;
  assert.equal(result('sharp-s-expansion/5/getter'), false);
  assert.equal(result('long-s/5/getter'), false);
  assert.equal(result('deseret/5/factory'), true);
  assert.equal(result('garay/5/factory'), false);
  assert.equal(result('normalization/5/getter'), false);
});
