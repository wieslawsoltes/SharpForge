import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {disassemble, frameworkBuiltin} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {registerIoModules} from '@sharpforge/bcl-io';
import {writerPlatform, writerContract} from './fixtures/text-writer/engines.js';
import {scalarTypes, scalarReferences, scalarCases, scalarWriterAssembly, capturedScalar} from './fixtures/text-writer/scalars.js';

const methods = ['Write', 'WriteLine'];
const expectedText = (rows, method, newLine = '~') =>
  'seed|' + rows.map(row => row.text + (method === 'WriteLine' ? newLine : '') + '|').join('');
const nativeDirectory = new URL('../packages/bcl-io/reference/', import.meta.url);
const nativeCapture = () => JSON.parse(readFileSync(new URL('string-writer-scalars-net10.json', nativeDirectory), 'utf8'));
const units = text => text.split('').map(unit => unit.charCodeAt(0));
const fromUnits = value => value === null ? null : String.fromCharCode(...value);

test('StringWriter scalars append sixteen exact IDs after all released IO contracts', () => {
  const ids = methods.flatMap(name => scalarTypes.map(type => writerContract(name, [type]).id));
  assert.deepEqual(ids, Array.from({length: 16}, (_, index) => 655388 + index));
  assert.equal(writerContract('Write', ['char']).id, 655370);
  assert.equal(writerContract('WriteLine', ['string']).id, 655373);
  assert.equal(writerContract('ToString').id, 655380);
  assert.equal(writerContract('WriteLine', ['char']).id, 655387);
  const entries = [];
  registerIoModules({
    define() {}, ctor() {}, prop() {},
    member(owner, name, parameters, result) { entries.push({owner, name, parameters, result}); }
  });
  assert.deepEqual(entries.slice(-16), methods.flatMap(name => scalarTypes.map(type =>
    ({owner: 'System.IO.TextWriter', name, parameters: [type], result: 'void'}))));
});

test('StringWriter scalar expected text retains existing core .NET capture provenance', () => {
  assert.deepEqual([...new Set(scalarCases.map(row => row.type))], scalarTypes);
  for (const {name, directory, capture} of scalarReferences) {
    assert.equal(capture.sdk, '10.0.201', name);
    assert.equal(capture.runtime, '10.0.5', name);
    if (capture.sourceSha256) {
      const source = readFileSync(new URL(name + '/Program.cs', directory));
      assert.equal(createHash('sha256').update(source).digest('hex'), capture.sourceSha256, name);
    }
  }
  assert(scalarCases.some(row => row.type === 'ulong' && row.text === '18446744073709551615'));
  assert(scalarCases.some(row => row.type === 'long' && row.text === '-9007199254740993'));
  assert(scalarCases.some(row => row.type === 'float' && row.text === '0.1'));
  assert(scalarCases.some(row => row.type === 'decimal' && row.text === '1.2300'));
});

test('StringWriter scalars independent native capture pins exact input, UTF-16 output and source provenance', () => {
  const native = nativeCapture();
  assert.equal(native.sdk, '10.0.201');
  assert.equal(native.runtime, '10.0.5');
  assert.equal(native.culture, 'InvariantCulture');
  assert.equal(native.declaredReceiver, 'System.IO.TextWriter');
  assert.equal(native.concreteReceiver, 'System.IO.StringWriter');
  assert.deepEqual(native.environmentNewLine, [10], 'The stored reference uses LF; Windows defaults are a separate profile');
  assert.equal(native.rows.length, 312);
  assert.equal(native.transitions.length, 24);
  const source = readFileSync(new URL('string-writer-scalars/Program.cs', nativeDirectory));
  assert.equal(createHash('sha256').update(source).digest('hex'), native.sourceSha256);
});

for (const engine of ['source', 'cil']) {
  test(`StringWriter scalars ${engine === 'source' ? 'source platform' : 'independent CIL'}: captured writer values and faults`, () => {
    for (const row of nativeCapture().rows) {
      const scalar = capturedScalar(row);
      if (engine === 'source') {
        const writer = writerPlatform(engine);
        const {platform, reference, call} = writer;
        try {
          call('Write', ['string'], ['seed|']);
          if (row.setNewLine) call('set_NewLine', ['string'], [fromUnits(row.requestedNewLine)]);
          if (row.receiverState === 'disposed') call('Dispose');
          const receiver = row.receiverState === 'null' ? null : reference;
          const invoke = () => platform.invoke(writerContract(row.operation, [row.type]), [receiver, scalar.value]);
          if (row.fault) assert.throws(invoke, {name: row.fault}, row.id);
          else assert.equal(invoke(), null, row.id);
          const actual = receiver === null ? null : units(platform.native(call('ToString')));
          assert.deepEqual(actual, row.output, row.id);
          assert.deepEqual(receiver === null ? null : units(platform.native(call('get_NewLine'))), row.actualNewLine, row.id);
        } finally { writer.stop(); }
      } else {
        const vm = new CilVirtualMachine(scalarWriterAssembly([scalar], {
          method: row.operation, baseView: true, nullWriter: row.receiverState === 'null',
          disposed: row.receiverState === 'disposed', delimiter: null,
          newLine: row.setNewLine ? fromUnits(row.requestedNewLine) : '\n'
        }));
        try {
          const result = vm.run();
          assert.equal(result.state, row.fault ? 'faulted' : 'terminated', row.id + ': ' + result.fault?.stack);
          assert.equal(result.fault?.name ?? null, row.fault, row.id);
          const receiver = vm.statics.get(0x04000001);
          const actual = receiver === null ? null : units(vm.platform.native(vm.platform.invoke(writerContract('ToString'), [receiver])));
          assert.deepEqual(actual, row.output, row.id);
        } finally { vm.stop(); }
      }
    }
  });
}

