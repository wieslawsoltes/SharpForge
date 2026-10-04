import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly, AssemblyInspector} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

function compiled(source) {
  const result = compileToIL('using System; ' + source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

function routes(program) {
  return [['source', () => new VirtualMachine(program.image)],
    ['reloaded source', () => new VirtualMachine(loadAssembly(program.assembly))],
    ['direct CIL', () => new CilVirtualMachine(program.assembly)]];
}

function execute(source, expected) {
  const program = compiled(source);
  for (const [name, create] of routes(program)) {
    const vm = create();
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', name + ': ' + result.fault?.stack);
      assert.equal(result.output, expected, name);
    } finally { vm.stop(); }
  }
  return program;
}

test('source Object slots survive actual MethodDef metadata and dispatch through object references in every route', () => {
  const program = execute(`
    class Receiver {
      public override string ToString() { GC.Collect(); return "custom"; }
      public override bool Equals(object other) { GC.Collect(); return true; }
      public override int GetHashCode() { GC.Collect(); return 37; }
    }
    class Program {
      static void Main() {
        object value = new Receiver();
        Console.WriteLine(value.ToString());
        Console.WriteLine(value.Equals(null));
        Console.WriteLine(value.GetHashCode());
      }
    }`, 'custom\nTrue\n37\n');
  for (const image of [program.image, loadAssembly(program.assembly)]) {
    assert.deepEqual(image.methods.filter(method => method.owner === 'Receiver' && method.objectSlot)
      .map(method => method.objectSlot).sort(), ['Equals', 'GetHashCode', 'ToString']);
  }
  const inspector = new AssemblyInspector(program.assembly);
  for (const method of inspector.types.find(type => type.name === 'Receiver').methods) {
    if (['ToString', 'Equals', 'GetHashCode'].includes(method.name)) assert.equal(method.flags & 0x140, 0x40);
  }
});

test('source struct Object overrides mutate direct receivers and preserve boxed copies', () => {
  execute(`
    struct Counter {
      public int Value;
      public override string ToString() { Value++; return "counter"; }
      public override bool Equals(object other) { Value++; return true; }
      public override int GetHashCode() { Value++; return Value; }
    }
    class Program {
      static void Main() {
        Counter value = default(Counter);
        value.Value = 4;
        Console.WriteLine(value.ToString());
        Console.WriteLine(value.Value);
        object copy = value;
        Console.WriteLine(copy.GetHashCode());
        Console.WriteLine(value.Value);
        Console.WriteLine(copy.Equals(null));
        Console.WriteLine(((Counter)copy).Value);
        Console.WriteLine(value.Equals(null));
        Console.WriteLine(value.Value);
        Console.WriteLine(value.GetHashCode());
        Console.WriteLine(value.Value);
      }
    }`, 'counter\n5\n6\n5\nTrue\n7\nTrue\n6\n7\n7\n');
});

test('source Object override selection keeps readonly receivers defensive and writable fields direct', () => {
  execute(`
    struct Counter {
      public int Value;
      public override string ToString() { Value++; return "counter"; }
      public override bool Equals(object other) { Value++; return true; }
      public override int GetHashCode() { Value++; return Value; }
    }
    class Holder { public Counter Value; }
    class Program {
      static void Read(in Counter value) {
        value.ToString(); value.Equals(null); Console.WriteLine(value.GetHashCode());
        Console.WriteLine(value.Value);
      }
      static void Main() {
        Holder holder = new Holder();
        holder.Value.Value = 4;
        Read(in holder.Value);
        Console.WriteLine(holder.Value.Value);
        holder.Value.ToString(); holder.Value.Equals(null); Console.WriteLine(holder.Value.GetHashCode());
        Console.WriteLine(holder.Value.Value);
      }
    }`, '5\n4\n4\n7\n7\n');
});

test('source hidden methods do not replace Object slots while default struct values compare by fields', () => {
  execute(`
    class Hidden {
      public new string ToString() { return "hidden"; }
      public new bool Equals(object other) { return true; }
      public new int GetHashCode() { return 99; }
    }
    struct Pair { public int Value; }
    class Program {
      static void Main() {
        Hidden own = new Hidden();
        object value = own;
        Console.WriteLine(own.ToString());
        Console.WriteLine(value.ToString());
        Console.WriteLine(value.Equals(null));
        Pair first = default(Pair);
        first.Value = 9;
        object left = first;
        object right = first;
        Console.WriteLine(left.ToString());
        Console.WriteLine(left.Equals(right));
        Console.WriteLine(left.GetHashCode() == right.GetHashCode());
      }
    }`, 'hidden\nHidden\nFalse\nPair\nTrue\nTrue\n');
});

test('source generic struct overrides retain exact closed source slots', () => {
  execute(`
    struct Cell<T> {
      public T Value;
      public override string ToString() { return "cell"; }
      public override bool Equals(object other) { return true; }
      public override int GetHashCode() { return 23; }
    }
    class Program {
      static string Text<T>(T value) { return value.ToString(); }
      static void Main() {
        Cell<int> value = default(Cell<int>);
        Console.WriteLine(Text(value));
        Console.WriteLine(value.Equals(null));
        Console.WriteLine(value.GetHashCode());
      }
    }`, 'cell\nTrue\n23\n');
});

test('source Object virtual receivers preserve null faults', () => {
  execute(`
    class Program {
      static void Main() {
        object value = null;
        try { value.Equals(null); } catch (NullReferenceException) { Console.WriteLine("equals"); }
        try { value.GetHashCode(); } catch (NullReferenceException) { Console.WriteLine("hash"); }
        try { value.ToString(); } catch (NullReferenceException) { Console.WriteLine("text"); }
      }
    }`, 'equals\nhash\ntext\n');
});

for (const operation of ['Equals', 'GetHashCode']) test(`source ${operation} field callbacks retain resumable roots across snapshot restore`, () => {
  const program = compiled(`
    class Field {
      public override bool Equals(object other) { GC.Collect(); return true; }
      public override int GetHashCode() { GC.Collect(); return 37; }
    }
    struct Pair { public Field Reference; public bool Flag; public double Number; }
    class Program {
      static void Main() {
        Pair value = default(Pair);
        value.Reference = new Field();
        value.Flag = true;
        value.Number = 2.5;
        object left = value;
        object right = value;
        Console.WriteLine(${operation === 'Equals' ? 'left.Equals(right)' : 'left.GetHashCode() == right.GetHashCode()'});
      }
    }`);
  for (const [name, create] of routes(program)) {
    const vm = create();
    try {
      for (let count = 0; count < 1000 && !vm.top?.objectValueContinuation; count++) {
        vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
      }
      assert.equal(vm.top?.objectValueContinuation?.operation, operation, name);
      const snapshot = vm.snapshot();
      for (let replay = 0; replay < 2; replay++) {
        if (replay) vm.restore(snapshot);
        vm.heap.collect();
        const result = vm.run();
        assert.equal(result.state, 'terminated', name + ': ' + result.fault?.stack);
        assert.equal(result.output, 'True\n', name);
      }
    } finally { vm.stop(); }
  }
});
