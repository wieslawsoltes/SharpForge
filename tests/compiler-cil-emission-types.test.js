import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: what the bytecode image cannot express, emitted as CIL from bound trees - run-time type tests and
// casts, patterns, `switch`, nullable value types and the null operators, initializers, labels and `goto`.
// The fixtures of packages/compiler/test/cil-emission run the same constructs end to end (tests/compiler-cil-emission.test.js);
// these tests pin the instructions. Reference for the shapes: ECMA-335 III.4 and the IL Roslyn emits for the same source.

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly);
  return {
    inspector,
    /** The instructions of `owner::name` as `name operand` lines; type and member operands are shown by name. */
    lines(owner, name) {
      const method = [...inspector.methods.values()].find(candidate => candidate.owner === owner && candidate.name === name);
      assert.ok(method, `no method ${owner}::${name}`);
      return inspector.getMethod(method.token).instructions.map(instruction => {
        if (instruction.operandKind !== 'token') return instruction.name;
        const token = instruction.operand,
          table = token >>> 24;
        if (table === 0x70) return instruction.name;
        if (table === 1 || table === 2 || table === 27) return `${instruction.name} ${inspector.metadata.typeName(token)}`;
        const target = inspector.resolveToken(token);
        return `${instruction.name} ${target.owner}::${target.name}`;
      });
    },
  };
}

test('A02-T30 is, as and casts are isinst, castclass and unbox.any', () => {
  const { lines } = emit(`class Animal { } class Dog : Animal { }
    class C {
      static bool Is(object o) { return o is Dog; }
      static Dog As(object o) { return o as Dog; }
      static Dog Cast(Animal a) { return (Dog)a; }
      static int Unbox(object o) { return (int)o; }
      static object Box(int value) { return value; }
      static void Main() { }
    }`);
  assert.deepEqual(lines('C', 'Is'), ['ldarg.0', 'isinst Dog', 'ldnull', 'cgt.un', 'ret']);
  assert.deepEqual(lines('C', 'As'), ['ldarg.0', 'isinst Dog', 'ret']);
  assert.deepEqual(lines('C', 'Cast'), ['ldarg.0', 'castclass Dog', 'ret']);
  assert.deepEqual(lines('C', 'Unbox'), ['ldarg.0', 'unbox.any System.Int32', 'ret']);
  assert.deepEqual(lines('C', 'Box'), ['ldarg.0', 'box System.Int32', 'ret']);
});

test('A02-T30 a declaration pattern tests with isinst and reads a value type back from the box', () => {
  const { lines } = emit(`class C {
      static int Length(object o) { if (o is string s) return s.Length; if (o is int n) return n; return -1; }
      static void Main() { }
    }`),
    body = lines('C', 'Length');
  assert.ok(body.includes('isinst System.String'));
  assert.ok(body.includes('isinst System.Int32'));
  assert.ok(body.includes('unbox.any System.Int32'));
  assert.ok(!body.includes('castclass System.String'), 'the result of isinst is the converted reference');
});

test('A02-T30 virtual and interface calls are callvirt; base calls and calls on this are direct', () => {
  const { lines } = emit(`interface IRun { int Run(); }
    class Base : IRun { public virtual int Run() { return 1; } int Helper() { return 2; } public int Both() { return Helper() + Run(); } }
    class Derived : Base { public override int Run() { return base.Run() + 1; } }
    class C {
      static int Through(IRun r) { return r.Run(); }
      static int Direct(Base b) { return b.Run(); }
      static void Main() { }
    }`);
  assert.ok(lines('C', 'Through').includes('callvirt IRun::Run'));
  assert.ok(lines('C', 'Direct').includes('callvirt Base::Run'));
  assert.ok(lines('Derived', 'Run').includes('call Base::Run'), 'base.Run() does not dispatch');
  const both = lines('Base', 'Both');
  assert.ok(both.includes('call Base::Helper'));
  assert.ok(both.includes('callvirt Base::Run'), 'a virtual method called on this still dispatches');
});

test('A02-T30 constructors chain to base, and instance initializers run before the base constructor', () => {
  const { lines } = emit(`class Base { protected int seed; public Base(int seed) { this.seed = seed; } }
    class Derived : Base { int extra = 7; public Derived() : base(3) { extra += seed; } public Derived(int x) : this() { extra = x; } }
    class C { static void Main() { } }`),
    parameterless = lines('Derived', '.ctor');
  // The first `.ctor` of Derived is the parameterless one: initializer, then base(3), then the body.
  assert.deepEqual(parameterless.slice(0, 6), ['ldarg.0', 'ldc.i4.7', 'stfld Derived::extra', 'ldarg.0', 'ldc.i4.3', 'call Base::.ctor']);
});

test('A02-T30 nullable values are System.Nullable<T> with members named on the constructed type', () => {
  const { lines } = emit(`class C {
      static int? Wrap(int value) { return value; }
      static int Or(int? value, int fallback) { return value ?? fallback; }
      static bool Has(int? value) { return value != null; }
      static void Main() { }
    }`);
  assert.deepEqual(lines('C', 'Wrap'), ['ldarg.0', 'newobj System.Nullable`1<int>::.ctor', 'ret']);
  const or = lines('C', 'Or');
  assert.ok(or.includes('call System.Nullable`1<int>::get_HasValue'));
  assert.ok(or.includes('call System.Nullable`1<int>::GetValueOrDefault'));
  assert.ok(lines('C', 'Has').includes('call System.Nullable`1<int>::get_HasValue'));
});

test('A02-T30 a using declaration protects the rest of its block with a finally region', () => {
  const { inspector } = emit(`using System;
    class R : IDisposable { public void Dispose() { } }
    class C { static void M() { using var r = new R(); Console.WriteLine("body"); } static void Main() { } }`),
    method = [...inspector.methods.values()].find(candidate => candidate.owner === 'C' && candidate.name === 'M'),
    body = inspector.getMethod(method.token);
  assert.equal(body.handlers.length, 1);
  assert.equal(body.handlers[0].flags, 2, 'a finally clause');
  assert.ok(body.instructions.some(instruction => instruction.name === 'endfinally'));
});

test('A02-T30 constructs the emitter still refuses are SF2200 naming them', () => {
  const refused = source => {
    const result = compileToAssembly(source, { name: 'Sample' });
    assert.equal(result.assembly, null);
    return result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  };
  assert.match(refused('class C { static void Main() { int[,] grid = new int[2, 2]; } }')[0], /^SF2200 .*multi-dimensional arrays/);
});
