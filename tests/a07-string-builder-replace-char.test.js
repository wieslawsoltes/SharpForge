import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {builderType, builderContract, builderPlatform, units} from './fixtures/string-builder/append-char.js';
import {createEditBuilder, replaceParameters, replaceArguments, builderReplaceSource,
  builderReplaceAssembly} from './fixtures/string-builder/replace-char.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-builder-replace-char-net10.json', directory), 'utf8'));
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
const programs = new Map();
function compile(source, pipeline) {
  const key = pipeline + source;
  if (!programs.has(key)) {
    const program = compileToIL('using System;using System.Text;' + source, {pipeline});
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    programs.set(key, program);
  }
  return programs.get(key);
}
function fault(error, row) {
  assert.equal(error.name, row.fault, row.id);
  if (row.parameter) assert(error.message.includes("(Parameter '" + row.parameter + "')"), row.id + ': ' + error.message);
  return true;
}
function content(platform, reference) {
  return reference === null ? null : units(platform.native(platform.invoke(builderContract('ToString'), [reference])));
}
function withBuilder(engine, segments, action) {
  const runner = builderPlatform(engine, '');
  try {
    runner.platform.heap.withRoots([], () => action({...runner, reference: createEditBuilder(runner.platform, segments)}));
    assert.equal(runner.platform.heap.pins.length, 0);
  } finally {runner.stop();}
}
const state = (platform, reference) => ['$data', '$count', '$length', '$capacity'].map(key => platform.get(reference, key));
const replace = (platform, reference, args) => platform.invoke(builderContract('Replace',
  args.length === 2 ? ['char', 'char'] : ['char', 'char', 'int', 'int']), [reference, ...args]);

