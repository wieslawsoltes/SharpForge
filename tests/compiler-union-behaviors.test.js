import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '@sharpforge/compiler';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { SemanticAnalysis } from '../packages/compiler/src/semantic-analysis.js';
import { unionInputs, unionPreviewOptions } from './fixtures/compiler-unions/contracts.js';

const analyze = source => {
  const files = unionInputs(source).map(file => parse(new SourceText(file.text, file.uri), undefined, { languageVersion: 'preview' }));
  const analysis = new SemanticAnalysis(files, unionPreviewOptions);
  analysis.run();
  return analysis.diagnostics;
};
const relevant = (source, codes) => analyze(source).filter(diagnostic => codes.includes(diagnostic.code));
const run = source => {
  const compiled = compileToAssembly(unionInputs(source), unionPreviewOptions);
  assert.equal(compiled.success, true, compiled.diagnostics.map(diagnostic => diagnostic.code + ': ' + diagnostic.message).join('\n'));
  const result = new CilVirtualMachine(compiled.assembly, { maxInstructions: 100000 }).run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  return result.output;
};

test('standard implicit case conversions work and user or union conversions cannot be chained', () => {
  assert.equal(run(`using System;
union U(long, string);
class Program { static void Main() { int number = 23; U value = number; Console.WriteLine(value is long result && result == 23); } }`), 'True\n');
  const invalid = [
    'union U(int); class Program { static U Convert(long value) => (U)value; }',
    'union A(int); union B(A); class Program { static B Convert(int value) => value; }',
    'struct S { public static implicit operator int(S value) => 1; } union U(int); class Program { static U Convert(S value) => value; }',
  ];
  for (const source of invalid) assert.ok(relevant(source, ['CS0029', 'CS0030']).length, source);
});

test('an applicable user-defined conversion operator shadows a union conversion, including explicit casts', () => {
  assert.equal(run(`using System;
[System.Runtime.CompilerServices.Union]
struct U
{
    public U(int value) { Value = value; }
    public U(long value) { Value = value; }
    public U(string value) { Value = value; }
    public object Value { get; }
    public static implicit operator U(int value) => new U("implicit");
    public static explicit operator U(long value) => new U("explicit");
}
class Program
{
    static void Main()
    {
        U first = 1;
        U second = 2L;
        U third = (U)3L;
        Console.WriteLine(first is "implicit");
        Console.WriteLine(second is long);
        Console.WriteLine(third is "explicit");
    }
}`), 'True\nTrue\nTrue\n');
});

test('logical patterns preserve or change value sources according to the pinned proposal', () => {
  assert.equal(run(`using System;
union U(int, string);
class Program
{
    static void Main()
    {
        U value = 2;
        Console.WriteLine(value is int and > 0 and var number && number == 2);
        Console.WriteLine(value is not null and var kept && kept.Value != null);
        Console.WriteLine(value is (1 or 2) and var same && same.Value != null);
        Console.WriteLine(value is var whole && whole.Value != null);
        U empty = default;
        Console.WriteLine(empty is {});
        Console.WriteLine(empty is null);
        Console.WriteLine(value is { Value: int });
    }
}`), 'True\nTrue\nTrue\nTrue\nTrue\nTrue\nTrue\n');
});

test('null patterns unwrap both a nullable union and its contained value', () => {
  assert.equal(run(`using System;
union U(int, string);
class Program
{
    static void Main()
    {
        U? absent = null;
        U? empty = (string)null;
        U? present = 7;
        Console.WriteLine(absent is null);
        Console.WriteLine(empty is null);
        Console.WriteLine(present is int value && value == 7);
        Console.WriteLine(!(absent is int));
    }
}`), 'True\nTrue\nTrue\nTrue\n');
});

