import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts, frameworkAssignable, frameworkType} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
import {MAX} from '@sharpforge/bcl-core';
import {ioModules} from '@sharpforge/bcl-io';
import {
  writerPlatform, writerContract, writerBaseAssembly, writerFaultAssembly, writerType, parentType, builderType
} from './fixtures/text-writer/engines.js';

const reference = new URL('../packages/bcl-io/reference/', import.meta.url);
const source = readFileSync(new URL('string-writer/Program.cs', reference), 'utf8');
const [output, extra] = readFileSync(new URL('string-writer-net10.txt', reference), 'utf8')
  .replaceAll('\r\n', '\n').split('--native--\n');
const [nativeOutput, nativeFaults] = extra.split('--faults--\n');
const faults = nativeFaults.trimEnd().split('\n');
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
let compiled;
const faultCases = [
  {name: 'Write', parameters: ['char'], args: [120]},
  {name: 'Write', parameters: ['string'], args: ['x']},
  {name: 'Write', parameters: ['string'], args: [null], nullValue: true},
  {name: 'WriteLine', parameters: [], args: []},
  {name: 'WriteLine', parameters: ['string'], args: ['x']},
  {name: 'WriteLine', parameters: ['string'], args: [null], nullValue: true}
];

for (const pipeline of ['bound', 'legacy']) {
  for (const [engine, create] of Object.entries(engines)) {
    test(`SF-A09-T03.2 ${pipeline} ${engine}: source character writes use the registered overload`, () => {
      const program = compileToIL("using System.IO; var writer = new StringWriter(); writer.Write('x'); Console.WriteLine(writer.ToString());", {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = create(program);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'x\n');
      } finally { vm.stop(); }
    });
  }
}

for (const [engine, create] of Object.entries(engines)) {
  test(`SF-A09-T03.2 ${engine}: unchanged StringWriter source matches .NET 10.0.5`, () => {
    compiled ??= compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = create(compiled);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, output);
    } finally { vm.stop(); }
  });

  test(`SF-A09-T03.2 ${engine}: top-level using calls inherited Dispose through the supported lowering`, () => {
    const program = compileToIL(`using System.IO;
      var writer = new StringWriter();
      using (writer) { writer.Write("inside"); }
      Console.WriteLine(writer.ToString());
      writer.Write("after");`);
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    const vm = create(program);
    try {
      const result = vm.run();
      assert.equal(result.output, 'inside\n');
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, 'ObjectDisposedException');
    } finally { vm.stop(); }
  });

  test(`SF-A09-T03.2 ${engine}: native disposal faults precede null and empty writes`, () => {
    const writer = writerPlatform(engine);
    const {platform, call} = writer;
    const fault = action => {
      let name;
      assert.throws(action, error => { name = error.name; return error instanceof ManagedFault; });
      return name;
    };
    try {
      const actual = [fault(() => platform.invoke(writerContract('.ctor', [builderType]), [null])),
        fault(() => platform.invoke(writerContract('ToString'), [null]))];
      call('Dispose');
      for (const item of faultCases) actual.push(fault(() => call(item.name, item.parameters, item.args)));
      assert.deepEqual(actual, faults);
      for (const name of ['Close', 'Dispose', 'Flush']) assert.equal(call(name), null);
      call('set_NewLine', ['string'], ['']);
      assert.throws(() => call('WriteLine'), error => error.name === 'ObjectDisposedException');
      assert.equal(platform.native(call('ToString')), '');
    } finally { writer.stop(); }
  });

  test(`SF-A09-T03.2 ${engine}: managed builder identity survives disposal, GC and snapshot restore`, () => {
    const writer = writerPlatform(engine);
    const {platform, call} = writer;
    const buffer = call('GetStringBuilder');
    const weak = platform.heap.createHandle(buffer, {weak: true});
    const append = findContracts(builderType, 'Append', false).find(item => item.parameters[0] === 'string');
    try {
      call('Write', ['string'], ['before']);
      const saved = platform.heap.snapshot();
      call('Dispose');
      platform.heap.collect();
      assert.deepEqual(platform.heap.getHandle(weak), buffer);
      assert.deepEqual(call('GetStringBuilder'), buffer);
      platform.invoke(append, [buffer, 'after']);
      assert.equal(platform.native(call('ToString')), 'beforeafter');
      platform.heap.restore(saved);
      call('Write', ['string'], ['restored']);
      assert.equal(platform.native(call('ToString')), 'beforerestored');
    } finally { platform.heap.releaseHandle(weak); writer.stop(); }
  });

  test(`SF-A09-T03.2 ${engine}: UTF-16 units and newline storage survive write-observer collection`, () => {
    const writer = writerPlatform(engine);
    const {platform, vm, call} = writer;
    try {
      vm.onWrite = () => platform.heap.collect();
      for (const unit of [0, 0xd800, 0xdc00, 0xffff]) call('Write', ['char'], [unit]);
      const newline = platform.managed('\0\ud800\r\n', 'string');
      call('set_NewLine', ['string'], [newline]);
      assert.deepEqual(call('get_NewLine'), newline);
      call('WriteLine', ['string'], ['x']);
      assert.equal(platform.native(call('ToString')), '\0\ud800\udc00\uffffx\0\ud800\r\n');
      call('set_NewLine', ['string'], [null]);
      assert.equal(platform.native(call('get_NewLine')), '\n');
      assert.equal(platform.heap.pins.length, 0);
      const fresh = platform.invoke(writerContract('.ctor'), []);
      assert.equal(platform.native(platform.invoke(writerContract('ToString'), [fresh])), '');
      assert.equal(platform.heap.pins.length, 0);
    } finally { vm.onWrite = null; writer.stop(); }
  });

  test(`SF-A09-T03.2 ${engine}: writes retain StringBuilder bounds and WriteLine partial progress`, () => {
    const writer = writerPlatform(engine);
    const {platform, call} = writer;
    try {
      call('Write', ['string'], ['x'.repeat(MAX - 1)]);
      assert.throws(() => call('Write', ['string'], ['xx']), error => error.name === 'OutOfMemoryException');
      assert.equal(platform.native(call('ToString')).length, MAX - 1);
      assert.throws(() => call('WriteLine', ['string'], ['y']), error => error.name === 'OutOfMemoryException');
      const final = platform.native(call('ToString'));
      assert.equal(final.length, MAX);
      assert.equal(final.at(-1), 'y');
      assert.equal(platform.heap.pins.length, 0);
    } finally { writer.stop(); }
  });

  test(`SF-A09-T03.2 ${engine}: unsupported receiver and invalid primitive inputs fail explicitly`, () => {
    const writer = writerPlatform(engine);
    const {platform, call} = writer;
    try {
      const unsupported = platform.make(parentType);
      assert.throws(() => platform.invoke(writerContract('Write', ['string']), [unsupported, 'x']),
        error => error.name === 'NotSupportedException');
      assert.throws(() => call('Write', ['char'], [65536]), error => error.name === 'ArgumentOutOfRangeException');
      assert.throws(() => call('set_NewLine', ['string'], [42]), error => error.name === 'ArgumentException');
    } finally { writer.stop(); }
  });
}

