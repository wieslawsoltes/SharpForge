import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf } from './support/semantic-codegen.js';
import { isThrowExpressionAllowed } from '../packages/compiler/src/binder/csharp70.js';
import { mapArguments } from '../packages/compiler/src/overload/arguments.js';

// SF-A02-T64 and SF-A02-T65: throw expressions, task-like return types, the default literal, `in` overloads,
// non-trailing named arguments and the C# 7.3 constraints.

/** The C# errors of a program as `code text`, where text is the source the diagnostic covers. */
function errorsOf(source, options = {}) {
  return compile(source, options)
    .diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code))
    .map(d => `${d.code} ${source.slice(d.start, d.start + d.length)}`);
}
// `Marker` is outside the execution profile, so every program here is bound by the semantic binder.
const program = (members, statements = '') =>
  `using System; using System.Threading.Tasks; struct Marker { }
   class Program { ${members} static void Main(string[] args) { ${statements} } }`;

// ---- SF-A02-T64 ----

test('SF-A02-T64 throw expressions run in ?:, ?? and expression bodies', () => {
  const lines = linesOf(`using System;
    class Program {
      static string name;
      static string Name { get => name; set => name = value ?? throw new Exception("null value"); }
      static int Pick(bool b) => b ? 1 : throw new Exception("no");
      static int Never() => throw new Exception("never");
      static void Act() => throw new Exception("act");
      static void Main() {
        Name = "x"; Console.WriteLine(Name + Pick(true));
        try { Pick(false); } catch (Exception e) { Console.WriteLine(e.Message); }
        try { Name = null; } catch (Exception e) { Console.WriteLine(e.Message); }
        try { Never(); } catch (Exception e) { Console.WriteLine(e.Message); }
        try { Act(); } catch (Exception e) { Console.WriteLine(e.Message); }
        Action g = () => throw new Exception("action");
        try { g(); } catch (Exception e) { Console.WriteLine(e.Message); }
      }
    }`);
  assert.deepEqual(lines, ['x1', 'no', 'null value', 'never', 'act', 'action']);
});

test('SF-A02-T64 a throw expression is allowed only where control can leave an expression (CS8115)', () => {
  assert.deepEqual(errorsOf(program('', 'var a = throw new Exception();')), ['CS8115 throw']);
  assert.deepEqual(errorsOf(program('static void M(int x) { }', 'M(throw new Exception());')), ['CS8115 throw']);
  assert.deepEqual(errorsOf(program('', 'int b = (throw new Exception()) + 1;')), ['CS8115 throw']);
  assert.deepEqual(errorsOf(program('', 'int d = args.Length > 0 ? throw new Exception() : throw new Exception(); object e = args ?? throw null;')), []);
});

test('SF-A02-T64 the operand of a throw expression must be an exception', () => {
  assert.deepEqual(errorsOf(program('', 'int f = args.Length > 0 ? 1 : throw new object();')), ['CS0266 new object()']);
  assert.deepEqual(errorsOf(program('', 'int g = args.Length > 0 ? 1 : throw "s";')), ['CS0029 "s"']);
});

test('SF-A02-T64 a void expression body may be a throw expression', () => {
  assert.deepEqual(errorsOf(program('static void Act() => throw new Exception("a");', 'Action g = () => throw new Exception(); g(); Act();')), []);
});

test('SF-A02-T64 isThrowExpressionAllowed names the allowed parents', () => {
  const allowed = (parent, slot) => {
    const syntax = { kind: 'ThrowExpression' };
    syntax.parent = { kind: parent, [slot]: syntax };
    return isThrowExpressionAllowed(syntax);
  };
  assert.equal(allowed('ConditionalExpression', 'whenTrue'), true);
  assert.equal(allowed('ConditionalExpression', 'whenFalse'), true);
  assert.equal(allowed('ConditionalExpression', 'condition'), false);
  assert.equal(allowed('CoalesceExpression', 'right'), true);
  assert.equal(allowed('CoalesceExpression', 'left'), false);
  assert.equal(allowed('ArrowExpressionClause', 'expression'), true);
  assert.equal(allowed('ParenthesizedLambdaExpression', 'expressionBody'), true);
  assert.equal(allowed('ParenthesizedExpression', 'expression'), false);
  assert.equal(allowed('Argument', 'expression'), false);
});

