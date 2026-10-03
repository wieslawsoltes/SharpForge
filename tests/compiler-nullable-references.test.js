import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { uninitializedMembersWithoutConstructor } from '../packages/compiler/src/nullable/uninitialized-members.js';
import { NullableAnnotation, SymbolKind, TypeKind } from '../packages/compiler/src/symbols/types.js';
import { MethodKind } from '../packages/compiler/src/symbols/members.js';

// SF-A02-E08: nullable reference types - flow rules, contexts and member initialization.

/** The nullable warnings (CS85xx - CS87xx) of a program as `code text`, where text is the source the warning covers. */
function warningsOf(source, options = {}) {
  return compile(source, options)
    .diagnostics.filter(d => d.severity === 'warning' && /^CS8[5-7]\d\d$/.test(d.code))
    .map(d => `${d.code} ${source.slice(d.start, d.start + d.length)}`);
}
const enabled = (statements, members = '') => `#nullable enable
using System;
struct Marker { }
class Program { static string? Find(int k) { return k > 0 ? "x" : null; } static string Need(string s) { return s; } ${members}
  static void Main(string[] args) { ${statements} } }`;

test('SF-A02-E08 x ??= y leaves x with the state of y', () => {
  assert.deepEqual(warningsOf(enabled('string? e = Find(4); e ??= "e"; Console.WriteLine(e.Length);')), []);
  assert.deepEqual(warningsOf(enabled('string? e = Find(4); e ??= Find(5); Console.WriteLine(e.Length);')), ['CS8602 e']);
  assert.deepEqual(warningsOf(enabled('string s = "s"; s ??= Find(1);')), ['CS8600 Find(1)']);
});

test('SF-A02-E08 x ?? y tests x: afterwards x may be null, unless y throws', () => {
  assert.deepEqual(warningsOf(enabled('string? k = Find(9); string l = k ?? throw new Exception(); Console.WriteLine(k.Length + l.Length);')), []);
  assert.deepEqual(warningsOf(enabled('string? m = Find(9); string n = m ?? "n"; Console.WriteLine(m.Length + n.Length);')), ['CS8602 m']);
  assert.deepEqual(warningsOf(enabled('string? b = Find(1); string k = b ?? null; Console.WriteLine(k);')), ['CS8600 b ?? null']);
});

test('SF-A02-E08 a variable passed to a non-nullable parameter is not null afterwards', () => {
  assert.deepEqual(warningsOf(enabled('string? b = Find(1); Need(b); Console.WriteLine(b.Length); string c = b; Console.WriteLine(c);')), ['CS8604 b']);
  assert.deepEqual(warningsOf(enabled('string? b = Find(1); Find(b == null ? 0 : 1); Console.WriteLine(b.Length);')), ['CS8602 b']);
});

test('SF-A02-E08 string.IsNullOrEmpty and IsNullOrWhiteSpace are null tests', () => {
  assert.deepEqual(warningsOf(enabled('string? h = Find(7); if (string.IsNullOrEmpty(h)) return; Console.WriteLine(h.Length);')), []);
  assert.deepEqual(warningsOf(enabled('string? w = Find(8); if (!string.IsNullOrWhiteSpace(w)) Console.WriteLine(w.Length); Console.WriteLine(w.Length);')), [
    'CS8602 w',
  ]);
});

test('SF-A02-E08 array elements carry their annotation (CS8625, CS8601, CS8602)', () => {
  assert.deepEqual(warningsOf(enabled('string[] items = new string[] { null, "x" }; Console.WriteLine(items[0].Length);')), ['CS8625 null']);
  assert.deepEqual(warningsOf(enabled('string[] items = new string[2]; items[0] = null; items[1] = Find(1);')), ['CS8625 null', 'CS8601 Find(1)']);
  assert.deepEqual(warningsOf(enabled('string?[] items = { null }; items[0] = null; Console.WriteLine(items[0].Length);')), ['CS8602 items[0]']);
});

test('SF-A02-E08 a possibly null thrown value is CS8597', () => {
  assert.deepEqual(warningsOf(enabled('throw null;')), ['CS8597 null']);
  assert.deepEqual(warningsOf(enabled('Exception? e = args.Length > 0 ? new Exception() : null; throw e;')), ['CS8597 e']);
  assert.deepEqual(warningsOf(enabled('throw new Exception();')), []);
});

