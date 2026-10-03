/**
 * SF-A02-T50: static classes, partial types and accessor accessibility. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/type-modifiers.js; these tests cover the rule functions directly and
 * a few boundaries.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { isMoreRestrictive } from '../packages/compiler/src/binder/type-modifiers.js';
import { Accessibility } from '../packages/compiler/src/symbols/types.js';

// Every program declares an interface, so it is outside the execution profile and the semantic diagnostics are reported.
const marker = 'interface IMarker { }\n';
const codes = (body, severity = 'error') => {
  const source = marker + body;
  return compile(source)
    .diagnostics.filter(d => d.severity === severity && /^CS/.test(d.code) && d.code !== 'CS5001')
    .map(d => `${d.code} ${source.slice(d.start, d.start + d.length)}`);
};

test('SF-A02-T50 accessor accessibility must be a strict subset of the property accessibility', () => {
  const { Public, ProtectedOrInternal, Internal, Protected, ProtectedAndInternal, Private } = Accessibility;
  const order = [Public, ProtectedOrInternal, Internal, Protected, ProtectedAndInternal, Private];
  const restrictive = (inner, outer) => isMoreRestrictive(inner, outer);
  for (const access of order) assert.equal(restrictive(access, access), false);
  for (const access of order.slice(1)) assert.equal(restrictive(access, Public), true);
  for (const access of order.slice(0, -1)) assert.equal(restrictive(Private, access), true);
  assert.equal(restrictive(Internal, Protected), false);
  assert.equal(restrictive(Protected, Internal), false);
  assert.equal(restrictive(ProtectedAndInternal, Protected), true);
  assert.equal(restrictive(ProtectedAndInternal, Internal), true);
  assert.equal(restrictive(Protected, ProtectedOrInternal), true);
  assert.equal(restrictive(ProtectedOrInternal, Protected), false);
});

test('SF-A02-T50 a static class has only static members; each forbidden member kind has its own code', () => {
  assert.deepEqual(
    codes(`static class S {
      public S(int a) { }
      ~S() { }
      public int this[int i] { get { return i; } }
      public static implicit operator int(S s) { return 0; }
      protected internal static int P;
      static S() { }
      public static int Ok() { return P; }
    }`),
    ['CS0710 S', 'CS0711 S', 'CS0720 this', 'CS0715 int', 'CS0721 S', 'CS1057 P'],
  );
});

test('SF-A02-T50 static is a class modifier and excludes abstract and sealed; object is a valid base', () => {
  assert.deepEqual(codes('static class A : object { }\nabstract static class B { }\nsealed static class C { }\nstatic struct D { }'), [
    'CS0418 B',
    'CS0441 C',
    'CS0106 D',
  ]);
});

test('SF-A02-T50 a static class is not a type for values', () => {
  assert.deepEqual(
    codes(`static class S { }
    class User {
      S[] many;
      S One() { return null; }
      void Take(S s) { object o = (S)null; }
    }`).sort(),
    ['CS0716 (S)null', 'CS0719 S', 'CS0721 S', 'CS0722 One'].sort(),
  );
});

test('SF-A02-T50 the parts of a partial type agree; disagreements are reported on the first part', () => {
  const body = `public partial class A { }
internal partial class A { }
partial class G<T> where T : IMarker, System.IDisposable { }
partial class G<T> where T : System.IDisposable, IMarker { }
partial class H<T> where T : class { }
partial class H<T> { }
partial class N<T> { }
partial class N<V> { }`;
  assert.deepEqual(codes(body), ['CS0262 A', 'CS0264 N']);
  assert.deepEqual(codes('partial class G<T> where T : class { }\npartial class G<T> where T : struct { }'), ['CS0265 G']);
});

test('SF-A02-T50 partial comes directly before the type keyword and is not a field modifier', () => {
  assert.deepEqual(codes('partial static class A { }\nstatic partial class B { }\nclass C { partial int f; }', 'error'), [
    'CS0267 partial',
    'CS0267 partial',
  ]);
});

test('SF-A02-T50 accessor modifiers: one accessor only, two accessors needed, more restrictive, not private when abstract', () => {
  assert.deepEqual(
    codes(`abstract class P {
      public int A { private get; private set; }
      public int B { private get { return 0; } }
      internal int C { get; protected set; }
      protected int D { get; private protected set; }
      public abstract int E { private get; set; }
      public int F { get; internal set; }
    }`),
    ['CS0274 A', 'CS0276 B', 'CS0273 set', 'CS0442 get'],
  );
});

test('SF-A02-T50 an override keeps the accessibility of each accessor (CS0507 on the accessor)', () => {
  assert.deepEqual(
    codes(`class Root { public virtual int V { get { return 0; } protected set { } } }
    class Same : Root { public override int V { get { return 1; } protected set { } } }
    class Wider : Root { public override int V { get { return 1; } set { } } }`),
    ['CS0507 set'],
  );
});

test('SF-A02-T50 a set accessor that is not accessible stops every kind of write (CS0272)', () => {
  assert.deepEqual(
    codes(`class Box { public int V { get; private set; } }
    class User { void M(Box b) { b.V = 1; b.V += 1; b.V++; --b.V; int r = b.V; } }`),
    ['CS0272 b.V', 'CS0272 b.V', 'CS0272 b.V', 'CS0272 b.V'],
  );
});
