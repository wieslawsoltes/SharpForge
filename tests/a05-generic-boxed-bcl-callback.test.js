import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

const routes = {
  source: program => new VirtualMachine(program.image),
  reloaded: program => new VirtualMachine(loadAssembly(program.assembly)),
  cil: program => new CilVirtualMachine(program.assembly)
};

function compile(body, override = 'return "cell";') {
  const program = compileToIL(`using System; using System.Text;
    struct Cell<T> {
      public T Value;
      public int Count;
      public Cell(T value) { Value = value; Count = 0; }
      public override string ToString() {
        Count++; Console.WriteLine("callback"); GC.Collect(); ${override}
      }
    }
    class Program { static void Main() { ${body} } }`);
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return program;
}

function stringify(vm, receiver) {
  return vm.platform.bclHost.invokeObjectToString(vm.platform, receiver);
}

/** Real GenericParam/TypeSpec metadata: no source/debug metadata closes this box's override. */
function assembly({throwing = false} = {}) {
  return genericCallFixture([
    {name: 'Cell`1', base: 'System.ValueType', flags: 0x100109, genericParameters: [{}],
      fields: [{name: 'Value', type: '!0'}, {name: 'Count', type: 'int'}], methods: [
        {name: 'ToString', static: false, flags: 0xc6, result: 'string', body(writer, context) {
          const count = context.fields.get('Cell`1.Count');
          writer.op('ldarg.0').op('ldfld', context.fields.get('Cell`1.Value')).op('pop')
            .op('ldarg.0').op('dup').op('ldfld', count).op('ldc.i4.1').op('add').op('stfld', count)
            .op('ldstr', 0x70000000 + context.md.userString('callback'))
            .op('call', context.member('System.Console', 'WriteLine', 'void', ['string']))
            .op('call', context.member('System.GC', 'Collect', 'void'));
          if (throwing) writer.op('ldnull').op('throw');
          else writer.op('ldstr', 0x70000000 + context.md.userString('cell')).op('ret');
        }}
      ]},
    {name: 'Program', methods: [{name: 'Main', result: 'object', locals: ['Cell`1<string>'], body(writer, context) {
      const closed = context.typeSpec('Cell`1<string>');
      writer.op('ldloca.s', 0).op('ldstr', 0x70000000 + context.md.userString('payload'))
        .op('stfld', context.field(closed, 'Value', '!0')).op('ldloc.0').op('box', closed).op('ret');
    }}]}
  ]);
}

for (const [name, create] of Object.entries(routes)) {
  test(`generic boxed BCL callback ${name}: Insert mutates each original closed box and retains its payload`, () => {
    const vm = create(compile(`
      object text = new Cell<string>("payload");
      object number = new Cell<int>(17);
      var builder = new StringBuilder("|");
      builder.Insert(0, text); builder.Insert(0, number); builder.Insert(0, text);
      Console.WriteLine(builder.ToString());
      Console.WriteLine(((Cell<string>)text).Count); Console.WriteLine(((Cell<string>)text).Value);
      Console.WriteLine(((Cell<int>)number).Count); Console.WriteLine(((Cell<int>)number).Value);`));
    let callbacks = 0;
    vm.onOutput = text => {
      if (text !== 'callback\n') return;
      callbacks++;
      assert.equal(vm.scheduler.callbackScopes.length, 1, 'The BCL invokes the synchronous callback service');
      const receiver = vm.inspector ? vm.top.args[0] : vm.top.locals[0];
      assert.equal(receiver.kind, 'box');
      assert.equal(receiver.vmOwner, vm.snapshotOwner);
      const record = vm.heap.get(receiver.owner);
      if (vm.inspector) {
        assert.equal(vm.top.method.owner, record.methodTable.name, 'The emitted monomorphized method keeps its physical owner');
        assert.equal(vm.top.method.genericIdentity, undefined, 'The projected source owner is not an actual CLI generic construction');
        assert.equal(record.methodTable.sourceIdentity.name, 'Cell`1');
      }
      vm.heap.collect();
      assert.equal(vm.heap.get(receiver.owner).methodTable, record.methodTable);
    };
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, 'callback\ncallback\ncallback\ncellcellcell|\n2\npayload\n1\n17\n');
      assert.equal(callbacks, 3);
      assert.equal(vm.scheduler.callbackScopes.length, 0);
    } finally { vm.stop(); }
  });

  test(`generic boxed BCL callback ${name}: escaping override faults preserve writes and the managed catch`, () => {
    const vm = create(compile(`
      object value = new Cell<string>("payload"); var builder = new StringBuilder("before");
      try { builder.Insert(0, value); } catch (Exception) { Console.WriteLine("caught"); }
      Console.WriteLine(builder.ToString()); Console.WriteLine(((Cell<string>)value).Count);`,
    'throw new Exception("failure");'));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, 'callback\ncaught\nbefore\n1\n');
      assert.equal(vm.scheduler.callbackScopes.length, 0);
    } finally { vm.stop(); }
  });

  test(`generic boxed BCL callback ${name}: stop cancels insertion without restoring the interrupted caller`, () => {
    const vm = create(compile(`
      object value = new Cell<string>("payload"); var builder = new StringBuilder("before");
      builder.Insert(-1, value); Console.WriteLine("unreachable");`));
    let writes = 0, stopped;
    vm.onWrite = () => { writes++; };
    vm.onOutput = text => {
      assert.equal(text, 'callback\n');
      vm.stop();
      stopped = {writes, allocations: vm.heap.stats.allocations};
    };
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, 'callback\n');
      assert.ok(stopped);
      assert.equal(writes, stopped.writes);
      assert.equal(vm.heap.stats.allocations, stopped.allocations);
      assert.equal(vm.allFrames().length, 0);
      assert.equal(vm.scheduler.callbackScopes.length, 0);
    } finally { vm.onOutput = null; vm.onWrite = null; vm.stop(); }
  });
}

for (const throwing of [false, true]) {
  test(`independent CIL generic box callback: closed owner, roots and control survive throwing=${throwing}`, () => {
    const vm = new CilVirtualMachine(assembly({throwing}));
    try {
      assert.equal(vm.run().state, 'terminated', vm.fault?.stack);
      const receiver = vm.returnValue, table = vm.heap.get(receiver).methodTable;
      vm.returnValue = null;
      const saved = vm.snapshot(), frames = vm.frames, pins = vm.heap.pins.length;
      let callbacks = 0;
      vm.onOutput = () => {
        callbacks++;
        assert.equal(vm.top.method.genericIdentity, table.name);
        assert.equal(vm.top.args[0].owner, receiver);
        assert.equal(vm.top.args[0].frameId, 0, 'A heap-owned interior needs no retained caller');
        assert.throws(() => vm.snapshot(), /synchronous managed callbacks/);
        assert.throws(() => vm.restore(saved), /synchronous managed callbacks/);
        vm.heap.collect();
        assert.equal(vm.value(vm.heap.get(receiver).data[0].fields[0]), 'payload');
      };
      if (throwing) assert.throws(() => stringify(vm, receiver), error => error.name === 'NullReferenceException');
      else assert.equal(vm.value(stringify(vm, receiver).value), 'cell');
      assert.equal(callbacks, 1);
      assert.equal(vm.heap.get(receiver).data[0].fields[1], 1);
      assert.equal(vm.frames, frames);
      assert.equal(vm.state, 'terminated');
      assert.equal(vm.returnValue, null);
      assert.equal(vm.fault, null);
      assert.equal(vm.scheduler.callbackScopes.length, 0);
      assert.equal(vm.heap.pins.length, pins);
    } finally { vm.stop(); }
  });
}
