import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { SemanticAnalysis } from '../packages/compiler/src/semantic-analysis.js';
import { unionInputs, unionPreviewOptions } from './fixtures/compiler-unions/contracts.js';
import { runUnion as run, unionNativeSkip } from './fixtures/compiler-unions/native-test.js';

const analyze = source => {
  const files = unionInputs(source).map(file => parse(new SourceText(file.text, file.uri), undefined, { languageVersion: 'preview' }));
  const analysis = new SemanticAnalysis(files, unionPreviewOptions);
  analysis.run();
  return analysis.diagnostics;
};
const relevant = (source, codes) => analyze(source).filter(diagnostic => codes.includes(diagnostic.code));

test('standard implicit case conversions work and user or union conversions cannot be chained', { skip: unionNativeSkip }, () => {
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

test('an applicable user-defined conversion operator shadows a union conversion, including explicit casts', { skip: unionNativeSkip }, () => {
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

test('logical patterns preserve or change value sources according to the pinned proposal', { skip: unionNativeSkip }, () => {
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

test('union member providers use their factories and interface getters for real structs', { skip: unionNativeSkip }, () => {
  assert.equal(run(`using System;
[System.Runtime.CompilerServices.Union]
struct Provided : Provided.IUnionMembers
{
    private object contents;
    private Provided(object value, bool marker) { contents = value; }
    public interface IUnionMembers
    {
        public static Provided Create(int value) => new Provided(value, true);
        public static Provided Create(string value) => new Provided(value, true);
        object Value { get; }
    }
    object IUnionMembers.Value => contents;
}
class Program
{
    static void Main()
    {
        Provided number = 12;
        Provided text = "provider";
        Console.WriteLine(number is int found && found == 12);
        Console.WriteLine(text is "provider");
    }
}`), 'True\nTrue\n');
});

test('union construction uses normal overload selection including in parameters and explicit ambiguity diagnostics', { skip: unionNativeSkip }, () => {
  assert.equal(run(`using System;
[System.Runtime.CompilerServices.Union]
struct U { public U(in int value) { Value = value; } public object Value { get; } }
class Program { static void Main() { U value = 3; Console.WriteLine(value is 3); } }`), 'True\n');
  const ambiguous = 'union U(string, System.Exception); class C { U Make() => (U)null; }';
  assert.equal(relevant(ambiguous, ['CS0121']).length, 1);
  const noncreation = `[System.Runtime.CompilerServices.Union]
    struct U { public U(long value) { } public U(int value, bool marker = true) { } public object Value => 1; }
    class C { U Make() => (U)1; }`;
  assert.equal(relevant(noncreation, ['SF2203']).length, 1);
});

test('null patterns unwrap both a nullable union and its contained value', { skip: unionNativeSkip }, () => {
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

test('typed recursive patterns use case members and case-incompatible types are errors', { skip: unionNativeSkip }, () => {
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
  assert.equal(relevant('union U(object); class C { int Match(U value) => value switch { string => 1 }; }', ['CS8509']).length, 1);
  assert.equal(relevant('union U(object); class C { int Match(U value) => value switch { string => 1, string => 2 }; }', ['CS8510']).length, 1);
});

test('union switch statements and goto case use the same constant-pattern value space', { skip: unionNativeSkip }, () => {
  assert.equal(run(`using System;
union U(int, string);
class Program
{
    static void Main()
    {
        U value = 1;
        switch (value)
        {
            case 1: goto case 2;
            case 2: Console.WriteLine("case"); break;
            case string text: Console.WriteLine(text); break;
        }
    }
}`), 'case\n');
  const duplicate = 'union U(int); class C { void M(U value) { switch (value) { case 1: break; case 1: break; } } }';
  assert.equal(relevant(duplicate, ['CS0152']).length, 1);
  assert.deepEqual(relevant(duplicate, ['CS8120']), []);
});

test('direct non-boxing access is preferred and read only once across switch alternatives', { skip: unionNativeSkip }, () => {
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

test('nullable flow distinguishes an absent union from present null contents and respects custom Value annotations', () => {
  const source = `#nullable enable
[System.Runtime.CompilerServices.Union]
class U { public U(int value) { } public object Value => 1; }
class C
{
    int MissingOuter(U? value) => value switch { {} => 1 };
    int Complete(U? value) => value switch { {} => 1, null => 2 };
    void Copy(U? value) { if (value is var copy) copy.Value.ToString(); }
}`;
  assert.equal(relevant(source, ['CS8655']).length, 1);
  assert.equal(relevant(source, ['CS8602']).length, 1);
  const custom = `#nullable enable
    [System.Runtime.CompilerServices.Union] struct U { public U(int value) { } public object Value => 1; }
    class C { int Match() => default(U) switch { int => 1 }; }`;
  assert.deepEqual(relevant(custom, ['CS8655']), []);
});

test('obsolete and experimental optional non-boxing accessors are ignored without calling them', { skip: unionNativeSkip }, () => {
  assert.equal(run(`using System;
[System.Runtime.CompilerServices.Union]
struct U
{
    public U(int value) { Value = value; }
    public object Value { get; }
    [Obsolete("ignored", true)] public bool HasValue => throw new Exception();
    [System.Diagnostics.CodeAnalysis.Experimental("UNION001")]
    public bool TryGetValue(out int value) { value = 0; throw new Exception(); }
}
class Program { static void Main() { U value = 3; Console.WriteLine(value is 3); Console.WriteLine(value is not null); } }`), 'True\nTrue\n');
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
  const nullableQuery = `#nullable enable
    [System.Runtime.CompilerServices.Union] struct U
    { public U(int value) { } public object? Value => 1; public bool TryGetValue(out string? value) { value = null; return false; } }
    class C { void M(U value) { if (value.TryGetValue(out string? text)) value.Value.ToString(); } }`;
  assert.ok(relevant(nullableQuery, ['SF2202']).some(diagnostic => /non-case out type/.test(diagnostic.message)));
  const definite = `[System.Runtime.CompilerServices.Union] struct U
    { private U(int value) { } public object Value => 1; } class C { bool M(U value) => value is int; }`;
  assert.deepEqual(relevant(definite, ['SF2202']), [], 'a specified public-API violation is SF2203, not an unresolved question');
  assert.ok(relevant(definite, ['SF2203']).length);
});
