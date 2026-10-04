import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '@sharpforge/compiler';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { SemanticAnalysis } from '../packages/compiler/src/semantic-analysis.js';
import { unionContracts, unionInputs, unionPreviewOptions } from './fixtures/compiler-unions/contracts.js';
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

test('union conversions and overload choice follow each file version in either input order', () => {
  const sources = [
    { uri: 'Preview.cs', text: `union U(int);
class Preview { static U Convert() => 1; static int Choose() => Api.Pick(1); }
class Api { public static int Pick(U value) => 1; public static int Pick(long value) => 2; }` },
    { uri: 'Stable.cs', text: 'class Stable { static U Convert() => 1; static int Choose() => Api.Pick(1); }' },
  ];
  for (const order of [sources, [...sources].reverse()]) {
    const input = [...order, { uri: 'UnionContracts.cs', text: unionContracts }];
    const options = { ...unionPreviewOptions, outputKind: 'library', langVersion: '14', langVersionByUri: { 'Preview.cs': 'preview' } };
    const files = input.map(file => parse(new SourceText(file.text, file.uri), undefined,
      { languageVersion: options.langVersionByUri[file.uri] ?? options.langVersion }));
    const analysis = new SemanticAnalysis(files, options);
    analysis.run();
    assert.deepEqual(analysis.diagnostics.filter(row => row.severity === 'error').map(row => [row.uri, row.code]).sort(),
      [['Preview.cs', 'CS0121'], ['Stable.cs', 'CS0029']]);
  }
});

test('implicit union conversions in expression trees keep the unresolved proposal boundary explicit', () => {
  const source = `union U(int);
class C { System.Linq.Expressions.Expression<System.Func<int, U>> Tree() => value => value; }`;
  const result = compileToAssembly(unionInputs(source), { ...unionPreviewOptions, outputKind: 'library' });
  assert.equal(result.success, false);
  assert.equal(result.assembly, null);
  assert.ok(result.diagnostics.some(row => row.code === 'SF2202' && /implicit union conversions in expression trees/.test(row.message)));
});

test('explicit union construction remains available in an expression tree', { skip: unionNativeSkip }, () => {
  assert.equal(runUnion(`using System;
using System.Linq.Expressions;
union U(int);
class Program
{
    static void Main()
    {
        Expression<Func<int, U>> tree = value => new U(value);
        Console.WriteLine(tree.Compile()(8).Value);
    }
}`), '8\n');
});