test('SF-A02-T64 an async method returns a task-like type; anything else is CS1983 alone', () => {
  const builder = `
    namespace System.Runtime.CompilerServices { class AsyncMethodBuilderAttribute : Attribute { public AsyncMethodBuilderAttribute(Type t) { } } }
    [System.Runtime.CompilerServices.AsyncMethodBuilder(typeof(Builder<>))] class MyTask<T> { }
    [System.Runtime.CompilerServices.AsyncMethodBuilder(typeof(Builder))] class MyTask { }
    class Builder<T> { } class Builder { } class Plain<T> { }`;
  const source = members => `using System; using System.Threading.Tasks; ${builder} class Program { ${members} static void Main() { } }`;
  assert.deepEqual(errorsOf(source('static async MyTask<int> A() { await Task.Delay(1); return 1; }')), []);
  assert.deepEqual(errorsOf(source('static async MyTask A() { await Task.Delay(1); }')), []);
  assert.deepEqual(errorsOf(source('static async MyTask<string> A() { await Task.Delay(1); return 1; }')), ['CS0029 1']);
  assert.deepEqual(errorsOf(source('static async Plain<int> B() { await Task.Delay(1); return 1; }')), ['CS1983 B']);
  assert.deepEqual(errorsOf(source('static async int C() { await Task.Delay(1); return 1; }')), ['CS1983 C']);
});

// ---- SF-A02-T65 ----

test('SF-A02-T65 the default literal takes the type it is converted to, on both back ends', () => {
  const lines = linesOf(`using System;
    class Program {
      static int M(int x = default, string s = default, bool b = default) { return x + (s == null ? 1 : 0) + (b ? 10 : 0); }
      static int Plus(int x) { return x + 1; }
      static int Zero() { return default; }
      static void Main() {
        int i = default; string s = default; bool b = default; double d = default;
        Console.WriteLine(i + " " + (s == null) + " " + b + " " + d + " " + (i == default) + " " + (s != default));
        Console.WriteLine(M() + " " + M(default, default) + " " + Plus(default) + " " + Zero() + " " + (b ? default : 5));
      }
    }`);
  assert.deepEqual(lines, ['0 True False 0 True False', '1 1 1 0 5']);
});

test('SF-A02-T65 the default literal converted to a simple or reference type is a constant', () => {
  assert.deepEqual(errorsOf(program('const int K = default; const string S = default; const bool B = default;', 'const double d = default; Console.WriteLine(d);')), []);
  assert.deepEqual(errorsOf(program('', 'switch (args.Length) { case 0: break; case default(int) + 1: break; }')), []);
  // A struct default is not a constant.
  assert.deepEqual(errorsOf(program('', 'const Marker m = default;')).map(e => e.split(' ')[0]), ['CS0283']);
});

test('SF-A02-T65 the default literal needs a target type (CS8716, CS8315, CS8310, CS8505)', () => {
  assert.deepEqual(errorsOf(program('', 'default.ToString();')), ['CS8716 default']);
  assert.deepEqual(errorsOf(program('', 'foreach (var x in default) { }')), ['CS8716 default']);
  assert.deepEqual(errorsOf(program('', 'lock (default) { }')), ['CS8716 default']);
  assert.deepEqual(errorsOf(program('', 'var h = default as string;')), ['CS8716 default']);
  assert.deepEqual(errorsOf(program('', 'bool i = (default) is int;')), ['CS8716 default']);
  assert.deepEqual(errorsOf(program('', 'int m = -default;')), ['CS8716 default']);
  assert.deepEqual(errorsOf(program('', 'var b = default == default;')), ['CS8315 default == default']);
  assert.deepEqual(errorsOf(program('', 'int c = default + 1;')), ['CS8310 default + 1']);
  assert.deepEqual(errorsOf(program('', 'object o = args; if (o is default) { }')), ['CS8505 default']);
  assert.deepEqual(errorsOf(program('', 'switch (args.Length) { case default: break; }')), ['CS8505 default']);
  assert.deepEqual(errorsOf(program('', 'int g = (default); bool e = g == default; Console.WriteLine(e);')), []);
});

test('SF-A02-T65 a by-value parameter is better than an in parameter for an argument without a modifier', () => {
  const lines = linesOf(`using System;
    class Program {
      static string M(int x) => "val";
      static string M(in int x) => "in";
      static string N(in int x) => "in" + x;
      static void Main() { int a = 1; Console.WriteLine(M(a) + M(in a) + M(5) + N(a) + N(5) + N(in a)); }
    }`);
  assert.deepEqual(lines, ['valinvalin1in5in1']);
});

test('SF-A02-T65 an in argument must be a variable (CS8156)', () => {
  const members = 'static void N(in int x) { }';
  assert.deepEqual(errorsOf(program(members, 'N(in 5);')), ['CS8156 5']);
  assert.deepEqual(errorsOf(program(members, 'int a = 1; N(in a + 1);')), ['CS8156 a + 1']);
  assert.deepEqual(errorsOf(program(members, 'const int c = 3; N(in c);')), ['CS8156 c']);
  assert.deepEqual(errorsOf(program(members, 'int a = 1; int[] b = { 1 }; N(in a); N(in b[0]); N(a + 1); N(5);')), []);
});

