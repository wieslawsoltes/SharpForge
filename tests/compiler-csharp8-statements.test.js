import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf } from './support/semantic-codegen.js';

// SF-A02-T68: static local and anonymous functions, using declarations and pattern-based disposal.

/** The C# errors of a program as `code text`, where text is the source the diagnostic covers. */
function errorsOf(source, options = {}) {
  return compile(source, options)
    .diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code))
    .map(d => `${d.code} ${source.slice(d.start, d.start + d.length)}`);
}
// `Marker` is outside the execution profile, so every program here is bound by the semantic binder (the profile's own
// binder keeps its diagnostics for programs it can compile).
const inMethod = (statements, members = '') =>
  `using System; class R : IDisposable { public void Dispose() { } } struct Marker { }
   class Program { int field = 1; static int shared = 2; ${members}
     void M(int parameter, string[] args) { int local = 0; ${statements} }
     static void Main() { new Program().M(shared, null); } }`;

test('SF-A02-T68 a static local function uses constants, statics and other static functions', () => {
  const lines = linesOf(`using System;
    class Program {
      const int K = 3; static int S = 4;
      static int Run(int value) {
        const int c = 5; int unused = 1;
        static int Twice(int x) => x * 2 + K + S + c;
        static int Fact(int n) => n <= 1 ? 1 : n * Fact(n - 1);
        static string Names() => nameof(unused) + nameof(value);
        return Twice(1) + Fact(4) + Names().Length + unused;
      }
      static void Main() { Console.WriteLine(Run(1)); Func<int, int> next = static x => x + 1; Console.WriteLine(next(1)); }
    }`);
  assert.deepEqual(lines, ['50', '2']);
});

test('SF-A02-T68 a static local function cannot capture locals, parameters or this (CS8421, CS8422)', () => {
  assert.deepEqual(errorsOf(inMethod('static int F() => local + parameter; F();')), ['CS8421 local', 'CS8421 parameter']);
  assert.deepEqual(errorsOf(inMethod('static int F() { local = 3; return 0; } F();')), ['CS8421 local']);
  assert.deepEqual(errorsOf(inMethod('static int F() => field; F();')), ['CS8422 field']);
  assert.deepEqual(errorsOf(inMethod('static int F() => this.field; F();')), ['CS8422 this']);
  assert.deepEqual(errorsOf(inMethod('static string F() => base.ToString(); F();')), ['CS8422 base']);
  assert.deepEqual(errorsOf(inMethod('static void F() { Helper(); } F();', 'void Helper() { }')), ['CS8422 Helper']);
  assert.deepEqual(errorsOf(inMethod('static int F() => shared; F();')), []);
});

test('SF-A02-T68 a capture is reported for the innermost static function, also through nested functions', () => {
  assert.deepEqual(errorsOf(inMethod('static int F() { int Inner() => local; return Inner(); } F();')), ['CS8421 local']);
  assert.deepEqual(errorsOf(inMethod('static Func<int> F() => () => local; F();')), ['CS8421 local']);
  // A function declared inside the static function captures the static function's own variables freely.
  assert.deepEqual(errorsOf(inMethod('static int F() { int own = 1; int Inner() => own; Func<int> g = () => own; return Inner() + g(); } F();')), []);
});

test('SF-A02-T68 a static function cannot reference a non-static local function, called or converted', () => {
  const functions = 'int Plain() => 1; static int Fixed() => 2;';
  assert.deepEqual(errorsOf(inMethod(`${functions} static int F() => Plain(); F();`)), ['CS8421 Plain()']);
  assert.deepEqual(errorsOf(inMethod(`${functions} static int F() { Func<int> g = Plain; return g(); } F();`)), ['CS8421 Plain']);
  assert.deepEqual(errorsOf(inMethod(`${functions} static int F() => Fixed() + F(); F(); Plain();`)), []);
});

