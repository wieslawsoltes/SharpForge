import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToAssembly, compileToIL} from '@sharpforge/compiler';
import {BuiltinMap, Op} from '@sharpforge/bytecode';
import {AssemblyInspector, loadAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, ManagedHeap, VirtualMachine} from '@sharpforge/runtime';
import {builtin} from '../packages/runtime/src/execution/source-builtins.js';

const engines = {
  source: program => new VirtualMachine(program.image),
  roundtrip: program => new VirtualMachine(loadAssembly(program.assembly)),
  cil: program => new CilVirtualMachine(program.assembly)
};
const constructor = () => BuiltinMap.get('object.new');

function compile(body, pipeline, members = '') {
  const result = compileToIL(`using System; using Root = System.Object;
    ${members} class Program { static void Main() { ${body} } }`, {pipeline});
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

function calls(program) {
  const inspector = new AssemblyInspector(program.assembly);
  return {inspector, calls: inspector.callGraph().filter(call => call.callee)
    .map(call => ({...call, member: inspector.resolveToken(call.callee)}))};
}

function assertOutput(program, expected, inspect = () => {}) {
  for (const [engine, create] of Object.entries(engines)) {
    const vm = create(program);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
      assert.equal(result.output, expected, engine);
      inspect(vm, engine);
    } finally { vm.stop(); }
  }
}

test('Object allocation appends wire 1848 after the released scalar families without an A07 contract', () => {
  const entry = constructor();
  assert.equal(entry.id, 1848);
  assert.equal(BuiltinMap.get('Math.Max#2:UInt16').id, 1847);
  assert.equal(entry.id, BuiltinMap.get('Math.Max#2:UInt16').id + 1);
  assert.equal(BuiltinMap.get('Math.Min').id, 3);
  assert.equal(BuiltinMap.get('Math.Max').id, 4);
  assert.equal(BuiltinMap.get('object.ToString').id, 31);
  assert.equal(BuiltinMap.get('Exception.new').id, 33);
  assert.deepEqual({min: entry.min, max: entry.max, result: entry.result, params: entry.params},
    {min: 0, max: 0, result: 'object', params: []});
  assert.equal(entry.contract, undefined);
  assert(Object.isFrozen(entry));
  assert(Object.isFrozen(entry.params));
});

for (const pipeline of ['bound', 'legacy']) {
  test(`Object allocation ${pipeline}: fresh identities allocate once in source, reloaded source and CIL`, () => {
    const program = compile('object first = new object(); object second = new System.Object();' +
      'Console.WriteLine(Object.ReferenceEquals(first, second));', pipeline);
    assertOutput(program, 'False\n', vm => {
      assert.equal(vm.heap.stats.allocations, 2);
      assert.equal(vm.heap.stats.allocatedBytes, 64);
    });
    for (const image of [program.image, loadAssembly(program.assembly)]) {
      const operands = image.methods.flatMap(method => {
        const values = [];
        for (let offset = 0; offset < method.code.length; offset += 3) {
          if (method.code[offset] === Op.BUILTIN && method.code[offset + 1] === constructor().id) {
            values.push(method.code[offset + 2]);
          }
        }
        return values;
      });
      assert.deepEqual(operands, [0, 0]);
      assert(image.types.every(type => type.name !== 'System.Object'));
    }
  });

  test(`Object allocation ${pipeline}: aliases, empty initializers and object members retain CLR identity across GC`, () => {
    const program = compile(`Root first = new Root(); object alias = first; object second = new object {};
      Console.WriteLine(Object.ReferenceEquals(first, alias)); Console.WriteLine(Object.ReferenceEquals(first, second));
      Console.WriteLine(first.GetType().FullName); Console.WriteLine(second.ToString());
      GC.Collect(); Console.WriteLine(Object.ReferenceEquals(first, alias));`, pipeline);
    assertOutput(program, 'True\nFalse\nSystem.Object\nSystem.Object\nTrue\n');
    const {inspector, calls: emitted} = calls(program);
    const allocated = emitted.filter(call => call.member.owner === 'System.Object' && call.member.name === '.ctor' && call.kind === 'newobj');
    assert.equal(allocated.length, 2);
    for (const call of allocated) {
      assert.equal(call.callee >>> 24, 10);
      assert.equal(call.member.signature.isStatic, false);
      assert.equal(call.member.signature.returnType, 'void');
      assert.deepEqual(call.member.signature.parameters, []);
    }
    assert(inspector.types.every(type => type.name !== 'System.Object'));
  });

  test(`Object allocation ${pipeline}: a user class named Object retains its constructor and fields`, () => {
    const program = compile('Object value = new Object(7); object plain = new object();' +
      'Console.WriteLine(value.Value); Console.WriteLine(plain.ToString()); Console.WriteLine(value.GetType().FullName);', pipeline,
    'class Object { public int Value; public Object(int value) { Value = value; } }');
    assertOutput(program, '7\nSystem.Object\nObject\n');
  });

  test(`Object allocation ${pipeline}: constructor arity, names and destination types stay checked`, () => {
    for (const body of ['new object(1);', 'new System.Object(value: 1);', 'int value = new object();']) {
      const result = compileToIL(`class Program { static void Main() { ${body} } }`, {pipeline});
      assert.equal(result.success, false, body);
      assert(result.diagnostics.some(diagnostic => diagnostic.severity === 'error'), body);
    }
  });

  test(`Object allocation ${pipeline}: a synchronous allocation observer cannot resume a stopped caller`, () => {
    const program = compile('object value = new object(); Console.WriteLine("after");', pipeline);
    for (const [engine, create] of Object.entries(engines)) {
      const vm = create(program), previous = vm.heap.allocationObserver;
      let stopped = false, retiredStack, allocationsAtStop;
      vm.heap.allocationObserver = {allocation() {
        if (stopped) return;
        stopped = true;
        retiredStack = vm.inspector ? vm.top.stack : vm.stack;
        vm.stop();
        allocationsAtStop = vm.heap.stats.allocations;
      }};
      try {
        const result = vm.run();
        assert.equal(stopped, true, engine);
        assert.equal(result.state, 'terminated', engine);
        assert.equal(result.fault, null, engine);
        assert.equal(result.output, '', engine);
        assert.equal(vm.frames.length, 0, engine);
        assert.equal(vm.allFrames().length, 0, engine);
        assert.equal(retiredStack.length, 0, 'stopped ' + engine + ' caller must remain empty');
        assert.equal(vm.heap.pins.length, 0, engine);
        assert.equal(vm.heap.stats.allocations, allocationsAtStop, engine);
        assert.equal(vm.run().output, '', engine);
      } finally {
        if (previous === undefined) delete vm.heap.allocationObserver;
        else vm.heap.allocationObserver = previous;
        vm.stop();
      }
    }
  });
}

