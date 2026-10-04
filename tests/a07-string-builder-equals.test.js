import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {supportedIntrinsic} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderType, builderContract, units} from './fixtures/string-builder/append-char.js';
import {equalsParameters, createEqualityBuilder, builderEqualsSource, builderEqualsAssembly} from './fixtures/string-builder/equals.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('string-builder-equals-net10.json', directory), 'utf8'));
const supported = reference.rows.filter(row => !row.nativeOnly);
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
const programs = new Map();

function compile(source, pipeline = 'bound') {
  const key = pipeline + source;
  if (!programs.has(key)) {
    const program = compileToIL('using System;using System.Text;' + source, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    programs.set(key, program);
  }
  return programs.get(key);
}

function content(platform, value) {
  return value === null ? null : units(platform.native(platform.invoke(builderContract('ToString'), [value])));
}

function metadata(platform, value) {
  return value === null ? null : ['$data', '$length', '$count', '$capacity', '$version'].map(key => platform.get(value, key));
}

function withPair(create, row, action) {
  const vm = create(compile('Console.WriteLine(0);'));
  const platform = vm.platform;
  try {
    platform.heap.withRoots([], () => {
      const first = createEqualityBuilder(platform, row.first);
      const second = row.self ? first : createEqualityBuilder(platform, row.second);
      action({vm, platform, first, second});
    });
    assert.equal(platform.heap.pins.length, 0);
  } finally {vm.stop();}
}

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`StringBuilder.Equals ${pipeline}/${engine}: native content and capacity-independent equality`, () => {
      const rows = supported.filter(row => !row.fault);
      const vm = create(compile(rows.map(builderEqualsSource).join('\n'), pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, rows.map(row => row.result ? 'True' : 'False').join('\n') + '\n');
      } finally {vm.stop();}
    });

    test(`StringBuilder.Equals ${pipeline}/${engine}: null receiver faults before null or identity shortcuts`, () => {
      for (const row of supported.filter(row => row.fault)) {
        const vm = create(compile(builderEqualsSource(row), pipeline));
        try {
          const result = vm.run();
          assert.equal(result.state, 'faulted', row.id);
          assert.equal(result.fault?.name, row.fault, row.id);
        } finally {vm.stop();}
      }
    });

    test(`StringBuilder.Equals ${pipeline}/${engine}: typed content equality does not become reference equality`, () => {
      const vm = create(compile('var first = new StringBuilder("same"); var second = new StringBuilder("same");' +
        'Console.WriteLine(first.Equals(second));Console.WriteLine(Object.ReferenceEquals(first, second));' +
        'Console.WriteLine(Object.ReferenceEquals(first, first));', pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\nFalse\nTrue\n');
      } finally {vm.stop();}
    });
  }

  test(`StringBuilder.Equals ${engine}: native supported rows neither allocate nor mutate either builder`, () => {
    for (const row of supported) withPair(create, row, ({vm, platform, first, second}) => {
      const descriptor = builderContract('Equals', equalsParameters);
      const before = [metadata(platform, first), metadata(platform, second)];
      const stats = [platform.heap.stats.allocations, platform.heap.stats.allocatedBytes, platform.heap.mutationRevision];
      const budget = platform.heap.maxBytes;
      let writes = 0;
      vm.onWrite = () => {writes++;};
      try {
        platform.heap.maxBytes = 1;
        const invoke = () => platform.invoke(descriptor, [first, second]);
        if (row.fault) assert.throws(invoke, {name: row.fault}, row.id);
        else assert.equal(invoke(), row.result, row.id);
        assert.equal(writes, 0);
        assert.deepEqual([platform.heap.stats.allocations, platform.heap.stats.allocatedBytes, platform.heap.mutationRevision], stats);
        assert.deepEqual([metadata(platform, first), metadata(platform, second)], before);
      } finally {platform.heap.maxBytes = budget; vm.onWrite = null;}
      assert.deepEqual(content(platform, first), row.afterFirst?.text ?? null, row.id);
      assert.deepEqual(content(platform, second), row.afterSecond?.text ?? null, row.id);
      platform.heap.collect();
      if (!row.fault) assert.equal(platform.invoke(descriptor, [first, second]), row.result, row.id);
    });
  });

  test(`StringBuilder.Equals ${engine}: matching chunks are read once and remain rooted during forced collection`, () => {
    const plan = segments => ({segments: segments.map(units), capacity: 1, maxCapacity: null, clearFirst: false, length: null});
    const row = {first: plan(Array(64).fill('a\ud801\udc28z')), second: plan(Array(16).fill('a\ud801\udc28z'.repeat(4)))};
    withPair(create, row, ({platform, first, second}) => {
      const records = [first, second].flatMap(value => {
        const data = platform.heap.get(platform.get(value, '$data')).data;
        return data.slice(0, platform.get(value, '$count')).map(item => platform.heap.get(item));
      });
      const texts = records.map(record => record.data);
      const reads = new Uint32Array(records.length);
      try {
        records.forEach((record, index) => Object.defineProperty(record, 'data', {configurable: true, get() {
          reads[index]++;
          platform.heap.collect();
          return texts[index];
        }}));
        assert.equal(platform.invoke(builderContract('Equals', equalsParameters), [first, second]), true);
        assert.deepEqual([...reads], Array(records.length).fill(1));
      } finally {
        records.forEach((record, index) => Object.defineProperty(record, 'data', {
          configurable: true, enumerable: true, writable: true, value: texts[index]
        }));
      }
    });
  });

  test(`StringBuilder.Equals ${engine}: snapshots and later writes do not cache equality`, () => {
    const row = reference.rows.find(value => value.id === 'same-different-segments');
    withPair(create, row, ({platform, first, second}) => {
      const equals = builderContract('Equals', equalsParameters);
      assert.equal(platform.invoke(equals, [first, second]), true);
      const snapshot = platform.heap.snapshot();
      platform.invoke(builderContract('set_Chars', ['int', 'char']), [second, 2, 88]);
      assert.equal(platform.invoke(equals, [first, second]), false);
      platform.heap.restore(snapshot);
      assert.equal(platform.invoke(equals, [first, second]), true);
      platform.invoke(builderContract('Clear'), [second]);
      assert.equal(platform.invoke(equals, [first, second]), false);
    });
  });
}