test('typed recursive patterns use case members and case-incompatible types are errors', () => {
  const types = 'class Cat { public string Name => "Fido"; } sealed class Dog { } union Pet(Cat, Dog);';
  assert.equal(run(`using System; ${types}
class Program { static void Main() { Pet pet = new Cat(); Console.WriteLine(pet is Cat { Name: "Fido" }); } }`), 'True\n');
  assert.ok(relevant(types + 'class C { bool Bad(Pet pet) => pet is Pet; }', ['CS8121']).length);
  assert.ok(relevant(types + 'class C { bool Bad(Pet pet) => pet is string; }', ['CS8121']).length);
  assert.ok(relevant(types + 'class C { bool Bad(Pet pet) => pet is { Name: "Fido" }; }', ['CS0117', 'CS1061']).length);
});

test('case coverage, relational partitions, overlap and guarded-arm diagnostics use the pattern algebra', () => {
  const program = arms => `union U(int, string); class C { int Match(U value) => value switch { ${arms} }; }`;
  assert.deepEqual(relevant(program('int => 1, string => 2'), ['CS8509', 'CS8510']), []);
  assert.deepEqual(relevant(program('>= 0 => 1, < 0 => 2, string => 3'), ['CS8509', 'CS8510']), []);
  assert.equal(relevant(program('int => 1'), ['CS8509']).length, 1);
  assert.equal(relevant(program('int => 1, string => 2, int => 3'), ['CS8510']).length, 1);
  assert.equal(relevant(program('int when false => 1, string => 2'), ['CS8846']).length, 1);
  assert.deepEqual(relevant('union U(object, string); class C { int Match(U value) => value switch { object => 1 }; }', ['CS8509']), []);
});

test('direct non-boxing access is preferred and read only once across switch alternatives', () => {
  assert.equal(run(`using System;
[System.Runtime.CompilerServices.Union]
struct U
{
    private int number;
    public static int Reads;
    public U(int value) { number = value; }
    public object Value => number;
    public bool HasValue => true;
    public bool TryGetValue(out int value) { Reads++; value = number; return true; }
}
class Program
{
    static void Main()
    {
        U value = 3;
        Console.WriteLine(value switch { 1 => 1, 2 => 2, int number => number });
        Console.WriteLine(U.Reads);
        Console.WriteLine(value is not null);
    }
}`), '3\n1\nTrue\n');
});

test('nullability tracks creation, copy, successful tests and unhandled null contents', () => {
  const source = `#nullable enable
union U(int, string?);
class C
{
    void Good(string? text)
    {
        U certain = 1;
        certain.Value.ToString();
        U copied = certain;
        copied.Value.ToString();
        U maybe = text;
        if (maybe is not null) maybe.Value.ToString();
        if (maybe is int) maybe.Value.ToString();
    }
    int Missing(U value) => value switch { int => 1, string => 2 };
    int Complete(U value) => value switch { int => 1, string => 2, null => 0 };
}`;
  assert.deepEqual(relevant(source, ['CS8602']), []);
  assert.equal(relevant(source, ['CS8655']).length, 1);
  assert.equal(relevant('#nullable enable\nunion U(int, string); class C { void M() { U value = default; value.Value.ToString(); } }', ['CS8602']).length, 1);
});

test('only unresolved custom-pattern, direct-Value and inherited-access questions retain SF2202', () => {
  const malformed = '[System.Runtime.CompilerServices.Union] struct U { public U(int value) { } }';
  assert.ok(relevant(malformed, ['SF2202']).some(diagnostic => /basic|mandatory/.test(diagnostic.message)));
  const direct = 'union U(int, string); class C { bool M(U value) => value is { Value: long }; }';
  assert.ok(relevant(direct, ['SF2202']).some(diagnostic => /direct Value/.test(diagnostic.message)));
  const inherited = `[System.Runtime.CompilerServices.Union] class U : Base
  { public U(int value) { } public object Value => 1; } class Base { public bool HasValue => true; }
  class C { bool M(U value) => value is int; }`;
  assert.ok(relevant(inherited, ['SF2202']).some(diagnostic => /non-boxing/.test(diagnostic.message)));
});
