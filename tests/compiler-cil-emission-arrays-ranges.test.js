import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: multi-dimensional arrays, System.Index / System.Range values, array ranges and list patterns in CIL
// emitted from bound trees. Reference: the fixture `arrays-ranges-and-list-patterns` of
// packages/compiler/test/cil-emission prints on .NET 10 what the Roslyn build prints (verify-dotnet.mjs).

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly);
  return {
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
const refused = source => {
  const result = compileToAssembly(source, { name: 'Sample' });
  assert.equal(result.assembly, null);
  return result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
};
const ending = (lines, suffix) => lines.filter(line => line.endsWith(suffix));

test('A02-T30 a multi-dimensional array is created and accessed through the methods of its array type', () => {
  const { lines } = emit(`class C {
      static int[,] Make() { return new int[2, 3]; }
      static int Get(int[,] m, int i, int j) { return m[i, j]; }
      static void Set(int[,] m, int v) { m[0, 1] = v; }
      static void Add(int[,] m) { m[1, 2] += 5; }
      static void Bump(ref int v) { v++; }
      static void Ref(int[,] m) { Bump(ref m[0, 0]); }
      static int Main() { var m = Make(); Set(m, 2); Add(m); Ref(m); return Get(m, 0, 1) + m.Length + m.Rank + m.GetLength(1); }
    }`);
  assert.deepEqual(lines('C', 'Make'), ['ldc.i4.2', 'ldc.i4.3', 'newobj int[0...,0...]::.ctor', 'ret']);
  assert.deepEqual(lines('C', 'Get'), ['ldarg.0', 'ldarg.1', 'ldarg.2', 'call int[0...,0...]::Get', 'ret']);
  assert.deepEqual(lines('C', 'Set'), ['ldarg.0', 'ldc.i4.0', 'ldc.i4.1', 'ldarg.1', 'call int[0...,0...]::Set', 'ret']);
  const add = lines('C', 'Add');
  assert.equal(ending(add, '::Get').length + ending(add, '::Set').length, 2, 'one read and one write of the element');
  assert.equal(add.filter(line => line === 'ldarg.0').length, 1, 'the array is evaluated once');
  assert.ok(lines('C', 'Ref').includes('call int[0...,0...]::Address'));
  const main = lines('C', 'Main');
  for (const member of ['get_Length', 'get_Rank', 'GetLength']) assert.ok(main.includes(`callvirt System.Array::${member}`), member);
});

test('A02-T30 a nested initializer stores each element; foreach visits a multi-dimensional array with one loop per dimension', () => {
  const { lines } = emit(`class C {
      static int Main() { int[,] t = { { 1, 2 }, { 3, 4 }, { 5, 6 } }; int s = 0; foreach (int v in t) s += v; return s; }
    }`);
  const main = lines('C', 'Main');
  assert.equal(ending(main, '::Set').length, 6);
  assert.equal(ending(main, 'System.Array::GetLength').length, 2);
  assert.equal(ending(main, '::Get').length, 1);
});

test('A02-T30 Index and Range are values; an array range is RuntimeHelpers.GetSubArray', () => {
  const { lines } = emit(`using System;
    class C {
      static Index Last() { return ^1; }
      static Range Tail() { return 2..; }
      static int[] Slice(int[] a, Range r) { return a[r]; }
      static int[] Inner(int[] a) { return a[1..^1]; }
      static int At(int[] a, Index i) { return a[i]; }
      static string Text(string s, Range r) { return s[r]; }
      static int Main() { int[] a = { 1, 2, 3 }; return Slice(a, Tail()).Length + Inner(a).Length + At(a, Last()) + Text("abc", 1..).Length; }
    }`);
  assert.deepEqual(lines('C', 'Last'), ['ldc.i4.1', 'ldc.i4.1', 'newobj System.Index::.ctor', 'ret']);
  const tail = lines('C', 'Tail');
  assert.equal(ending(tail, 'System.Index::.ctor').length, 1, 'the omitted end is ^0');
  assert.ok(tail.includes('newobj System.Range::.ctor'));
  assert.deepEqual(lines('C', 'Slice'), ['ldarg.0', 'ldarg.1', 'call System.Runtime.CompilerServices.RuntimeHelpers::GetSubArray', 'stloc.0', 'ldloc.0', 'ret']);
  assert.ok(lines('C', 'Inner').includes('call System.Runtime.CompilerServices.RuntimeHelpers::GetSubArray'));
  assert.ok(lines('C', 'At').includes('call System.Index::GetOffset'));
  const text = lines('C', 'Text');
  assert.equal(ending(text, 'System.Index::GetOffset').length, 2, 'the start and the end of the range');
  assert.equal(ending(text, '::Substring').length, 1);
});

test('A02-T30 the operand of ^ is evaluated before the length is read', () => {
  const { lines } = emit(`class L { public int Length { get { return 4; } } public int this[int i] { get { return i; } } }
    class C { static int One() { return 1; } static int Main() { return new L()[^One()]; } }`);
  const main = lines('C', 'Main');
  assert.ok(main.indexOf('call C::One') < main.indexOf('callvirt L::get_Length'));
});

test('A02-T30 list patterns test the length, read elements from both ends and slice with GetSubArray', () => {
  const { lines } = emit(`class C {
      static int Shape(int[] v) {
        switch (v) {
          case []: return 0;
          case [1, .., 9]: return 1;
          case [var first, .. var middle, var last]: return first + middle.Length + last;
          default: return -1;
        }
      }
      static int Main() { return Shape(new[] { 2, 3, 4 }); }
    }`);
  const shape = lines('C', 'Shape');
  assert.ok(shape.includes('ldlen'), 'the length decides first');
  assert.ok(shape.includes('call System.Runtime.CompilerServices.RuntimeHelpers::GetSubArray'));
  assert.ok(shape.includes('sub'), 'an element after the slice is read from the end');
});

test('A02-T30 a struct of the framework created with arguments calls its constructor', () => {
  const { lines } = emit(`using System;
    class C { static int Main() { return new Index(2, true).Value + new Range(1, 2).End.Value; } }`);
  const main = lines('C', 'Main');
  assert.equal(ending(main, 'System.Index::.ctor').length, 1);
  assert.ok(main.includes('newobj System.Range::.ctor'), 'not a zero-initialized value');
});

test('A02-T30 a list pattern over a type the binder has no list shape for is refused, not miscompiled', () => {
  const errors = refused(`class C { static int Main() { string s = "ab"; return s is ['a', ..] ? 1 : 0; } }`);
  assert.match(errors[0], /^SF2200 /);
});