test('SF-A09-T03.2 independent CIL TextWriter dispatch matches native UTF-16 and disposal observations', () => {
  const vm = new CilVirtualMachine(writerBaseAssembly());
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, nativeOutput);
  } finally { vm.stop(); }
  const cases = [{nullBuilder: true}, {nullReceiver: true}, ...faultCases];
  for (const [index, options] of cases.entries()) {
    const machine = new CilVirtualMachine(writerFaultAssembly(options));
    try {
      const result = machine.run();
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, faults[index]);
    } finally { machine.stop(); }
  }
});

test('SF-A09-T03.2 writer contracts append after released reader and JSON IDs', () => {
  assert.equal(frameworkType(parentType).isAbstract, true);
  assert.equal(frameworkAssignable(parentType, writerType), true);
  assert.equal(frameworkAssignable('System.IDisposable', writerType), true);
  assert.equal(findContracts(parentType, '.ctor', false).length, 0);
  const signatures = [['get_NewLine'], ['set_NewLine', ['string']], ['Write', ['char']], ['Write', ['string']],
    ['WriteLine'], ['WriteLine', ['string']], ['Flush'], ['Close'], ['Dispose'], ['.ctor'], ['.ctor', [builderType]],
    ['GetStringBuilder'], ['ToString']];
  assert.deepEqual(signatures.map(([name, parameters]) => writerContract(name, parameters).id),
    Array.from({length: 13}, (_, index) => 655368 + index));
  assert.equal(findContracts('System.IO.StringReader', '.ctor', false)[0].id, 655367);
  assert.equal(findContracts('System.Text.Json.JsonElement', 'GetInt64', false)[0].id, 655360);
  assert.equal(ioModules[1].name, 'string-writer');
  assert.deepEqual(ioModules[1].invoke({bclHost: {frameworkType: () => null}}, {owner: 'unknown'}, []), {handled: false});
});

test('SF-A09-T03.2 deferred writer surfaces retain compiler errors', () => {
  for (const expression of ['new TextWriter()', 'new StringWriter().WriteAsync("x")', 'new StringWriter().Encoding']) {
    const result = compileToIL('using System.IO; class Program { static void Main() { var value = ' + expression + '; } }');
    assert.equal(result.success, false, expression);
    assert(result.diagnostics.some(item => item.severity === 'error'), expression);
  }
});