test('SF-A02-E08 a constructor reports every member it leaves null (CS8618)', () => {
  const source = `#nullable enable
    class C { public string Name; public string Prop { get; set; } public string? Maybe; public C() { } public C(string n) { Name = n; Prop = n; } }
    class Program { static void Main() { } }`;
  const reported = compile(source).diagnostics.filter(d => d.code === 'CS8618');
  assert.deepEqual(reported.map(d => d.message.match(/Non-nullable (\w+ '\w+')/)[1]).sort(), ["field 'Name'", "property 'Prop'"]);
  // Both are reported on the constructor that leaves them null.
  assert.deepEqual([...new Set(reported.map(d => source.slice(d.start, d.start + d.length)))], ['C']);
});

test('SF-A02-E08 members of a class without a constructor are reported on themselves (CS8618)', () => {
  const source = `#nullable enable
    class NoConstructor { public string Field; public string Property { get; set; } public string? Optional; public string Set = ""; static string Shared; }
    class WithStatic { static string Shared; static WithStatic() { Shared = ""; } }
    struct Value { public string Field; }
    class Program { static void Main() { } }`;
  assert.deepEqual(warningsOf(source), ['CS8618 Field', 'CS8618 Property', 'CS8618 Shared']);
});

test('SF-A02-E08 uninitializedMembersWithoutConstructor: which members count', () => {
  const stringType = { isReferenceType: true };
  const member = (name, extra = {}) => ({
    kind: SymbolKind.Field,
    name,
    type: stringType,
    typeWithAnnotations: { nullableAnnotation: NullableAnnotation.NotAnnotated },
    ...extra,
  });
  const type = members => ({ typeKind: TypeKind.Class, getMembers: () => members });
  const names = members => uninitializedMembersWithoutConstructor(type(members)).map(d => d.member.name);
  assert.deepEqual(names([member('a'), member('b', { initializerSyntax: {} }), member('c', { isRequired: true })]), ['a']);
  assert.deepEqual(names([member('a', { typeWithAnnotations: { nullableAnnotation: NullableAnnotation.Annotated } })]), []);
  assert.deepEqual(names([member('a', { type: { isReferenceType: false } })]), []);
  const constructor = { kind: SymbolKind.Method, methodKind: MethodKind.Constructor };
  assert.deepEqual(names([member('a'), member('s', { isStatic: true }), constructor]), ['s']);
  assert.deepEqual(names([member('a'), { ...constructor, isImplicitlyDeclared: true }]), ['a']);
});

test('SF-A02-E08 an annotation outside a #nullable annotations context is CS8632', () => {
  const source = `using System;
struct Marker { }
class Program {
  static void Main() {
    string? a = null;
#nullable enable
    string? b = null;
#nullable disable
    string? c = null;
#nullable enable warnings
    string? d = null;
#nullable enable annotations
    string? e = null;
    Console.WriteLine(a + b + c + d + e);
  }
}`;
  const reported = compile(source).diagnostics.filter(d => d.code === 'CS8632');
  assert.deepEqual(reported.map(d => source.slice(0, d.start).split('\n').length), [5, 9, 11]);
  assert.ok(reported.every(d => d.severity === 'warning' && source[d.start] === '?'));
  // Below C# 8 the annotation is a feature error, not this warning.
  const old = compile(source.replace(/#nullable.*\n/g, ''), { langVersion: '7.3' }).diagnostics;
  assert.equal(old.filter(d => d.code === 'CS8632').length, 0);
  assert.ok(old.some(d => d.code === 'CS8370'));
});

test('SF-A02-E08 an override or implementation reports one nullability mismatch: the return type first', () => {
  const source = `#nullable enable
    interface I { string M(string? s); }
    class A : I { public string? M(string s) { return s; } }
    class Base { public virtual string V(string? s) { return ""; } public virtual string X(string? s) { return ""; } }
    class D : Base { public override string? V(string s) { return s; } public override string X(string s) { return s; } }
    class Program { static void Main() { } }`;
  assert.deepEqual(warningsOf(source), ['CS8766 M', 'CS8764 V', 'CS8765 X']);
});