for (const engine of ['source', 'cil']) {
  for (const method of methods) {
    test(`StringWriter scalars ${engine}/${method}: typed dispatch preserves reused native scalar text`, () => {
      const writer = writerPlatform(engine);
      const {platform, call} = writer;
      try {
        call('Write', ['string'], ['seed|']);
        call('set_NewLine', ['string'], ['~']);
        for (const row of scalarCases) {
          assert.equal(call(method, [row.type], [row.value]), null, row.id);
          call('Write', ['string'], ['|']);
        }
        assert.equal(platform.native(call('ToString')), expectedText(scalarCases, method));
        assert.equal(platform.heap.pins.length, 0);
      } finally { writer.stop(); }
    });
  }
}

for (const baseView of [false, true]) {
  for (const method of methods) {
    test(`StringWriter scalars independent CIL ${baseView ? 'base' : 'concrete'}/${method}: exact stack widths and scalar text`, () => {
      const vm = new CilVirtualMachine(scalarWriterAssembly(scalarCases, {method, baseView}));
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        const receiver = vm.statics.get(0x04000001);
        const actual = vm.platform.native(vm.platform.invoke(writerContract('ToString'), [receiver]));
        assert.equal(actual, expectedText(scalarCases, method));
      } finally { vm.stop(); }
    });
  }
}

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringWriter scalars ${pipeline}/${engine}: typed locals select all sixteen concrete/base overloads`, () => {
      const rows = scalarCases.filter(row => row.source !== undefined);
      const source = rows.map((row, index) => `${row.type} scalar${index} = ${row.source};
        writer.Write(scalar${index}); view.WriteLine(scalar${index});`).join('\n');
      const program = compileToIL(`using System; using System.IO;
        var writer = new StringWriter(); TextWriter view = writer; view.NewLine = "~";
        ${source}
        Console.WriteLine(writer.ToString());
      `, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const called = new Set(disassemble(program.image).flatMap(method => method.instructions)
        .filter(instruction => instruction.op === 'BUILTIN').map(instruction => instruction.a));
      for (const name of methods) {
        for (const type of scalarTypes) assert(called.has(frameworkBuiltin(writerContract(name, [type])).id), name + '(' + type + ')');
      }
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, rows.map(row => row.text + row.text + '~').join('') + '\n');
      } finally { vm.stop(); }
    });

    test(`StringWriter scalars ${pipeline}/${engine}: narrow numeric widening leaves character and string overloads intact`, () => {
      const program = compileToIL(`using System; using System.IO;
        var writer = new StringWriter(); TextWriter view = writer; writer.NewLine = "~";
        sbyte signed = -128; byte unsigned = 255; short small = -32768; ushort large = 65535;
        writer.Write(signed); view.WriteLine(unsigned); writer.Write(small); view.WriteLine(large);
        writer.Write('A'); writer.WriteLine("text"); writer.WriteLine('B'); Console.WriteLine(writer.ToString());
      `, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '-128255~-3276865535~Atext~B~\n');
      } finally { vm.stop(); }
    });

    test(`StringWriter scalars ${pipeline}/${engine}: compiled null/disposed calls keep managed faults`, () => {
      const source = scalarTypes.map(type => {
        const row = scalarCases.find(item => item.type === type && item.source !== undefined);
        return methods.map(method => `
          try { missing.${method}(${row.source}); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
          try { writer.${method}(${row.source}); } catch (Exception error) { Console.WriteLine(error.GetType().Name); }
        `).join('\n');
      }).join('\n');
      const program = compileToIL(`using System; using System.IO;
        TextWriter missing = null; var writer = new StringWriter(); writer.Dispose(); ${source}
      `, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'NullReferenceException\nObjectDisposedException\n'.repeat(16));
      } finally { vm.stop(); }
    });
  }

  test(`StringWriter scalars ${pipeline}: object, composite formatting and provider constructors remain unsupported`, () => {
    for (const expression of ['writer.Write((object)42)', 'writer.WriteLine("{0}", 42)',
      'new StringWriter(writer.GetStringBuilder(), null)']) {
      const program = compileToIL('using System.IO; var writer = new StringWriter(); ' + expression + ';', {pipeline});
      assert.equal(program.success, false, expression);
      assert(program.diagnostics.some(item => item.severity === 'error'), expression);
    }
  });
}
