import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts, frameworkAssignable, frameworkType} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
import {RegistryBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {ioModules, stringReaderModule, registerIoModules} from '@sharpforge/bcl-io';
import {
  readerPlatform, readerContract, readerAssembly, readerBaseAssembly, readerInterfaceDisposeAssembly, readerType, parentType
} from './fixtures/text-reader/engines.js';

const reference = new URL('../packages/bcl-io/reference/', import.meta.url);
const source = readFileSync(new URL('string-reader/Program.cs', reference), 'utf8');
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
let compiled;

function oracle() {
  const [output, faults] = readFileSync(new URL('string-reader-net10.txt', reference), 'utf8')
    .replaceAll('\r\n', '\n').split('--faults--\n');
  return {output, faults: faults.trimEnd().split('\n')};
}

for (const [engine, create] of Object.entries(engines)) {
  test(`SF-A09-T03.1 ${engine}: unchanged StringReader fixture matches .NET 10.0.5`, () => {
    compiled ??= compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = create(compiled);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, oracle().output);
    } finally { vm.stop(); }
  });

  test(`SF-A09-T03.1 ${engine}: using calls inherited Dispose through existing lowering`, () => {
    const program = compileToIL(`using System.IO;
      var reader = new StringReader("one");
      using (reader) { Console.WriteLine(reader.ReadLine()); }
      reader.Read();`);
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    const vm = create(program);
    try {
      const result = vm.run();
      assert.equal(result.output, 'one\n');
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, 'ObjectDisposedException');
    } finally { vm.stop(); }
  });

  test(`SF-A09-T03.1 ${engine}: native faults and disposed-before-EOF precedence`, () => {
    const reader = readerPlatform(engine, '');
    const {platform, call} = reader;
    const fault = action => {
      let name;
      assert.throws(action, error => { name = error.name; return error instanceof ManagedFault; });
      return name;
    };
    try {
      const names = [
        fault(() => platform.invoke(readerContract('.ctor'), [null])),
        fault(() => platform.invoke(readerContract('Read'), [null]))
      ];
      call('Dispose');
      for (const method of ['Peek', 'Read', 'ReadLine', 'ReadToEnd']) names.push(fault(() => call(method)));
      assert.deepEqual(names, oracle().faults.slice(0, 6));
      assert.equal(call('Close'), null);
      assert.equal(call('Dispose'), null);
    } finally { reader.stop(); }
  });

  test(`SF-A09-T03.1 ${engine}: reader roots source, releases it on disposal, and restores its cursor`, () => {
    const reader = readerPlatform(engine);
    const {platform, input, reference: receiver, call} = reader;
    const weak = platform.heap.createHandle(input, {weak: true});
    try {
      platform.heap.collect();
      assert.deepEqual(platform.heap.getHandle(weak), input);
      assert.equal(call('Read'), 102);
      const saved = platform.heap.snapshot();
      call('Dispose');
      platform.heap.collect();
      assert.equal(platform.heap.getHandle(weak), null);
      platform.heap.restore(saved);
      assert.equal(platform.get(receiver, '$position'), 1);
      assert.equal(platform.native(call('ReadLine')), 'irst');
      assert.equal(platform.native(call('ReadToEnd')), 'last');
    } finally { platform.heap.releaseHandle(weak); reader.stop(); }
  });

  test(`SF-A09-T03.1 ${engine}: returned text survives a collection during cursor notification`, () => {
    const reader = readerPlatform(engine);
    const {platform, vm, call} = reader;
    const writes = [];
    try {
      vm.onWrite = event => {
        writes.push(event.property);
        platform.heap.collect();
      };
      assert.equal(platform.native(call('ReadLine')), 'first');
      assert.equal(platform.native(call('ReadToEnd')), 'last');
      assert.deepEqual(writes, ['$position', '$position']);
      assert.equal(platform.heap.pins.length, 0);
    } finally { vm.onWrite = null; reader.stop(); }
  });

  test(`SF-A09-T03.1 ${engine}: failed output allocation leaves the cursor unchanged`, () => {
    const reader = readerPlatform(engine);
    const {platform, reference: receiver, call} = reader;
    const allocate = platform.heap.allocate;
    try {
      platform.heap.allocate = () => { throw new ManagedFault('OutOfMemoryException', 'Reader allocation disabled'); };
      assert.equal(call('Peek'), 102);
      assert.equal(call('Read'), 102);
      for (const method of ['ReadLine', 'ReadToEnd']) {
        assert.throws(() => call(method), error => error.name === 'OutOfMemoryException');
        assert.equal(platform.get(receiver, '$position'), 1);
      }
      platform.heap.allocate = allocate;
      assert.equal(platform.native(call('ReadToEnd')), 'irst\r\nlast');
    } finally { platform.heap.allocate = allocate; reader.stop(); }
  });

  test(`SF-A09-T03.1 ${engine}: invalid constructor values and unknown TextReader implementations fail explicitly`, () => {
    const reader = readerPlatform(engine);
    const {platform} = reader;
    try {
      assert.throws(() => platform.invoke(readerContract('.ctor'), [42]), error => error.name === 'ArgumentException');
      const unsupported = platform.make(parentType);
      assert.throws(() => platform.invoke(readerContract('Read'), [unsupported]), error => error.name === 'NotSupportedException');
    } finally { reader.stop(); }
  });
}