for (const [engine, create] of Object.entries(engines)) {
  for (const pipeline of ['bound', 'legacy']) {
    test(`StringBuilder.Replace char ${pipeline}/${engine}: literal dollar replacements and released string replacement remain distinct`, () => {
      const source = 'var builder = new StringBuilder("a.a"); builder.Replace((char)97, (char)36);' +
        'Console.WriteLine(string.Equals(builder.ToString(), "$.$"));' +
        'builder.Replace("$", "x"); Console.WriteLine(builder.ToString());';
      const vm = create(compile(source, pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\nx.x\n');
      } finally {vm.stop();}
    });
    test(`StringBuilder.Replace char ${pipeline}/${engine}: native successful text and fluent identity`, () => {
      const rows = native.rows.filter(row => !row.fault);
      const vm = create(compile(rows.map(builderReplaceSource).join('\n'), pipeline));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'True\nTrue\n'.repeat(rows.length));
      } finally {vm.stop();}
    });
    test(`StringBuilder.Replace char ${pipeline}/${engine}: representative native fault order`, () => {
      for (const id of ['null-range-both-negative', 'flat-range-both-negative', 'flat-range-past-negative',
        'flat-range-negative-count', 'flat-range-too-long', 'empty-same-range-past-zero', 'flat-range-minimum-count']) {
        const row = native.rows.find(value => value.id === id);
        const vm = create(compile(builderReplaceSource(row), pipeline));
        try {
          const result = vm.run();
          assert.equal(result.state, 'faulted', id);
          fault(result.fault, row);
        } finally {vm.stop();}
      }
    });
  }
  test(`StringBuilder.Replace char ${engine}: every native row preserves length/capacity and exact range boundaries`, () => {
    for (const row of native.rows) withBuilder(engine, row.segments, ({platform, reference}) => {
      const before = reference === null ? null : state(platform, reference);
      const invoke = () => platform.invoke(builderContract('Replace', replaceParameters(row)), [reference, ...replaceArguments(row)]);
      if (row.fault) assert.throws(invoke, error => fault(error, row));
      else assert.deepEqual(invoke(), reference, row.id);
      assert.deepEqual(reference === null ? null : state(platform, reference), before, row.id);
      assert.deepEqual(content(platform, reference), row.after?.text ?? null, row.id);
    });
  });
  test(`StringBuilder.Replace char ${engine}: two changed chunks retain unrelated slots and survive observer GC`, () => {
    withBuilder(engine, ['aa', 'keep', 'aba', 'zz'].map(units), ({platform, vm, reference}) => {
      const {heap} = platform;
      const storage = platform.get(reference, '$data');
      const previous = [...heap.get(storage).data];
      const before = state(platform, reference);
      const version = platform.get(reference, '$version');
      const allocations = heap.stats.allocations;
      const events = [];
      vm.onWrite = event => {
        heap.collect();
        if (event.kind === 'array') {
          assert(heap.get({h: event.handle, g: event.generation}));
          events.push([event.index, platform.native(event.oldValue), platform.native(event.value)]);
        }
      };
      try {assert.deepEqual(replace(platform, reference, [97, 120]), reference);}
      finally {vm.onWrite = null;}
      assert.deepEqual(events, [[0, 'aa', 'xx'], [2, 'aba', 'xbx']]);
      assert.equal(heap.stats.allocations - allocations, 2);
      assert.deepEqual(state(platform, reference), before);
      assert.equal(platform.get(reference, '$version'), version + 1);
      for (const index of [1, 3]) assert.deepEqual(heap.get(storage).data[index], previous[index]);
      assert.deepEqual(content(platform, reference), units('xxkeepxbxzz'));
    });
  });
  test(`StringBuilder.Replace char ${engine}: no match, equal units and empty range require no managed allocation or writes`, () => {
    withBuilder(engine, ['aba', 'aba'].map(units), ({platform, vm, reference}) => {
      const {heap} = platform;
      const before = [state(platform, reference), platform.get(reference, '$version'), heap.stats.allocations, heap.mutationRevision];
      const budget = heap.maxBytes;
      let writes = 0;
      vm.onWrite = () => {writes++;};
      try {
        heap.maxBytes = 1;
        for (const args of [[97, 97], [113, 120], [97, 120, 6, 0]]) assert.deepEqual(replace(platform, reference, args), reference);
        assert.equal(writes, 0);
        assert.deepEqual([state(platform, reference), platform.get(reference, '$version'), heap.stats.allocations, heap.mutationRevision], before);
      } finally {heap.maxBytes = budget; vm.onWrite = null;}
    });
  });
  test(`StringBuilder.Replace char ${engine}: staging OOM changes no live slot and snapshots restore edits`, () => {
    withBuilder(engine, ['aaa', 'aaa'].map(units), ({platform, reference}) => {
      const {heap} = platform;
      const storage = platform.get(reference, '$data');
      const previous = [...heap.get(storage).data];
      const version = platform.get(reference, '$version');
      heap.collect();
      const budget = heap.maxBytes;
      heap.maxBytes = heap.stats.liveBytes + heap.get(previous[0]).size;
      try {assert.throws(() => replace(platform, reference, [97, 120]), {name: 'OutOfMemoryException'});}
      finally {heap.maxBytes = budget;}
      assert.deepEqual(heap.get(storage).data, previous);
      assert.equal(platform.get(reference, '$version'), version);
      const snapshot = heap.snapshot();
      replace(platform, reference, [97, 120, 2, 2]);
      assert.deepEqual(content(platform, reference), units('aaxxaa'));
      heap.restore(snapshot);
      assert.deepEqual(content(platform, reference), units('aaaaaa'));
    });
  });
  test(`StringBuilder.Replace char ${engine}: reentrant growth then Clear retains event roots without resurrecting chunks`, () => {
    withBuilder(engine, ['aa', 'aa', 'aa', 'aa'].map(units), ({platform, vm, reference}) => {
      const {heap} = platform;
      const initialStorage = platform.get(reference, '$data');
      let arrays = 0, entered = false;
      vm.onWrite = event => {
        if (event.kind !== 'array' || entered) return;
        entered = true;
        try {
          arrays++;
          if (arrays === 1) platform.invoke(builderContract('Append', ['string']), [reference, heap.string('tail')]);
          else {
            assert.notEqual(event.handle, initialStorage.h, 'second edit follows grown storage');
            platform.invoke(builderContract('Clear'), [reference]);
          }
          heap.collect();
          assert(heap.get({h: event.handle, g: event.generation}));
          assert.equal(platform.native(event.oldValue), 'aa');
          assert.equal(platform.native(event.value), 'xx');
        } finally {entered = false;}
      };
      try {replace(platform, reference, [97, 120]);}
      finally {vm.onWrite = null;}
      assert.equal(arrays, 2);
      assert.deepEqual(content(platform, reference), []);
      assert.equal(platform.get(reference, '$count'), 0);
    });
  });
  test(`StringBuilder.Replace char ${engine}: an observer edit to a future chunk takes precedence`, () => {
    withBuilder(engine, ['aa', 'aa', 'aa'].map(units), ({platform, vm, reference}) => {
      let armed = true;
      vm.onWrite = event => {
        if (!armed || event.kind !== 'array') return;
        armed = false;
        platform.invoke(builderContract('set_Chars', ['int', 'char']), [reference, 2, 122]);
        platform.heap.collect();
      };
      try {replace(platform, reference, [97, 120]);}
      finally {vm.onWrite = null;}
      assert.deepEqual(content(platform, reference), units('xxzaxx'));
    });
  });
  test(`StringBuilder.Replace char ${engine}: throwing observers release staging roots and stop later writes`, () => {
    withBuilder(engine, ['aa', 'aa'].map(units), ({platform, vm, reference}) => {
      const pins = platform.heap.pins.length;
      vm.onWrite = event => {
        if (event.kind === 'array') {
          platform.heap.collect();
          assert.equal(platform.native(event.oldValue), 'aa');
          assert.equal(platform.native(event.value), 'xx');
          throw new Error('observer stopped');
        }
      };
      try {assert.throws(() => replace(platform, reference, [97, 120]), /observer stopped/);}
      finally {vm.onWrite = null;}
      assert.equal(platform.heap.pins.length, pins);
      assert.deepEqual(content(platform, reference), units('xxaa'));
      replace(platform, reference, [97, 120]);
      assert.deepEqual(content(platform, reference), units('xxxx'));
    });
  });
  test(`StringBuilder.Replace char ${engine}: missing notification hook still records mutation`, () => {
    withBuilder(engine, ['aa', 'aa'].map(units), ({platform, vm, reference}) => {
      const before = platform.heap.mutationRevision;
      const notifyWrite = vm.notifyWrite;
      try {
        vm.notifyWrite = undefined;
        replace(platform, reference, [97, 120]);
      } finally {vm.notifyWrite = notifyWrite;}
      assert(platform.heap.mutationRevision > before);
      assert.deepEqual(content(platform, reference), units('xxxx'));
    });
  });
  test(`StringBuilder.Replace char ${engine}: deterministic ten-thousand-step whole/range trace matches a UTF-16 oracle`, () => {
    withBuilder(engine, ['a\0\ud800b\udc00', 'aa\uffffbb', 'abababab'].map(units), ({platform, reference}) => {
      let expected = content(platform, reference);
      let seed = 0x2638;
      const random = maximum => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed >>> 8) % maximum;
      };
      const alphabet = [0, 97, 98, 0xd800, 0xdc00, 0xffff];
      for (let step = 0; step < 10000; step++) {
        const oldUnit = alphabet[random(alphabet.length)], newUnit = alphabet[random(alphabet.length)];
        const start = random(expected.length + 1), count = random(expected.length - start + 1);
        const ranged = step % 2 === 0;
        replace(platform, reference, ranged ? [oldUnit, newUnit, start, count] : [oldUnit, newUnit]);
        expected = expected.map((unit, index) => unit === oldUnit && (!ranged || index >= start && index < start + count) ? newUnit : unit);
        assert.deepEqual(content(platform, reference), expected, 'step ' + step);
        if (step % 128 === 0) platform.heap.collect();
      }
    });
  });
}

