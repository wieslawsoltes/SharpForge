import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: members that still reported SF2200 on the direct CIL path - unimplemented partial methods,
// user-defined `&&` / `||` and `operator true`, `new T()`, events of generic types, caller line numbers passed to
// parameters of another type. Reference: the fixture `members-and-operators` of packages/compiler/test/cil-emission
// prints on .NET 10 what the Roslyn build prints (verify-dotnet.mjs).

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly),
    type = name => inspector.types.find(candidate => candidate.name === name) ?? assert.fail(`no type ${name}`);
  return {
    type,
    lines(owner, name) {
      const method = type(owner).methods.find(candidate => candidate.name === name) ?? assert.fail(`no method ${owner}::${name}`);
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

test('A02-T30 a partial method without an implementation has no row and its calls evaluate nothing', () => {
  const { type, lines } = emit(`partial class C {
      partial void Skip(int value);
      partial void Log(int value);
      static int Next() { return 1; }
      public void Run() { Skip(Next()); Log(2); }
    }
    partial class C { partial void Log(int value) { System.Console.WriteLine(value); } }
    class P { static void Main() { new C().Run(); } }`);
  assert.deepEqual(
    type('C').methods.map(method => method.name),
    ['Next', 'Run', 'Log', '.ctor'],
  );
  assert.deepEqual(lines('C', 'Run'), ['ldarg.0', 'ldc.i4.2', 'call C::Log', 'ret']);
});

test('A02-T30 user-defined && evaluates the left operand once and the right one only when it does not decide', () => {
  const { lines } = emit(`struct T {
      public static bool operator true(T v) { return true; }
      public static bool operator false(T v) { return false; }
      public static T operator &(T a, T b) { return a; }
      public static T operator |(T a, T b) { return a; }
    }
    class C {
      static T Make() { return new T(); }
      static T And() { return Make() && Make(); }
      static T Or() { return Make() || Make(); }
      static int If() { if (Make()) return 1; return 0; }
      static int Main() { And(); Or(); return If(); }
    }`);
  const and = lines('C', 'And');
  assert.deepEqual(and, [
    'call C::Make',
    'stloc.0',
    'ldloc.0',
    'call T::op_False',
    'brtrue.s',
    'ldloc.0',
    'call C::Make',
    'call T::op_BitwiseAnd',
    'br.s',
    'ldloc.0',
    'ret',
  ]);
  const or = lines('C', 'Or');
  assert.ok(or.includes('call T::op_True') && or.includes('call T::op_BitwiseOr'));
  assert.ok(lines('C', 'If').includes('call T::op_True'));
});

test('A02-T30 new T() is Activator.CreateInstance<T>(); a field of a constrained T is stored through a box', () => {
  const { lines } = emit(`class Item { public string Name; }
    class C {
      static T Make<T>() where T : new() { return new T(); }
      static T Named<T>(string name) where T : Item, new() { return new T { Name = name }; }
      static int Main() { return Make<int>() + Named<Item>("n").Name.Length; }
    }`);
  assert.deepEqual(lines('C', 'Make'), ['call System.Activator::CreateInstance', 'ret']);
  const named = lines('C', 'Named');
  assert.ok(named.indexOf('box !!0') >= 0 && named.indexOf('box !!0') < named.indexOf('stfld Item::Name'));
});

test('A02-T30 an event of a generic type is reached through the instantiation', () => {
  const { lines } = emit(`using System;
    class Counter<T> { public event Action<T> Changed; public void Raise(T v) { if (Changed != null) Changed(v); } }
    class C { static void Main() { var c = new Counter<string>(); c.Changed += s => { }; c.Raise("a"); } }`);
  assert.ok(lines('C', 'Main').includes('callvirt Counter`1<string>::add_Changed'));
  assert.ok(lines('Counter`1', 'Raise').includes('ldfld Counter`1<!0>::Changed'));
});

test('A02-T30 a caller line number converts to the type of its parameter', () => {
  const { lines } = emit(`using System.Runtime.CompilerServices;
    class C {
      static long Wide([CallerLineNumber] long line = 0) { return line; }
      static object Boxed([CallerLineNumber] object line = null) { return line; }
      static int Main() { return (int)Wide() + (Boxed() is int ? 1 : 0); }
    }`);
  const main = lines('C', 'Main');
  assert.equal(main[main.indexOf('call C::Wide') - 1], 'conv.i8');
  assert.equal(main[main.indexOf('call C::Boxed') - 1], 'box System.Int32');
});

test('A02-T30 a destructor is Finalize: its body in a try whose finally calls the destructor of the base class', () => {
  const { lines, type } = emit(`class A { ~A() { System.Console.WriteLine("a"); } }
    class B : A { ~B() { System.Console.WriteLine("b"); } }
    class P { static void Main() { new B(); } }`);
  assert.deepEqual(lines('B', 'Finalize'), ['ldstr', 'call System.Console::WriteLine', 'leave.s', 'ldarg.0', 'call A::Finalize', 'endfinally', 'ret']);
  assert.ok(lines('A', 'Finalize').includes('call System.Object::Finalize'));
  const VIRTUAL = 0x40,
    NEW_SLOT = 0x100,
    FAMILY = 0x4,
    flags = type('B').methods.find(method => method.name === 'Finalize').flags;
  assert.equal(flags & (VIRTUAL | NEW_SLOT), VIRTUAL, 'an override of Object.Finalize, not a new slot');
  assert.equal(flags & 0x7, FAMILY);
});
