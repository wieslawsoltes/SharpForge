/**
 * SF-A02-T72: module initializers, [SkipLocalsInit] and covariant returns. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/csharp9-rules.js; these tests cover compiler options, several files
 * and the stated limits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { VirtualMachine } from '@sharpforge/runtime';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

// The C# errors; a program outside the execution profile also keeps the profile's own (SFxxxx) diagnostics.
const errors = result => result.diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS')).map(d => d.code);

test('SF-A02-T72 module initializers of several files run in file order, before Main', () => {
  const result = compile([
    { uri: 'a.cs', text: 'using System;\nclass A { [System.Runtime.CompilerServices.ModuleInitializer] public static void I() { Console.WriteLine("a"); } }\n' },
    { uri: 'b.cs', text: 'using System;\nclass B { [System.Runtime.CompilerServices.ModuleInitializer] public static void I() { Console.WriteLine("b"); } }\n' },
    { uri: 'main.cs', text: 'using System;\nclass P { static void Main() { Console.WriteLine("main"); } }\n' },
  ]);
  assert.deepEqual(errors(result), []);
  assert.equal(new VirtualMachine(result.image).run().output, 'a\nb\nmain\n');
});

test('SF-A02-T72 an invalid module initializer is not run and no image is produced', () => {
  const result = compile(`using System.Runtime.CompilerServices;
class M { [ModuleInitializer] static void Hidden() { } }
class P { static void Main() { } }
`);
  assert.deepEqual(errors(result), ['CS8814']);
  assert.equal(result.image, null);
});

test('SF-A02-T72 [SkipLocalsInit] needs allowUnsafe; with it the program runs (locals stay zero-initialized)', () => {
  const source = `using System;
using System.Runtime.CompilerServices;
class P { [SkipLocalsInit] static void Main() { int[] values = new int[2]; Console.WriteLine(values[1]); } }
`;
  assert.deepEqual(errors(compile(source)), ['CS0227']);
  assert.deepEqual(linesOf(source, { allowUnsafe: true }), ['0']);
});

test('SF-A02-T72 a covariant override gives calls its return type; limit: class hierarchies are not executable', () => {
  const source = `class A { public virtual A Clone() => new A(); }
class B : A { public override B Clone() => new B(); public int Tag = 7; }
class P { static void Main() { System.Console.WriteLine(new B().Clone().Tag); } }
`;
  assert.match(notExecutable(source).message, /class inheritance|virtual/);
  assert.deepEqual(errors(compile(source, { langVersion: '8' })).includes('CS8400'), true);
});

test('SF-A02-T72 a single parameter named _ is still a name; two are discards', () => {
  const program = body => `using System;\nclass P { static void Main() { ${body} } }\n`;
  assert.deepEqual(errors(compile(program('Func<int, int> f = _ => _ + 1; Console.WriteLine(f(1));'))), []);
  assert.deepEqual(errors(compile(program('Func<int, int, int> f = (_, _) => _;'))), ['CS0103']);
  // An outer variable named _ is what `_` means inside a lambda whose own parameters are discards.
  assert.deepEqual(linesOf(program('int _ = 3; Func<int, int, int> f = (_, _) => 5; Console.WriteLine(f(1, 2) + _);')), ['8']);
});
