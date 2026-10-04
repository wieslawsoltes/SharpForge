import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compile,
  compileToIL
} from '@sharpforge/compiler';
import {
  loadAssembly,
  AssemblyInspector,
  emitAssembly
} from '@sharpforge/cil';
import {
  Op,
  serializeImage,
  deserializeImage,
  verifyImage
} from '@sharpforge/bytecode';
import {
  VirtualMachine,
  CilVirtualMachine
} from '@sharpforge/runtime';

const cases = [
  ['closed generic interface implementations retain their construction', `interface I<T> { T Read(); }
    class Cell<T> : I<T> { T value; public Cell(T value) { this.value=value; } public T Read() { return value; } }
    class Program { static void Main() { I<int> first=new Cell<int>(7); I<string> second=new Cell<string>("closed");
      Console.WriteLine(first.Read()); Console.WriteLine(second.Read()); } }`, '7\nclosed\n'],
  ['implicit and explicit implementations', `interface I { int Read(); }
    class Implicit : I { public int Read() { return 11; } }
    class Explicit : I { int I.Read() { return 22; } }
    class Program { static void Main() { I a=new Implicit(); I b=new Explicit();
      Console.WriteLine(a.Read()); Console.WriteLine(b.Read()); } }`, '11\n22\n'],
  ['inherited default body and most specific diamond', `interface I { int Read() { return 1; } }
    interface Left : I { int I.Read() { return 2; } }
    interface Right : I { }
    interface Both : Left, Right { int I.Read() { return 3; } }
    class Default : I { } class Specific : Both { }
    class Program { static void Main() { I a=new Default(); I b=new Specific();
      Console.WriteLine(a.Read()); Console.WriteLine(b.Read()); } }`, '1\n3\n'],
  ['class implementation dominates defaults', `interface I { int Read() { return 1; } }
    interface Left : I { int I.Read() { return 2; } }
    interface Right : I { int I.Read() { return 3; } }
    class C : Left, Right { public int Read() { return 9; } }
    class Program { static void Main() { I value=new C(); Console.WriteLine(value.Read()); } }`, '9\n'],
  ['interface property and boxed struct receiver', `interface I { int Value { get; set; } }
    struct Counter : I { public int Value { get; set; } }
    class Program { static void Main() { Counter counter=default(Counter); I value=counter;
      value.Value=42; Console.WriteLine(value.Value); Console.WriteLine(counter.Value); } }`, '42\n0\n'],
  ['null receiver throws before entering a default body', `interface I { int Read() { return 1; } } class Available : I { }
    class Program { static void Main() { I value=null; try { Console.WriteLine(value.Read()); }
      catch(NullReferenceException) { Console.WriteLine("null"); } } }`, 'null\n']
];

for (const [name, source, expected] of cases) {
  test('T02.2 source interface dispatch: ' + name, () => {
    const artifact = compileToIL('using System; ' + source);
    assert(artifact.success, JSON.stringify(artifact.diagnostics));
    assert(artifact.image.methods.some(method => [...method.code].some((value, index) => index % 3 === 0 && value === Op.CALLVIRT)));
    for (const [route, vm] of [
        ['source', new VirtualMachine(artifact.image)],
        ['reload', new VirtualMachine(loadAssembly(artifact.assembly))],
        ['cil', new CilVirtualMachine(artifact.assembly)]
      ]) {
      const result = vm.run();
      assert.equal(result.state, 'terminated', route + ': ' + result.fault?.stack);
      assert.equal(result.output, expected, route);
      vm.stop();
    }
    const inspector = new AssemblyInspector(artifact.assembly);
    assert(inspector.types.some(type => type.flags & 0x20));
    for (const method of artifact.image.methods.filter(method => method.isAbstract)) {
      assert.equal(method.code.length, 0);
      assert.equal([...inspector.methods.values()].find(item => item.owner === method.owner && item.name === method.name).hasBody, false);
    }
  });
}

test('T02.2 source rejects ambiguous default-interface diamonds with the C# diagnostic', () => {
  const artifact = compile(`interface I { int Read() { return 1; } }
    interface Left : I { int I.Read() { return 2; } }
    interface Right : I { int I.Read() { return 3; } }
    class C : Left, Right { } class Program { static void Main() { I value=new C(); value.Read(); } }`);
  assert.equal(artifact.success, false);
  assert(artifact.diagnostics.some(item => item.code === 'CS8705'), JSON.stringify(artifact.diagnostics));
});

test('T02.2 ambiguous runtime metadata faults at the invoked interface declaration in every route', () => {
  const artifact = compileToIL('using System; ' + cases.find(item => item[0] === 'class implementation dominates defaults')[1]);
  assert(artifact.success, JSON.stringify(artifact.diagnostics));
  const image = deserializeImage(serializeImage(artifact.image));
  const implementation = image.methods.find(method => method.owner === 'C' && method.name === 'Read');
  implementation.isVirtual = false;
  delete implementation.isNewSlot;
  delete implementation.isFinal;
  assert.deepEqual(verifyImage(image), []);
  const assembly = emitAssembly(image);
  for (const vm of [new VirtualMachine(image), new VirtualMachine(loadAssembly(assembly)), new CilVirtualMachine(assembly)]) {
    const result = vm.run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'System.Runtime.AmbiguousImplementationException');
  }
});
