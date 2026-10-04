/**
 * SF-A02-T76: C# 11 rules. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/csharp11-rules.js; these tests cover several files, boundary cases
 * of the unsigned shift lowering and the stated limits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { linesOf } from './support/semantic-codegen.js';

const errors = result => result.diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS')).map(d => `${d.code} ${d.uri}`);
const file = (uri, text) => ({ uri, text });

test('SF-A02-T76 file-local types of two files with the same name do not collide and each file sees its own', () => {
  const files = [
    file('a.cs', 'file class Helper { public static string Name() => "from a"; }\nclass A { public static string Get() => Helper.Name(); }\n'),
    file('b.cs', 'file class Helper { public static string Name() => "from b"; }\nclass B { public static string Get() => Helper.Name(); }\n'),
    file('main.cs', 'using System;\nclass Program { static void Main() { Console.WriteLine(A.Get()); Console.WriteLine(B.Get()); } }\n'),
  ];
  const result = compile(files);
  assert.deepEqual(errors(result), []);
  assert.equal(new VirtualMachine(result.image).run().output, 'from a\nfrom b\n');
  const il = compileToIL(files, { includeDebug: false });
  assert.ok(il.assembly, il.diagnostics.map(d => d.message).join('; '));
  assert.equal(new CilVirtualMachine(il.assembly).run().output, 'from a\nfrom b\n');
  const names = result.image.types.map(type => type.name).filter(name => name.includes('Helper'));
  assert.equal(new Set(names).size, 2, names.join(', '));
});

test('SF-A02-T76 a file-local type is unknown in another file', () => {
  const result = compile([
    file('a.cs', 'file class Helper { }\nclass A { }\n'),
    file('b.cs', 'class Program { static void Main() { var h = new Helper(); } }\n'),
  ]);
  assert.deepEqual(errors(result), ['CS0246 b.cs']);
});

test('SF-A02-T76 the unsigned shift takes its count modulo 32 and evaluates its operands once, left first', () => {
  const source = `using System;
class Program {
  static string order = "";
  static int L(int v) { order += "L"; return v; }
  static int R(int v) { order += "R"; return v; }
  static void Main() {
    int min = -2147483647 - 1;
    for (int count = 0; count <= 33; count += 11) Console.WriteLine(min >>> count);
    Console.WriteLine(L(-1) >>> R(24));
    Console.WriteLine(order);
  }
}
`;
  assert.deepEqual(linesOf(source), ['-2147483648', '1048576', '512', '1073741824', '255', 'LR']);
});

test('SF-A02-T76 without a checked operator a checked context uses the unchecked one', () => {
  const source = `using System;
class V { public int X; public V(int x) { X = x; } public static V operator +(V a, V b) => new V(a.X + b.X); }
class Program { static void Main() { Console.WriteLine(checked(new V(1) + new V(2)).X); } }
`;
  assert.deepEqual(linesOf(source), ['3']);
});

// Until the scalar modes of #3582 this was a stated limit (SF2200). The expected lines are what .NET 10.0.201 prints;
// the Roslyn-pinned fixture is unsigned-right-shift/wide-and-unsigned-operands.
test('SF-A02-T76 the unsigned shift of a 64-bit or unsigned operand zero-fills and takes its count modulo the width', () => {
  const source = `class Program {
  static void Main(string[] a) {
    long zero = a.Length;
    System.Console.WriteLine(zero >>> 1);
    long negative = -8;
    System.Console.WriteLine(negative >>> 1);
    System.Console.WriteLine(negative >>> 65);
    uint wide = 4000000000;
    System.Console.WriteLine(wide >>> 3);
    System.Console.WriteLine(wide >>> 33);
    ulong all = 18446744073709551615;
    System.Console.WriteLine(all >>> 60);
  }
}
`;
  assert.deepEqual(linesOf(source), ['0', '9223372036854775804', '9223372036854775804', '500000000', '2000000000', '15']);
});