test('StringBuilder.Equals independent CIL: supported constructors, raw units, self and null references', () => {
  for (const row of supported) {
    const vm = new CilVirtualMachine(builderEqualsAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) assert.equal(result.fault?.name, row.fault);
      else assert.equal(Boolean(result.returnValue), row.result, row.id);
      assert.deepEqual(content(vm.platform, vm.statics.get(0x04000001)), row.afterFirst?.text ?? null, row.id);
      assert.deepEqual(content(vm.platform, vm.statics.get(0x04000002)), row.afterSecond?.text ?? null, row.id);
    } finally {vm.stop();}
  }
});

test('StringBuilder.Equals registers only the typed overload after330 without changing existing signatures', () => {
  assert.equal(builderContract('Equals', equalsParameters).id, 524331);
  assert.equal(builderContract('Append', ['float']).id, 524330);
  assert.equal(builderContract('Append', ['uint']).id, 524328);
  assert.equal(builderContract('Append', [builderType]).id, 524323);
  assert.deepEqual(findContracts(builderType, 'Equals').map(row => row.parameters), [equalsParameters]);
  assert.equal(findContracts(builderType, 'GetHashCode').length, 0);
  assert.equal(supportedIntrinsic({kind: 'method', owner: 'System.Object', name: 'Equals',
    signature: {parameters: ['object'], returnType: 'bool', isStatic: false}}), false,
  'The existing Object.Equals execution guard must not resolve to typed builder content equality');
});

test('StringBuilder.Equals native evidence pins capacity independence while leaving unsupported constructors explicit', () => {
  const source = readFileSync(new URL('string-builder-equals/Program.cs', directory));
  assert.equal(reference.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(reference.sdk, '10.0.201');
  assert.equal(reference.runtime, '10.0.5');
  assert.equal(reference.rows.length, 35);
  assert.equal(supported.length, 31);
  assert.equal(findContracts(builderType, '.ctor').some(row => row.parameters.join(',') === 'int,int'), false);
  for (const row of reference.rows) {
    assert.deepEqual(row.beforeFirst, row.afterFirst, row.id);
    assert.deepEqual(row.beforeSecond, row.afterSecond, row.id);
    if (!row.fault) assert.equal(row.objectResult, row.self, row.id);
  }
  for (const id of ['same-capacity-different', 'different-max-capacity', 'different-all-capacities', 'empty-max-capacity']) {
    const row = reference.rows.find(value => value.id === id);
    assert.equal(row.result, true, id);
    assert(row.beforeFirst.capacity !== row.beforeSecond.capacity || row.beforeFirst.maxCapacity !== row.beforeSecond.maxCapacity, id);
  }
  assert.equal(reference.rows.find(row => row.id === 'max-capacity-different-text').result, false);
  const segmented = reference.rows.find(row => row.id === 'many-segments');
  assert.notEqual(segmented.beforeFirst.chunks, segmented.beforeSecond.chunks);
  assert.equal(segmented.result, true);
});