test('SF-A02-T68 a static anonymous function reports CS8820 and CS8821', () => {
  assert.deepEqual(errorsOf(inMethod('Func<int> f = static () => local; f();')), ['CS8820 local']);
  assert.deepEqual(errorsOf(inMethod('Func<int> f = static delegate { return parameter; }; f();')), ['CS8820 parameter']);
  assert.deepEqual(errorsOf(inMethod('Func<int> f = static () => field; f();')), ['CS8821 field']);
  assert.deepEqual(errorsOf(inMethod('Func<Func<int>> f = static () => () => local; f();')), ['CS8820 local']);
  assert.deepEqual(errorsOf(inMethod('Func<int, int> f = static x => x + shared; f(1);')), []);
});

test('SF-A02-T68 nameof in a static function is not a capture', () => {
  assert.deepEqual(errorsOf(inMethod('static string F() => nameof(local) + nameof(parameter) + nameof(field); F();')), []);
});

test('SF-A02-T68 using declarations are disposed in reverse order when their block ends', () => {
  const lines = linesOf(`using System;
    class R : IDisposable {
      string name;
      public R(string name) { this.name = name; Console.WriteLine("open " + name); }
      public void Dispose() { Console.WriteLine("close " + name); }
    }
    class Program {
      static void Main() {
        using var a = new R("a");
        { using R b = new R("b"), c = new R("c"); Console.WriteLine("inner"); }
        using R none = null;
        Console.WriteLine("end");
      }
    }`);
  assert.deepEqual(lines, ['open a', 'open b', 'open c', 'inner', 'close c', 'close b', 'end', 'close a']);
});

test('SF-A02-T68 a using declaration needs an initializer and a disposable type', () => {
  assert.deepEqual(errorsOf(inMethod('using R d;')), ['CS0210 d']);
  assert.deepEqual(errorsOf(inMethod('using (R d) { }')), ['CS0210 d']);
  // Roslyn reports a using declaration on the whole statement and a using statement on its declaration.
  assert.deepEqual(errorsOf(inMethod('using var o = new Program();')), ['CS1674 using var o = new Program();']);
  assert.deepEqual(errorsOf(inMethod('using (var o = new Program()) { }')), ['CS1674 var o = new Program()']);
});

test('SF-A02-T68 a goto cannot jump over a using declaration (CS8648, CS8649)', () => {
  assert.deepEqual(errorsOf(inMethod('if (args == null) goto After; using var r = new R(); After: local++;')), ['CS8648 goto After;']);
  assert.deepEqual(errorsOf(inMethod('Before: local++; using var r = new R(); if (args == null) goto Before;')), ['CS8649 goto Before;']);
  // Leaving the block of the using declaration backwards is allowed: the resource is disposed on the way out.
  assert.deepEqual(errorsOf(inMethod('Outer: local++; { using var r = new R(); if (args == null) goto Outer; }')), []);
  // A jump that does not cross the declaration is allowed.
  assert.deepEqual(errorsOf(inMethod('using var r = new R(); if (args == null) goto After; local++; After: local++;')), []);
});

test('SF-A02-T68 using accepts a ref struct with an accessible void Dispose, from C# 8', () => {
  const program = (type, statement) => `${type} struct Marker { } class Program { static void Main() { ${statement} } }`;
  const disposable = 'ref struct RS { public void Dispose() { } }';
  assert.deepEqual(errorsOf(program(disposable, 'using (var r = new RS()) { } using var q = new RS(); using (new RS()) { }')), []);
  const gated = compile(program(disposable, 'using (var r = new RS()) { }'), { langVersion: '7.3' }).diagnostics.filter(d => d.code === 'CS8370');
  assert.equal(gated.length, 1);
  assert.match(gated[0].message, /'pattern-based disposal'/);
  // Not a pattern: a private or non-void Dispose, an extension method, and any type that is not a ref struct.
  assert.deepEqual(errorsOf(program('ref struct RS { void Dispose() { } }', 'using (var r = new RS()) { }')), ['CS1674 var r = new RS()']);
  assert.deepEqual(errorsOf(program('ref struct RS { public int Dispose() { return 0; } }', 'using (var r = new RS()) { }')), ['CS1674 var r = new RS()']);
  assert.deepEqual(errorsOf(program('class C { public void Dispose() { } }', 'using (var r = new C()) { }')), ['CS1674 var r = new C()']);
  assert.deepEqual(errorsOf(program('struct S { public void Dispose() { } }', 'using (var r = new S()) { }')), ['CS1674 var r = new S()']);
});