test('SF-A02-T65 a named argument out of position cannot be followed by a positional one (CS8323)', () => {
  const members = 'static int M(int a, int b, int c) { return a * 100 + b * 10 + c; }';
  assert.deepEqual(errorsOf(program(members, 'M(b: 1, 2, 3);')), ['CS8323 b']);
  assert.deepEqual(errorsOf(program(members, 'M(1, a: 2, 3);')), ['CS8323 a']);
  assert.deepEqual(errorsOf(program(members, 'M(a: 1, a: 2, 3);')), ['CS8323 a']);
  assert.deepEqual(errorsOf(program(members, 'M(a: 1, 2, 3); M(1, b: 2, 3); M(c: 3, a: 1, b: 2);')), []);
  // Without a positional argument after it the older rules apply.
  assert.deepEqual(errorsOf(program(members, 'M(1, 2, a: 3);')), ['CS1744 a']);
  assert.deepEqual(errorsOf(program(members, 'M(1, b: 2, b: 3);')), ['CS1740 b']);
  const parameters = ['a', 'b', 'c'].map(name => ({ name }));
  assert.equal(mapArguments(parameters, [{ name: 'b' }, {}, {}]).error.kind, 'badNonTrailingName');
  assert.deepEqual(mapArguments(parameters, [{ name: 'a' }, {}, {}]).parameterOf, [0, 1, 2]);
  assert.deepEqual(mapArguments(parameters, [{ name: 'c' }, { name: 'a' }, { name: 'b' }]).parameterOf, [2, 0, 1]);
});

test('SF-A02-T65 below C# 7.2 a positional argument after a named one is CS1738', () => {
  const source = program('static int M(int a, int b, int c) { return a + b + c; }', 'M(a: 1, 2, 3); M(1, 2, c: 3); M(c: 3, a: 1, b: 2);');
  const reported = compile(source, { langVersion: '7.1' }).diagnostics.filter(d => d.code === 'CS1738');
  assert.deepEqual(reported.map(d => source.slice(d.start, d.start + d.length)), ['2']);
  assert.match(reported[0].message, /language version 7\.2 or greater/);
  assert.deepEqual(compile(source, { langVersion: '7.2' }).diagnostics.filter(d => d.code === 'CS1738'), []);
});

test('SF-A02-T65 Enum, Delegate and unmanaged constraints: rules and C# 7.3 gates', () => {
  const generic = `using System; enum Color { Red } struct Pair<T> { public T A; } struct HasRef { public string S; }
    class Program {
      static void E<T>(T v) where T : Enum { }
      static void U<T>(T v) where T : unmanaged { }
      static void D<T>(T d) where T : Delegate { }
      static void Main() { STATEMENTS }
    }`;
  const use = statements => generic.replace('STATEMENTS', statements);
  assert.deepEqual(errorsOf(use('E(Color.Red); U(3); U(Color.Red); U(new Pair<int>()); D<Action>(Main);')), []);
  assert.deepEqual(errorsOf(use('E(3);')), ['CS0315 E']);
  assert.deepEqual(errorsOf(use('U("s"); U(new HasRef()); U(new Pair<string>()); U<int?>(null);')), ['CS8377 U', 'CS8377 U', 'CS8377 U', 'CS8377 U<int?>']);
  const gates = compile(use(''), { langVersion: '7.2' }).diagnostics.filter(d => d.code === 'CS8320');
  assert.deepEqual(gates.map(d => d.message.match(/'([^']+)'/)[1]).sort(), [
    'delegate generic type constraints',
    'enum generic type constraints',
    'unmanaged generic type constraints',
  ]);
  const constructed = compile(use('U(new Pair<int>());'), { langVersion: '7.3' }).diagnostics.filter(d => d.code === 'CS8370');
  assert.equal(constructed.length, 1);
  assert.match(constructed[0].message, /'unmanaged constructed types'/);
});

test('SF-A02-T65 constraint clause rules of unmanaged type parameters (CS8375, CS8379, CS0456)', () => {
  const clause = text => errorsOf(`using System; ${text} class Program { static void Main() { } }`);
  assert.deepEqual(clause('class C<T> where T : unmanaged, new() { }'), ['CS8375 new']);
  assert.deepEqual(clause('class C<T, U> where T : unmanaged where U : T { }'), ['CS8379 U']);
  assert.deepEqual(clause('class C<T, U> where T : struct where U : T { }'), ['CS0456 U']);
  assert.deepEqual(clause('class C<T, U> where T : class where U : T { }'), []);
});
