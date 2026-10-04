import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: real generics (TypeSpec / MethodSpec, no monomorphization), value types and by-references in CIL
// emitted from bound trees, and the properties of the emitted stream that real .NET checks (no unreachable tail,
// members read once by a switch). The fixtures `generics` and `structs-and-references` of
// packages/compiler/test/cil-emission run the same constructs and are verified against the Roslyn build on .NET.

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly);
  return {
    inspector,
    lines(owner, name) {
      const type = inspector.types.find(candidate => candidate.name === owner) ?? assert.fail(`no type ${owner}`),
        method = type.methods.find(candidate => candidate.name === name) ?? assert.fail(`no method ${owner}::${name}`);
      return inspector.getMethod(method.token).instructions.map(instruction => {
        if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
        const token = instruction.operand,
          table = token >>> 24;
        if (table === 1 || table === 2 || table === 27) return `${instruction.name} ${inspector.metadata.typeName(token)}`;
        const target = inspector.resolveToken(token);
        return `${instruction.name} ${target.owner}::${target.name}`;
      });
    },
  };
}
const count = (lines, text) => lines.filter(line => line === text).length;

test('A02-T30 members of a generic type are named through its instantiation, inside and outside the type', () => {
  const { lines, inspector } = emit(`class Box<T> {
      T value; static int made;
      public Box(T value) { this.value = value; made++; }
      public T Get() { return value; }
      public Box<T> Again() { return new Box<T>(value); }
    }
    class C { static int Main() { var b = new Box<int>(4); return b.Again().Get(); } }`);
  assert.deepEqual(lines('Box`1', 'Get'), ['ldarg.0', 'ldfld Box`1<!0>::value', 'ret']);
  assert.ok(lines('Box`1', '.ctor').includes('ldsfld Box`1<!0>::made'), 'a static field of the instantiation, not of the definition');
  assert.ok(lines('Box`1', 'Again').includes('newobj Box`1<!0>::.ctor'));
  const main = lines('C', 'Main');
  assert.ok(main.includes('newobj Box`1<int>::.ctor'));
  assert.ok(main.includes('callvirt Box`1<int>::Get'));
  // One definition, no copies per construction.
  assert.deepEqual(
    inspector.types.map(type => type.name),
    ['<Module>', 'Box`1', 'C'],
  );
});

test('A02-T30 generic methods are MethodSpecs; a value of type T is boxed, defaulted and called through its constraint', () => {
  const { lines } = emit(`interface IShape { int Area(); }
    class C {
      static T Id<T>(T value) { return value; }
      static T None<T>() { return default(T); }
      static object Box<T>(T value) { return value; }
      static int Area<T>(T shape) where T : IShape { return shape.Area(); }
      static int Main() { return Id(3) + Id<string>("x").Length; }
    }`);
  const main = lines('C', 'Main');
  assert.ok(main.includes('call C::Id'), 'the call names the generic method');
  assert.deepEqual(lines('C', 'Box'), ['ldarg.0', 'box !!0', 'ret']);
  assert.ok(lines('C', 'None').includes('initobj !!0'));
  assert.deepEqual(lines('C', 'Area'), ['ldarga.s', 'constrained. !!0', 'callvirt IShape::Area', 'ret']);
});

test('A02-T30 structs: calls on the address, copies by value, zero-initialization and by-reference members', () => {
  const { lines } = emit(`struct P { public int X; public P(int x) { X = x; } public void Move() { X++; } }
    class C {
      static int[] data = new int[2];
      static ref int Slot(int i) { return ref data[i]; }
      static void Set(ref P p) { p.X = 5; p = new P(7); }
      static int Use() { P p = new P(1); P q = p; q.Move(); P zero = default; Slot(1) = 3; Set(ref p); return p.X + q.X + zero.X + Slot(1); }
      static void Main() { }
    }`);
  const use = lines('C', 'Use');
  assert.ok(use.includes('call P::Move'), 'a struct method is called directly');
  assert.ok(use.includes('initobj P'), 'default(P) zero-initializes');
  assert.ok(use.some(line => line.startsWith('ldloca')), 'the receiver is the address of the variable');
  assert.ok(use.includes('stind.i4'), 'an assignment through a ref-returning call stores indirectly');
  assert.deepEqual(lines('C', 'Slot'), ['ldsfld C::data', 'ldarg.0', 'ldelema System.Int32', 'ret']);
  const set = lines('C', 'Set');
  assert.ok(set.includes('stfld P::X'));
  assert.ok(set.includes('stobj P'), 'assigning a struct through a ref parameter copies the whole value');
});

