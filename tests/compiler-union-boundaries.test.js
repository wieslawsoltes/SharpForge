import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { SemanticAnalysis } from '../packages/compiler/src/semantic-analysis.js';
import { unionInputs, unionPreviewOptions } from './fixtures/compiler-unions/contracts.js';
import { runUnion, unionNativeSkip } from './fixtures/compiler-unions/native-test.js';

const diagnostics = source => {
  const files = unionInputs(source).map(file => parse(new SourceText(file.text, file.uri), undefined, { languageVersion: 'preview' }));
  const analysis = new SemanticAnalysis(files, unionPreviewOptions);
  analysis.run();
  return analysis.diagnostics;
};

test('union creation overloads respect the accessibility of additional constructors', { skip: unionNativeSkip }, () => {
  assert.equal(runUnion(`using System;
union U(long) { private U(int value, bool marker = true) : this((long)value) { } }
class Program
{
    static void Print(U value) => Console.WriteLine(value is long);
    static void Main() { U value = 1; Print(2); Console.WriteLine(value is 1L); }
}`), 'True\nTrue\n');
  const source = `union U(long)
    { private U(int value, bool marker = true) : this((long)value) { } static U Make(int value) => value; }`;
  assert.equal(diagnostics(source).filter(row => row.code === 'SF2203').length, 1,
    'an accessible non-creation constructor that wins overload resolution remains an error');
});

test('a ref-returning basic Value getter is read as a value for union patterns', { skip: unionNativeSkip }, () => {
  assert.equal(runUnion(`using System;
[System.Runtime.CompilerServices.Union]
class U
{
    private object contents;
    public U(int value) { contents = value; }
    public ref object Value => ref contents;
}
class Program { static void Main() { U value = 3; Console.WriteLine(value is 3); Console.WriteLine(value is not null); } }
`), 'True\nTrue\n');
});

test('direct Value compatibility stays explicit for logical and constant pattern leaves', () => {
  for (const pattern of ['long', '1L', 'long or int', 'not long']) {
    const source = `union U(int, string); class C { bool M(U value) => value is { Value: ${pattern} }; }`;
    assert.ok(diagnostics(source).some(row => row.code === 'SF2202' && /direct Value/.test(row.message)), pattern);
  }
});

test('or patterns narrow the original nullable union only when both branches keep that value source', { skip: unionNativeSkip }, () => {
  assert.equal(runUnion(`using System;
union U(int, string);
class Program
{
    static void Main()
    {
        U? value = 1;
        if (value is ({} or {}) and var present)
        {
            object contents = present.Value;
            Console.WriteLine(contents is int);
        }
        Console.WriteLine(value is (1 or 2) and var kept && kept.Value.Value is int);
    }
}`), 'True\nTrue\n');
});

test('union switch flow carries failed null patterns into later arms and sections', () => {
  const source = `#nullable enable
union U(int, string?);
class C
{
    int Expression(U value) => value switch { null => 0, _ => value.Value.GetHashCode() };
    void Statement(U value)
    {
        switch (value)
        {
            case int: value.Value.GetHashCode(); break;
            case null: break;
            default: value.Value.GetHashCode(); break;
        }
    }
}`;
  assert.deepEqual(diagnostics(source).filter(row => row.code === 'CS8602'), []);
});
