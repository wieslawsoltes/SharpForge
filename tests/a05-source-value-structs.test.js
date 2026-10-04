import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileToIL
} from '@sharpforge/compiler';
import {
  loadAssembly,
  AssemblyInspector
} from '@sharpforge/cil';
import {
  VirtualMachine,
  CilVirtualMachine
} from '@sharpforge/runtime';

const counter = `
  struct Counter {
    public int Value;
    public Counter(int value) { Value = value; }
    public void Add(int delta) { Value += delta; }
    public int Next() { Value++; return Value; }
  }`;

function execute(source, expected) {
  const compiled = compileToIL('using System; ' + source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const [route, create] of [
      ['source', () => new VirtualMachine(compiled.image)],
      ['reloaded source', () => new VirtualMachine(loadAssembly(compiled.assembly))],
      ['direct CIL', () => new CilVirtualMachine(compiled.assembly)]
    ]) {
    const vm = create();
    const result = vm.run();
    assert.equal(result.state, 'terminated', route + ': ' + result.fault?.stack);
    assert.equal(result.output, expected, route);
  }
  return compiled;
}

test('A05 source structs copy parameters, locals and return values while instance calls mutate their receiver', () => {
  const compiled = execute(counter + `
    class Program {
      static Counter Changed(Counter value) { value.Add(2); return value; }
      static void Main() {
        Counter first = new Counter(3);
        Counter second = first;
        second.Add(4);
        Counter third = Changed(first);
        Console.WriteLine(first.Value);
        Console.WriteLine(second.Value);
        Console.WriteLine(third.Value);
      }
    }`, '3\n7\n5\n');
  const sourceType = compiled.image.types.find(type => type.name === 'Counter');
  assert.equal(sourceType.valueType, true);
  const inspector = new AssemblyInspector(compiled.assembly);
  const nativeType = inspector.types.find(type => type.name === 'Counter');
  assert.equal(inspector.metadata.typeName(nativeType.baseToken), 'System.ValueType');
  assert.equal(nativeType.flags & 0x18, 8, 'sequential value layout');
  assert.equal(loadAssembly(compiled.assembly).types.find(type => type.name === 'Counter').valueType, true);
});

test('A05 source struct refs alias variables and readonly in calls use defensive copies', () => {
  execute(counter + `
    class Program {
      static void Change(ref Counter value) { value.Add(5); }
      static int Observe(in Counter value) { return value.Next(); }
      static void Main() {
        Counter value = new Counter(8);
        Change(ref value);
        Console.WriteLine(Observe(in value));
        Console.WriteLine(value.Value);
      }
    }`, '14\n13\n');
});

test('A05 nested struct fields and array elements retain independent default and copied storage', () => {
  execute(counter + `
    struct Pair { public Counter Left; public Counter Right; }
    class Holder { public Pair Value; }
    class Program {
      static Pair Saved;
      static void Main() {
        Pair first = default(Pair);
        Pair second = first;
        second.Left.Value = 12;
        Counter[] values = new Counter[2];
        values[1].Add(7);
        Holder holder = new Holder();
        holder.Value = second;
        Saved = holder.Value;
        holder.Value.Left.Add(3);
        Console.WriteLine(first.Left.Value);
        Console.WriteLine(second.Left.Value);
        Console.WriteLine(values[0].Value);
        Console.WriteLine(values[1].Value);
        Console.WriteLine(Saved.Left.Value);
        Console.WriteLine(holder.Value.Left.Value);
      }
    }`, '0\n12\n0\n7\n12\n15\n');
});

test('A05 generic source structs copy nested values while retaining managed reference identity', () => {
  execute(`
    class Node { public int Value; }
    struct Cell<T> { public T Value; public Cell(T value) { Value = value; } }
    class Program {
      static void Main() {
        Node node = new Node();
        node.Value = 6;
        Cell<Node> first = new Cell<Node>(node);
        Cell<Node> second = first;
        second.Value.Value = 9;
        Console.WriteLine(first.Value.Value);
        Cell<int> number = default(Cell<int>);
        Console.WriteLine(number.Value);
      }
    }`, '9\n0\n');
});

test('A05 source struct boxing and unboxing preserve copies and exact value type identity', () => {
  execute(counter + `
    class Program {
      static void Main() {
        Counter original = new Counter(5);
        object boxed = original;
        original.Value = 7;
        Counter copy = (Counter)boxed;
        copy.Add(4);
        Console.WriteLine(original.Value);
        Console.WriteLine(((Counter)boxed).Value);
        Console.WriteLine(copy.Value);
      }
    }`, '7\n5\n9\n');
});

test('A05 source struct readonly writes retain compiler diagnostics', () => {
  const compiled = compileToIL(counter + `
    class Program {
      static void Invalid(in Counter value) { value.Value = 1; }
      static void Main() {}
    }`);
  assert.equal(compiled.success, false);
  assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
});

test('A05 source value unboxing checks exact scalar identity and null', () => {
  execute(`
    class Program {
      static void Main() {
        object boxed = 7;
        Console.WriteLine((int)boxed);
        try { long wrong = (long)boxed; Console.WriteLine(wrong); }
        catch (InvalidCastException) { Console.WriteLine("type"); }
        object empty = null;
        try { int missing = (int)empty; Console.WriteLine(missing); }
        catch (NullReferenceException) { Console.WriteLine("null"); }
      }
    }`, '7\ntype\nnull\n');
});

test('A05 source struct fields can be initialized individually before the value is read', () => {
  execute(`
    struct Pair { public int Left; public int Right; }
    class Program {
      static void Main() {
        Pair value;
        value.Left = 3;
        value.Right = 4;
        Pair copy = value;
        value.Left = 8;
        Console.WriteLine(copy.Left + copy.Right);
        Console.WriteLine(value.Left);
      }
    }`, '7\n8\n');
});
