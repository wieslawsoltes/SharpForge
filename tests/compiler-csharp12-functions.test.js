/**
 * SF-A02-T75 / SF-A02-T80: synthesized delegate types, lambda defaults and `params`, `ref readonly` arguments, the
 * interceptors policy and inline array access. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/csharp12-functions.js; these tests cover messages, boundaries and the
 * stated limits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

const reported = (source, options) =>
  compile(source, options)
    .diagnostics.filter(d => d.code.startsWith('CS'))
    .map(d => `${d.code}@${source.slice(d.start, d.start + d.length)}`);
const messageOf = (source, code, options) => compile(source, options).diagnostics.find(d => d.code === code)?.message;

test('SF-A02-T80 a lambda with defaults or params has a synthesized delegate type whose calls fill in the arguments', () => {
  const source = `using System;
interface IMarker { }
class Program {
  static void Main() {
    var add = (int x, int y = 10) => x + y;
    var count = (string head, params string[] rest) => head + rest.Length;
    var same = (int x, int y = 10) => x * y;
    Console.WriteLine(add(1) + " " + add(1, 2));
    Console.WriteLine(count("a") + count("b", "c", "d"));
    add = same;
    Console.WriteLine(add(2));
  }
}
`;
  assert.deepEqual(linesOf(source), ['11 3', 'a0b2', '20']);
});

test('SF-A02-T75 natural types beyond Func and Action: five parameters, a method group with defaults', () => {
  const source = `using System;
interface IMarker { }
class Program {
  static int Six(int a, int b, int c, int d, int e, int f = 6) => a + b + c + d + e + f;
  static void Main() {
    var five = (int a, int b, int c, int d, int e) => a + b + c + d + e;
    var six = Six;
    Console.WriteLine(five(1, 2, 3, 4, 5) + " " + six(1, 1, 1, 1, 1) + " " + six(1, 1, 1, 1, 1, 1));
  }
}
`;
  assert.deepEqual(linesOf(source), ['15 11 6']);
});

test('SF-A02-T75 limit: a synthesized delegate type with a by-reference parameter binds but is not executable', () => {
  const source = `class Program {
  static void Main() { var bump = (ref int x) => x++; int v = 1; bump(ref v); System.Console.WriteLine(v); }
}
`;
  assert.deepEqual(reported(source), []);
  assert.match(notExecutable(source).message, /ref, out and in parameters/);
});

test('SF-A02-T80 two synthesized types are the same only when types, reference kinds, defaults and params agree', () => {
  const source = `class Program {
  static void Main() {
    var a = (int x, int y = 10) => x + y;
    var sameDefault = (int x, int y = 10) => x - y;
    var otherDefault = (int x, int y = 11) => x - y;
    var noDefault = (int x, int y) => x - y;
    var byRef = (ref int x) => x;
    var byIn = (in int x) => x;
    a = sameDefault;
    a = otherDefault;
    a = noDefault;
    byRef = byIn;
  }
}
`;
  assert.deepEqual(reported(source), ['CS0029@otherDefault', 'CS0029@noDefault', 'CS0029@byIn']);
});

test('SF-A02-T80 CS9099 and CS9100 name the parameter and both defaults', () => {
  const source = `using System;
class Program {
  delegate int WithDefault(int x = 5);
  static void Main() {
    WithDefault other = (int x = 6) => x;
    Func<int, int> none = (int x = 6) => x;
    Func<int[], int> f = (params int[] v) => 1;
    WithDefault same = (int x = 5) => x;
  }
}
`;
  assert.deepEqual(reported(source), ['CS9099@x', 'CS9099@x', 'CS9100@v']);
  const result = compile(source);
  assert.equal(result.diagnostics.find(d => d.code === 'CS9099').severity, 'warning');
  assert.deepEqual(
    result.diagnostics.filter(d => d.code === 'CS9099').map(d => d.message),
    [
      "Parameter 1 has default value '6' in lambda but '5' in the target delegate type.",
      "Parameter 1 has default value '6' in lambda but '<missing>' in the target delegate type.",
    ],
  );
});

test('SF-A02-T80 a delegate declared with a default value fills it in when invoked', () => {
  const source = `using System;
class Program {
  delegate int Scale(int value, int factor = 3);
  static void Main() { Scale s = (v, f) => v * f; Console.WriteLine(s(2) + " " + s(2, 5)); }
}
`;
  assert.deepEqual(linesOf(source), ['6 10']);
});

test('SF-A02-T80 ref readonly arguments: warnings for a missing modifier and for a value', () => {
  const source = `class Program {
  static void Read(ref readonly int value) { }
  static void Plain(in int value) { }
  static int Make() => 3;
  static void Main() { int local = 2; Read(ref local); Read(in local); Read(local); Read(Make()); Read(out local); Plain(ref local); }
}
`;
  assert.deepEqual(reported(source), ['CS9192@local', 'CS9193@Make()', 'CS1615@local', 'CS9191@local']);
  assert.equal(messageOf(source, 'CS9192'), "Argument 1 should be passed with 'ref' or 'in' keyword");
  // Below C# 12 `ref` for an `in` parameter is an error that names both versions.
  const older = 'class Program { static void Plain(in int v) { } static void Main() { int x = 1; Plain(ref x); } }\n';
  assert.deepEqual(reported(older, { langVersion: '11' }), ['CS9194@x']);
  assert.match(messageOf(older, 'CS9194', { langVersion: '11' }), /in language version 11\.0\. .* language version 12\.0 or greater/);
});

test('SF-A02-T80 interceptors are always rejected: a program with [InterceptsLocation] never compiles', () => {
  const attribute = `namespace System.Runtime.CompilerServices {
  [System.AttributeUsage(System.AttributeTargets.Method, AllowMultiple = true)]
  sealed class InterceptsLocationAttribute : System.Attribute { public InterceptsLocationAttribute(int version, string data) { } }
}
`;
  // 20 bytes of base64: a well-formed version 1 location, which only a project that enables the feature may use.
  const wellFormed = 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const source = `${attribute}namespace Generated.Code {
  static class Interceptors {
    [System.Runtime.CompilerServices.InterceptsLocation(1, "${wellFormed}")] public static void A() { }
    [System.Runtime.CompilerServices.InterceptsLocation(1, "short")] public static void B() { }
    [System.Runtime.CompilerServices.InterceptsLocation(3, "${wellFormed}")] public static void C() { }
  }
}
static class Global { [System.Runtime.CompilerServices.InterceptsLocation(1, "${wellFormed}")] public static void D() { } }
class Program { static void Main() { } }
`;
  const codes = compile(source)
    .diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS'))
    .map(d => d.code);
  assert.deepEqual(codes, ['CS9137', 'CS9231', 'CS9232', 'CS9206']);
  assert.equal(
    messageOf(source, 'CS9137'),
    "The 'interceptors' feature is not enabled in this namespace. " +
      "Add '<InterceptorsNamespaces>$(InterceptorsNamespaces);Generated.Code</InterceptorsNamespaces>' to your project.",
  );
  assert.equal(compile(source).image, null);
});

test('SF-A02-T80 inline array elements: bound as variables of the element type, gated below C# 12, not executable', () => {
  const source = `using System.Runtime.CompilerServices;
[InlineArray(4)] struct Buffer { private int element; }
[InlineArray(2)] struct Names { private string element; }
class Program {
  static void Main() {
    Buffer b = new Buffer(); Names n = new Names();
    b[0] = 2; b[1]++; n[1] = "x";
    int total = b[0] + n[1].Length;
    foreach (string name in n) total += name.Length;
    b[4] = 0; n[0] = 1;
  }
}
`;
  assert.deepEqual(reported(source), ['CS9166@4', 'CS0029@1']);
  const valid = source.replace(' b[4] = 0; n[0] = 1;', '');
  assert.deepEqual(reported(valid), []);
  assert.match(notExecutable(valid).message, /struct/);
  const gates = reported(valid, { langVersion: '11' }).filter(entry => entry.startsWith('CS9058'));
  assert.deepEqual(gates, ['CS9058@b[0]', 'CS9058@b[1]', 'CS9058@n[1]', 'CS9058@b[0]', 'CS9058@n[1]', 'CS9058@n']);
});