test('A02-T30 a value receiver is boxed for a method it inherits from a class', () => {
  const { lines } = emit(`using System;
    [Flags] enum Access { Read = 1, Write = 2 }
    struct S { public int X; }
    class C {
      static bool Has(Access a) { return a.HasFlag(Access.Write); }
      static string Text(S s) { return s.ToString(); }
      static void Main() { }
    }`);
  assert.deepEqual(lines('C', 'Has').slice(0, 2), ['ldarg.0', 'box Access']);
  assert.ok(lines('C', 'Has').includes('callvirt System.Enum::HasFlag'));
  assert.deepEqual(lines('C', 'Text'), ['ldarg.0', 'box S', 'callvirt System.Object::ToString', 'ret']);
});

test('A02-T30 unreachable code is not emitted: a body ends in a transfer', () => {
  const { lines } = emit(`using System;
    class C {
      static void Fail() => throw new Exception("x");
      static int Pick(bool b) => b ? 1 : throw new Exception("no");
      static int After(int x) { return x; x++; Console.WriteLine(x); }
      static void Main() { }
    }`);
  assert.equal(lines('C', 'Fail').at(-1), 'throw');
  assert.ok(!lines('C', 'Fail').includes('pop'));
  assert.equal(lines('C', 'Pick').at(-1), 'ret');
  assert.deepEqual(lines('C', 'After'), ['ldarg.0', 'ret']);
});

test('A02-T30 the arms of a switch read a member at most once, and a nested initializer reads it each time', () => {
  const { lines } = emit(`using System.Collections.Generic;
    class Point { public int X { get; set; } public int Y { get; set; } public List<int> Items { get; } = new List<int>(); }
    class C {
      static string Where(Point p) => p switch { { X: 0, Y: 0 } => "origin", { X: 0 } => "y", { Y: 0 } => "x", _ => "other" };
      static Point Make() { return new Point { Items = { 1, 2, 3 } }; }
      static void Main() { }
    }`),
    where = lines('C', 'Where');
  // Three arms name X and Y five times; each is one guarded call site per first use, and at run time one call.
  assert.ok(count(where, 'callvirt Point::get_X') <= 2 && count(where, 'callvirt Point::get_Y') <= 3);
  assert.ok(where.filter(line => line === 'brtrue' || line === 'brtrue.s').length >= 4, 'the reads are guarded by their flags');
  assert.equal(count(lines('C', 'Make'), 'callvirt Point::get_Items'), 3, '`Items = { 1, 2, 3 }` is three `Items.Add` calls');
});

test('A02-T30 a null-conditional chain yields null as soon as one receiver is null', () => {
  const { lines } = emit(`class Node { public Node Next; public int V; }
    class C { static int? Deep(Node n) { return n?.Next?.V; } static void Main() { } }`),
    deep = lines('C', 'Deep');
  assert.equal(count(deep, 'newobj System.Nullable`1<int>::.ctor'), 1, 'only the value of the last access is wrapped');
  assert.equal(count(deep, 'initobj System.Nullable`1<int>'), 1, 'one shared null result');
  assert.equal(deep.filter(line => line.startsWith('brfalse')).length, 2);
});

test('A02-T30 an index from the end is length minus value; a captured primary constructor parameter is a field', () => {
  const { lines, inspector } = emit(`class Counter(int step) { int total; public int Next() { total += step; return total; } }
    class C {
      static int Last(int[] values) { return values[^1]; }
      static string Middle(string text) { return text[1..^1]; }
      static void Main() { }
    }`),
    last = lines('C', 'Last');
  assert.ok(last.includes('ldlen') && last.includes('sub') && last.includes('ldelem.i4'));
  assert.ok(lines('C', 'Middle').includes('callvirt System.String::Substring'));
  const counter = inspector.types.find(type => type.name === 'Counter');
  assert.deepEqual(
    counter.fields.map(field => field.name),
    ['total', '<step>P'],
  );
  assert.deepEqual(lines('Counter', '.ctor').slice(0, 3), ['ldarg.0', 'ldarg.1', 'stfld Counter::<step>P']);
  assert.ok(lines('Counter', 'Next').includes('ldfld Counter::<step>P'));
});

test('A02-T30 ref reassignment stores an address; a struct constructor can assign this and chain to the implicit constructor', () => {
  const { lines } = emit(`struct P { public int X, Y; public P(int x) : this() { X = x; } public void Reset() { this = new P(9); } }
    class C {
      static int Pick(bool first) { int a = 1, b = 2; ref int r = ref a; if (!first) r = ref b; r += 10; return a * 100 + b; }
      static void Main() { }
    }`);
  assert.deepEqual(lines('P', '.ctor').slice(0, 2), ['ldarg.0', 'initobj P'], '`: this()` zero-initializes: a struct has no parameterless .ctor');
  assert.deepEqual(lines('P', 'Reset'), ['ldarg.0', 'ldc.i4.s', 'newobj P::.ctor', 'stobj P', 'ret']);
  const pick = lines('C', 'Pick');
  assert.equal(pick.filter(line => line.startsWith('ldloca')).length, 2, 'the ref local is set to the address of a, then of b');
  assert.ok(pick.includes('ldind.i4') && pick.includes('stind.i4'));
});