test('SF-A09-T03.1 ordinary CIL base dispatch and interface assignability match native observations', () => {
  const expected = oracle().faults;
  const options = [{nullInput: true}, {nullReceiver: true}, ...['Peek', 'Read', 'ReadLine', 'ReadToEnd']
    .map(method => ({method, disposed: true}))];
  for (const [index, option] of options.entries()) {
    const vm = new CilVirtualMachine(readerAssembly(option));
    try {
      const result = vm.run();
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, expected[index]);
    } finally { vm.stop(); }
  }
  const vm = new CilVirtualMachine(readerBaseAssembly());
  try {
    const result = vm.run();
    assert.equal(result.output, expected.slice(6, 8).join('\n') + '\n');
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, expected[8]);
  } finally { vm.stop(); }
});

test('SF-A09-T03.1 abstract metadata and A09 IDs preserve existing JSON contracts', () => {
  assert.equal(frameworkType(parentType).isAbstract, true);
  assert.equal(new RegistryBridge().typeFromName(parentType).isAbstract, true);
  assert.equal(frameworkAssignable(parentType, readerType), true);
  assert.equal(frameworkAssignable('System.IDisposable', readerType), true);
  assert.equal(findContracts(parentType, '.ctor', false).length, 0);
  assert.equal(findContracts('System.Text.Json.JsonElement', 'GetInt64', false)[0].id, 655360);
  assert.deepEqual(['Peek', 'Read', 'ReadLine', 'ReadToEnd', 'Close', 'Dispose', '.ctor']
    .map(name => readerContract(name).id), [655361, 655362, 655363, 655364, 655365, 655366, 655367]);
});

test('SF-A09-T03.1 deferred buffer/async APIs and abstract construction remain compile-time errors', () => {
  for (const expression of ['new TextReader()', 'new StringReader("x").Read(new char[1], 0, 1)',
    'new StringReader("x").ReadLineAsync()']) {
    const result = compileToIL('using System.IO; class Program { static void Main() { ' + expression + '; } }');
    assert.equal(result.success, false, expression);
    assert(result.diagnostics.some(item => item.severity === 'error'), expression);
  }
});

test('SF-A09-T03.1 public IO registration uses the shared module protocol', () => {
  const members = [];
  registerIoModules({
    define() {},
    member(owner, name) { members.push(owner + '.' + name); },
    ctor(owner) { members.push(owner + '..ctor'); }
  });
  assert.equal(members.length, 7);
  assert.equal(ioModules[0], stringReaderModule);
  assert(Object.isFrozen(ioModules));
  assert.deepEqual(stringReaderModule.invoke({bclHost: {frameworkType: () => null}}, {owner: 'unknown'}, []), {handled: false});
});

test('SF-A09-T03.1 external IDisposable.Dispose invocation remains outside the verified CIL profile', () => {
  assert.throws(() => new CilVirtualMachine(readerInterfaceDisposeAssembly()), /Managed IL verification failed/);
});
