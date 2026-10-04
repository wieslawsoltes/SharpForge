import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {writerPlatform, writerContract} from './fixtures/text-writer/engines.js';
import {units, fromUnits, stringWriterAssembly, stringWriterSource} from './fixtures/text-writer/string-line.js';

const directory = new URL('../packages/bcl-io/reference/', import.meta.url);
const native = JSON.parse(readFileSync(new URL('string-writer-string-line-net10.json', directory), 'utf8'));

for (const engine of ['source', 'cil']) {
  test(`StringWriter string line ${engine}: captured ordinary null/empty/disposal precedence is preserved`, () => {
    for (const row of native.rows) {
      const writer = writerPlatform(engine);
      const {platform, reference, call} = writer;
      const absent = row.receiverState === 'null';
      try {
        if (!absent) {
          call('Write', ['string'], ['seed|']);
          if (row.setNewLine) call('set_NewLine', ['string'], [fromUnits(row.requestedNewLine)]);
          if (row.receiverState === 'disposed') call('Dispose');
        }
        const value = row.value === null ? null : platform.heap.string(fromUnits(row.value));
        const invoke = () => platform.invoke(writerContract(row.operation, ['string']), [absent ? null : reference, value]);
        if (row.fault) assert.throws(invoke, {name: row.fault}, row.id);
        else assert.equal(invoke(), null, row.id);
        assert.deepEqual(absent ? null : units(platform.native(call('ToString'))), row.output, row.id);
        assert.deepEqual(absent ? null : units(platform.native(call('get_NewLine'))), row.actualNewLine, row.id);
        assert.equal(platform.heap.pins.length, 0);
      } finally { writer.stop(); }
    }
  });

  test(`StringWriter string line ${engine}: captured value/newline callbacks preserve progress and roots`, () => {
    for (const row of native.transitions) {
      const writer = writerPlatform(engine);
      const {platform, vm, reference, call} = writer;
      const {heap} = platform;
      call('Write', ['string'], ['seed|']);
      call('set_NewLine', ['string'], [fromUnits(row.requestedNewLine)]);
      if (row.receiverState === 'disposed') call('Dispose');
      const builder = call('GetStringBuilder');
      const value = row.value === null ? null : heap.string(fromUnits(row.value));
      const failure = new Error('String-line callback failed');
      failure.name = 'InvalidOperationException';
      let armed = true;
      let completed = 0;
      try {
        vm.onWrite = event => {
          if (event.handle === builder.h && event.property === '$capacity') {
            completed++;
            if (armed) {
              armed = false;
              if (row.mode === 'newline') call('set_NewLine', ['string'], [heap.string(fromUnits(row.changedNewLine))]);
              else if (row.mode === 'dispose') call('Dispose');
              else throw failure;
            }
          }
          heap.collect();
        };
        const invoke = () => platform.invoke(writerContract('WriteLine', ['string']), [reference, value]);
        if (row.fault) {
          assert.throws(invoke, row.mode === 'throw' && row.receiverState === 'open' ? error => error === failure : {name: row.fault}, row.id);
        } else assert.equal(invoke(), null, row.id);
        assert.equal(armed, row.armed, row.id);
        assert.equal(completed, row.events.filter(event => event.kind === 'write-complete').length, row.id);
        assert.equal(row.parameterlessLineCalls, 0, 'The native string overload does not call parameterless WriteLine');
        assert.equal(platform.get(reference, '$disposed'), row.disposed, row.id);
        assert.deepEqual(units(platform.native(call('ToString'))), row.output, row.id);
        assert.deepEqual(units(platform.native(call('get_NewLine'))), row.actualNewLine, row.id);
        assert.equal(heap.pins.length, 0, row.id);
      } finally { vm.onWrite = null; writer.stop(); }
    }
  });

  test(`StringWriter string line ${engine}: disposal after text also prevents an empty newline`, () => {
    const writer = writerPlatform(engine);
    const {platform, vm, call} = writer;
    call('Write', ['string'], ['seed|']);
    call('set_NewLine', ['string'], ['']);
    const builder = call('GetStringBuilder');
    let armed = true;
    try {
      vm.onWrite = event => {
        if (armed && event.handle === builder.h && event.property === '$capacity') {
          armed = false;
          call('Dispose');
        }
        platform.heap.collect();
      };
      assert.throws(() => call('WriteLine', ['string'], [platform.heap.string('payload')]), {name: 'ObjectDisposedException'});
      assert.equal(armed, false);
      assert.equal(platform.native(call('ToString')), 'seed|payload');
      assert.equal(platform.native(call('get_NewLine')), '');
      assert.equal(platform.heap.pins.length, 0);
    } finally { vm.onWrite = null; writer.stop(); }
  });
}

test('StringWriter string line CIL: independent concrete/base string calls match every native ordinary row', () => {
  for (const row of native.rows) {
    const vm = new CilVirtualMachine(stringWriterAssembly(row));
    try {
      const result = vm.run();
      assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
      assert.equal(result.fault?.name ?? null, row.fault, row.id);
      const reference = vm.statics.get(0x04000001);
      const call = name => vm.platform.native(vm.platform.invoke(writerContract(name), [reference]));
      assert.deepEqual(reference === null ? null : units(call('ToString')), row.output, row.id);
      assert.deepEqual(reference === null ? null : units(call('get_NewLine')), row.actualNewLine, row.id);
      assert.equal(vm.heap.pins.length, 0);
    } finally { vm.stop(); }
  }
});

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringWriter string line ${pipeline}/${engine}: compiled string overloads preserve captured null/disposal behavior`, () => {
      const selected = [];
      for (const [index, valueCase] of ['null', 'empty', 'payload', 'utf16'].entries()) {
        for (const [stateIndex, receiverState] of ['open', 'disposed', 'null'].entries()) {
          selected.push(native.rows.find(row => row.operation === 'WriteLine' && row.valueCase === valueCase &&
            row.receiverState === receiverState && row.baseView === ((index + stateIndex) % 2 === 0) && row.setNewLine &&
            fromUnits(row.requestedNewLine) === (receiverState === 'disposed' ? '' : '~')));
        }
      }
      assert(selected.every(Boolean));
      const {source, expected} = stringWriterSource(selected);
      const program = compileToIL(source, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, expected);
      } finally { vm.stop(); }
    });
  }
}

test('StringWriter string line correction preserves contracts and pins separate native capture provenance', () => {
  assert.equal(writerContract('Write', ['string']).id, 655371);
  assert.equal(writerContract('WriteLine', ['string']).id, 655373);
  assert.equal(writerContract('WriteLine', ['decimal']).id, 655403);
  assert.equal(native.rows.length, 144);
  assert.equal(native.transitions.length, 36);
  assert(native.transitions.every(row => row.nativeOnly === true));
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  const source = readFileSync(new URL('string-writer-string-line/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
  assert.equal(createHash('sha256').update(readFileSync(new URL('string-writer-string-line-net10.json', directory))).digest('hex'),
    '61bb501df12b86a5682ccd3aeeaaba497dfde74745231bcc293e99395129b05e');
  assert.equal(createHash('sha256').update(readFileSync(new URL('string-writer-scalars/Program.cs', directory))).digest('hex'),
    '2a9b8bcb46891606d84ba65655942516ba2cb3584c9de1dead9c7c922cc9f013');
  assert.equal(createHash('sha256').update(readFileSync(new URL('string-writer-scalars-net10.json', directory))).digest('hex'),
    'ca02ecd8569682d18180e0b1c51f4efb09f861a09dc355accd4310dffeb2d21e');
});
