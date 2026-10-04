import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {loadAssembly, AssemblyInspector} from '@sharpforge/cil';
import {Op, verifyImage, serializeImage, deserializeImage} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const cases = [
  ['implicit and explicit methods with distinct method arguments', `
    interface I { T Echo<T>(T value); }
    class Implicit : I { public T Echo<T>(T value) { return value; } }
    class Explicit : I { T I.Echo<T>(T value) { return value; } }
    class P { static void Main() { I a=new Implicit(); I b=new Explicit();
      Console.WriteLine(a.Echo<int>(17)); Console.WriteLine(a.Echo<string>("implicit"));
      Console.WriteLine(b.Echo<int>(29)); Console.WriteLine(b.Echo<string>("explicit")); } }`, '17\nimplicit\n29\nexplicit\n'],
  ['closed receiver and method arguments are independent', `
    interface I<T> { U Echo<U>(T first, U value); }
    class Cell<T> : I<T> { U I<T>.Echo<U>(T first, U value) { return value; } }
    class P { static void Main() { I<int> a=new Cell<int>(); I<string> b=new Cell<string>();
      Console.WriteLine(a.Echo<string>(1,"closed")); Console.WriteLine(b.Echo<int>("owner",37)); } }`, 'closed\n37\n'],
  ['generic default methods retain most-specific override selection', `
    interface I { T Echo<T>(T value) { Console.WriteLine("base"); return value; } }
    interface Left : I { T I.Echo<T>(T value) { Console.WriteLine("left"); return value; } }
    interface Right : I { }
    class Default : I { } class Derived : Left, Right { }
    class P { static void Main() { I a=new Default(); I b=new Derived();
      Console.WriteLine(a.Echo<int>(41)); Console.WriteLine(b.Echo<string>("specific")); } }`, 'base\n41\nleft\nspecific\n'],
  ['implementations created after a generic interface demand become reachable', `
    interface I { T Echo<T>(T value); }
    class Cell<T> : I { public U Echo<U>(U value) { return value; } }
    class P {
      static T Invoke<T>(I receiver,T value) { return receiver.Echo<T>(value); }
      static void Main() { Console.WriteLine(Invoke<int>(Create<string>(),53)); }
      static I Create<T>() { return new Cell<T>(); }
    }`, '53\n']
];

for (const [name, source, expected] of cases) {
  test('T02.2 source generic interface methods: ' + name, () => {
    const artifact = compileToIL('using System; ' + source);
    assert(artifact.success, JSON.stringify(artifact.diagnostics));
    for (const [route, vm] of [
      ['source', new VirtualMachine(artifact.image)],
      ['reload', new VirtualMachine(loadAssembly(artifact.assembly))],
      ['cil', new CilVirtualMachine(artifact.assembly)]
    ]) {
      const result = vm.run();
      assert.equal(result.state, 'terminated', route + ': ' + result.fault?.stack);
      assert.equal(result.output, expected, route);
      assert.equal(vm.frames.length, 0, route);
      vm.stop();
    }
    const inspector = new AssemblyInspector(artifact.assembly);
    assert((inspector.metadata.rows[25]?.length ?? 0) > 0, 'Constructed declarations retain MethodImpl identities');
  });
}

for (const [name, source, code] of [
  ['wrong method arity', `interface I { T Echo<T>(T value); } class C:I { public T Echo<T>(T value){return value;} }
    class P {static void Main(){I value=new C();value.Echo<int,string>(1);}}`, 'CS0305'],
  ['wrong implementation signature', `interface I { T Echo<T>(T value); } class C:I { public int Echo<T>(T value){return 1;} }
    class P {static void Main(){}}`, 'CS0738'],
  ['wrong receiver type', `interface I { T Echo<T>(T value); } class C { public T Echo<T>(T value){return value;} }
    class P {static void Main(){I value=new C();value.Echo<int>(1);}}`, 'CS0266']
]) {
  test('T02.2 source generic interface methods reject ' + name, () => {
    const artifact = compile(source);
    assert.equal(artifact.success, false);
    assert(artifact.diagnostics.some(diagnostic => diagnostic.code === code), JSON.stringify(artifact.diagnostics));
  });
}

test('T02.2 source verifier rejects malformed closed interface call arity', () => {
  const artifact = compileToIL('using System; ' + cases[0][1]);
  assert(artifact.success, JSON.stringify(artifact.diagnostics));
  const image = deserializeImage(serializeImage(artifact.image));
  const method = image.methods.find(candidate => [...candidate.code].some((opcode, index) => index % 3 === 0 && opcode === Op.CALLVIRT));
  const offset = [...method.code].findIndex((opcode, index) => index % 3 === 0 && opcode === Op.CALLVIRT);
  method.code[offset + 2] = 1;
  assert(verifyImage(image).some(message => message.includes('Invalid virtual call target or argument count')));
  assert.throws(() => new VirtualMachine(image), /virtual call target|bytecode|image/i);
});

test('T02.2 a corrupted generic interface receiver cannot enter an unrelated method in any route', () => {
  const artifact = compileToIL(`using System;
    interface I { T Echo<T>(T value); }
    class Good:I { public T Echo<T>(T value){Console.WriteLine("entered");return value;} }
    class Wrong { public void Touch(){} }
    class P {static void Main(){I value=new Good();value.Echo<int>(7);}}`);
  assert(artifact.success, JSON.stringify(artifact.diagnostics));
  for (const vm of [new VirtualMachine(artifact.image), new VirtualMachine(loadAssembly(artifact.assembly)),
    new CilVirtualMachine(artifact.assembly)]) {
    let found = false;
    for (let count = 0; count < 1000; count++) {
      const frame = vm.top;
      found = vm instanceof CilVirtualMachine ? frame?.method.instructions[frame.pc]?.name === 'callvirt' :
        frame && vm.image.methods[frame.methodId].code[frame.pc * 3] === Op.CALLVIRT;
      if (found) break;
      const result = vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
      assert.notEqual(result.state, 'faulted', result.fault?.stack);
      assert.notEqual(result.state, 'terminated', 'The interface call must remain pending for receiver substitution');
    }
    assert(found, 'Expected a pending interface call');
    const stack = vm instanceof CilVirtualMachine ? vm.top.stack : vm.stack;
    stack[stack.length - 2] = vm.heap.allocate('object', 'Wrong', []);
    const result = vm.run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.output, '', 'The incompatible receiver must fault before entering an implementation');
    vm.stop();
  }
});
