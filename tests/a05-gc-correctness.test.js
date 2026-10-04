import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {BuiltinMap} from '@sharpforge/bytecode';
import {loadAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, ManagedHeap, VirtualMachine} from '@sharpforge/runtime';
import {builtin} from '../packages/runtime/src/execution/source-builtins.js';
import {managedFixture} from './managed-fixtures.js';

function sourceContext() {
  const vm = {heap: new ManagedHeap(), value: value => value};
  return {vm, invoke(name, args = []) { return builtin(vm, BuiltinMap.get('GC.' + name).id, args); }};
}
function cilContext() {
  const vm = new CilVirtualMachine(managedFixture());
  return {vm, invoke(name, args = []) {
    const signature = {
      isStatic: true,
      returnType: name === 'GetTotalMemory' ? 'long' : name === 'Collect' ? 'void' : 'int',
      parameters: name === 'GetTotalMemory' ? ['bool'] : name === 'Collect' ? [] : ['int']
    };
    return vm.intrinsic({kind: 'method', owner: 'System.GC', name, signature}, args);
  }};
}

for (const [engine, make] of [['source', sourceContext], ['CIL', cilContext]]) {
  test(`GC ${engine}: GetTotalMemory returns Int64 without wrapping above 2 GiB`, () => {
    const {vm, invoke} = make();
    // Exercise accounting boundaries without allocating multi-gigabyte test heaps.
    for (const bytes of [0, 2147483647, 2147483648, 4294967296, Number.MAX_SAFE_INTEGER]) {
      vm.heap.stats.liveBytes = bytes;
      assert.equal(invoke('GetTotalMemory', [false]), BigInt(bytes));
    }
  });

  test(`GC ${engine}: forced collection reports remaining bytes as Int64`, () => {
    const {vm, invoke} = make();
    vm.heap.string('unrooted');
    const bytes = vm.heap.stats.liveBytes;
    assert(bytes > 0);
    assert.equal(invoke('GetTotalMemory', [false]), BigInt(bytes));
    assert.equal(vm.heap.stats.collections, 0);
    assert.equal(invoke('GetTotalMemory', [true]), 0n);
    assert.equal(vm.heap.stats.collections, 1);
  });

  test(`GC ${engine}: all supported generations observe full-heap collections`, () => {
    const {invoke} = make();
    for (const generation of [0, 1, 2]) assert.equal(invoke('CollectionCount', [generation]), 0);
    invoke('Collect');
    for (const generation of [0, 1, 2]) assert.equal(invoke('CollectionCount', [generation]), 1);
    for (const generation of [-2147483648, -1, 3, 2147483647]) {
      assert.throws(() => invoke('CollectionCount', [generation]), {name: 'ArgumentOutOfRangeException'});
    }
  });
}

const paths = {
  source: built => new VirtualMachine(built.image, {maxBytes: Number.MAX_SAFE_INTEGER, initialThreshold: Number.MAX_SAFE_INTEGER}),
  reload: built => new VirtualMachine(loadAssembly(built.assembly), {maxBytes: Number.MAX_SAFE_INTEGER, initialThreshold: Number.MAX_SAFE_INTEGER}),
  CIL: built => new CilVirtualMachine(built.assembly, {maxBytes: Number.MAX_SAFE_INTEGER, initialThreshold: Number.MAX_SAFE_INTEGER})
};
for (const [engine, make] of Object.entries(paths)) {
  test(`GC compiled ${engine}: intrinsic values keep Int64 through locals and formatting`, () => {
    const built = compileToIL(`
      var bytes = GC.GetTotalMemory(false);
      Console.WriteLine(bytes);
      object boxed = bytes;
      Console.WriteLine(boxed);
      Console.WriteLine("bytes=" + bytes);
      Console.WriteLine(bytes.ToString());
    `);
    assert.equal(built.success, true, JSON.stringify(built.diagnostics));
    const vm = make(built), bytes = 4294967313;
    vm.heap.stats.liveBytes = bytes;
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, `${bytes}\n${bytes}\nbytes=${bytes}\n${bytes}\n`);
    const slot = built.image.methods.flatMap(method => method.locals).find(local => local.name === 'bytes');
    assert.equal(slot.type, 'long');
  });

  test(`GC compiled ${engine}: generation one and two calls succeed`, () => {
    const built = compileToIL('GC.Collect(); Console.WriteLine(GC.CollectionCount(0)); Console.WriteLine(GC.CollectionCount(1)); Console.WriteLine(GC.CollectionCount(2));');
    assert.equal(built.success, true, JSON.stringify(built.diagnostics));
    const result = make(built).run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, '1\n1\n1\n');
  });
}

test('GC CIL: independently authored Int64-returning caller preserves the native signature', () => {
  const assembly = managedFixture({methods: [{name: 'Main', result: 'long', body: (w, c) =>
    w.op('ldc.i4.0').op('call', c.member('System.GC', 'GetTotalMemory', 'long', ['bool'])).op('ret')
  }]});
  const vm = new CilVirtualMachine(assembly);
  vm.heap.stats.liveBytes = 2147483648;
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.returnValue, 2147483648n);
});

test('GC source typing: Int64 results cannot silently narrow into an Int32 local', () => {
  assert.equal(BuiltinMap.get('GC.GetTotalMemory').result, 'long');
  const result = compile('int bytes = GC.GetTotalMemory(false);');
  assert.equal(result.success, false);
  // Roslyn 5.3.0: long converts to int explicitly, so the error is CS0266 on the call (not CS0029 on the declarator).
  assert.deepEqual(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity, diagnostic.start, diagnostic.length]), [['CS0266', 'error', 12, 24]]);
});