test('direct CIL Object construction and derived base calls retain distinct allocation and initialization', () => {
  const program = compileToAssembly(`class Parent { public int Value; public Parent(int value) { Value = value; } }
    class Child : Parent { public Child() : base(7) {} }
    class Program { static int Main() { Child child = new Child(); object plain = new object(); return child.Value; } }`);
  assert.deepEqual(program.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), []);
  const {inspector, calls: emitted} = calls(program);
  const objectCalls = emitted.filter(call => call.member.owner === 'System.Object' && call.member.name === '.ctor');
  assert.equal(objectCalls.filter(call => call.kind === 'newobj').length, 1);
  assert(objectCalls.some(call => call.kind === 'call'));
  assert(inspector.types.every(type => type.name !== 'System.Object'));
  const vm = new CilVirtualMachine(program.assembly);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(vm.value(vm.returnValue), 7);
    assert.equal(vm.heap.stats.allocations, 2, 'base Object::.ctor must never allocate another object');
  } finally { vm.stop(); }
});

test('standalone Object allocation preserves managed roots, snapshots and allocation failure cleanup', () => {
  const heap = new ManagedHeap({maxBytes: 64, initialThreshold: 32});
  const services = {heap, value: VirtualMachine.prototype.value};
  const allocate = () => builtin(services, constructor().id, []);
  const first = allocate(), firstHandle = heap.createHandle(first);
  const second = allocate(), secondHandle = heap.createHandle(second);
  assert.notDeepEqual(first, second);
  for (const reference of [first, second]) {
    const record = heap.get(reference);
    assert.equal(record.kind, 'object');
    assert.equal(record.methodTable.name, 'System.Object');
    assert.deepEqual(record.data, []);
  }
  const saved = heap.snapshot(), allocations = heap.stats.allocations;
  assert.throws(allocate, {name: 'OutOfMemoryException'});
  assert.equal(heap.stats.allocations, allocations);
  assert.equal(heap.pins.length, 0);
  heap.releaseHandle(firstHandle); heap.releaseHandle(secondHandle); heap.collect();
  assert.throws(() => heap.get(first), {name: 'InvalidReferenceException'});
  heap.restore(saved); heap.collect();
  assert.equal(heap.getHandle(firstHandle), first);
  assert.equal(heap.getHandle(secondHandle), second);
  assert.equal(heap.get(first).methodTable.name, 'System.Object');
  assert.equal(heap.pins.length, 0);
});