test('StringBuilder.Replace char: independent CIL matches the complete native result/fault matrix', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(builderReplaceAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      if (row.fault) fault(result.fault, row);
      else assert.equal(Boolean(vm.statics.get(0x04000002)), true, row.id);
      assert.deepEqual(content(vm.platform, vm.statics.get(0x04000001)), row.after?.text ?? null, row.id);
    } finally {vm.stop();}
  }
});

test('StringBuilder.Replace char: frozen native provenance and appended signatures', () => {
  const source = readFileSync(new URL('string-builder-replace-char/Program.cs', directory));
  assert.equal(native.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(native.sourceSha256, '62398dd9a373494b5dcd608d3488d448514f894cc99e3d9871a4c6a61a573e64');
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.rows.length, 266);
  assert.equal(builderContract('Replace', ['char', 'char']).id, 524334);
  assert.equal(builderContract('Replace', ['char', 'char', 'int', 'int']).id, 524335);
  assert.equal(builderContract('Append', [builderType, 'int', 'int']).id, 524333);
  for (const row of native.rows) {
    if (row.before) {
      for (const key of ['length', 'capacity', 'maxCapacity', 'chunks']) assert.equal(row.after[key], row.before[key], row.id);
      if (row.fault) assert.deepEqual(row.after, row.before, row.id);
    }
  }
});
