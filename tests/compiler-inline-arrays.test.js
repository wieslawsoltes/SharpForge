import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';
import { inlineArrayShape } from '../packages/compiler/src/symbols/inline-arrays.js';

// C# 12 inline-array rules, following dotnet/csharplang proposals/csharp-12.0/inline-arrays.md.
// These are focused regression expectations, not a new Roslyn pin. The existing stress corpus has a Roslyn pin.
const prefix = `using System; using System.Runtime.CompilerServices;
[InlineArray(4)] public struct Quad { private int first; }
[InlineArray(3)] public struct Row<T> { private T first; }
`;

function bind(source, langVersion = '14') {
  return analyze([parse(new SourceText(source, 'Program.cs'), undefined, { languageVersion: langVersion })], { langVersion });
}

const codes = (source, version) => bind(source, version).diagnostics.filter(row => row.severity === 'error').map(row => row.code);
const program = (body, members = '') => `${prefix} class Program { ${members} static void Main() { ${body} } }`;

test('A02-T80 int/Index/Range uses and explicit/implicit span views bind as aliasing operations', () => {
  const source = program(`Quad value = default; Index last = ^1; Range middle = 1..^1;
    value[last] = 7; value[^2]++; Span<int> writable = value; ReadOnlySpan<int> readOnly = value;
    Span<int> slice = value[middle]; ReadOnlySpan<int> cast = (ReadOnlySpan<int>)value;
    ref int element = ref value[^1]; element = 9; Console.WriteLine(slice.Length + readOnly.Length + cast.Length);`);
  const result = bind(source);
  assert.deepEqual(result.diagnostics.filter(row => row.severity === 'error'), []);
  const main = result.assembly.types.find(type => type.name === 'Program').getMembers('Main')[0];
  const views = [];
  walk(result.bound.get(main), node => {
    if (node.kind === 'InlineArrayConversion') views.push(node);
    return true;
  });
  assert.equal(views.length, 3);
  assert.ok(views.every(node => node.length === 4 && node.operand.kind === 'Local'));
  assert.ok(views.every(node => node.conversion.isStandard && node.conversion.isImplicit));
});

test('A02-T80 generic inline-array shapes substitute their element type', () => {
  const source = program('Row<string> row = default; row[^1] = "last"; ReadOnlySpan<string> span = row;');
  const result = bind(source);
  assert.deepEqual(result.diagnostics.filter(row => row.severity === 'error'), []);
  const definition = result.assembly.types.find(type => type.name === 'Row');
  const quad = result.assembly.types.find(type => type.name === 'Quad');
  assert.equal(inlineArrayShape(definition).elementType, definition.typeParameters[0]);
  assert.equal(inlineArrayShape(quad).length, 4);
});

test('A02-T80 declarations reject explicit layout, readonly/volatile/required storage and record structs', () => {
  const entry = 'class Program { static void Main() { } }';
  for (const modifier of ['readonly', 'volatile', 'required']) {
    const source = `using System.Runtime.CompilerServices;
      [InlineArray(4)] public struct Invalid { public ${modifier} int first; } ${entry}`;
    assert.ok(codes(source).includes('CS9180'), modifier);
  }
  const explicit = `using System.Runtime.CompilerServices; using System.Runtime.InteropServices;
    [InlineArray(4), StructLayout(LayoutKind.Explicit)] public struct Invalid { [FieldOffset(0)] public int first; } ${entry}`;
  assert.ok(codes(explicit).includes('CS9168'));
  const record = `using System.Runtime.CompilerServices;
    [InlineArray(4)] public record struct Invalid { public int first; } ${entry}`;
  assert.ok(codes(record).includes('CS9259'));
});

test('A02-T80 ref-struct inline arrays produce the unsupported-language warning instead of a span shape', () => {
  const source = `using System.Runtime.CompilerServices;
    [InlineArray(2)] public ref struct Invalid { private int first; }
    class Program { static void Main() { } }`;
  const result = bind(source);
  assert.ok(result.diagnostics.some(row => row.code === 'CS9184' && row.severity === 'warning'));
  assert.equal(inlineArrayShape(result.assembly.types.find(type => type.name === 'Invalid')), null);
});

test('A02-T80 no element covariance or numeric conversion is part of an inline-array conversion', () => {
  assert.deepEqual(codes(program('Row<string> row = default; ReadOnlySpan<object> span = row;')), ['CS0029']);
  assert.deepEqual(codes(program('Quad value = default; Span<long> span = value;')), ['CS0029']);
});

test('A02-T80 readonly and temporary receivers reject writable span conversions and temporary slices', () => {
  assert.deepEqual(codes(program('', 'static void Read(in Quad value) { Span<int> span = value; }')), ['CS9164']);
  assert.deepEqual(codes(program('Span<int> span = new Quad();')), ['CS9164']);
  assert.deepEqual(codes(program('ReadOnlySpan<int> span = new Quad();')), ['CS9165']);
  assert.deepEqual(codes(program('var slice = new Quad()[..];')), ['CS9165']);
  assert.deepEqual(codes(program('', 'static void Read(in Quad value) { ReadOnlySpan<int> span = value[..]; }')), []);
});

test('A02-T80 compile-time integer and from-end bounds include zero-from-end and the lower edge', () => {
  for (const index of ['-1', '4', '^0', '^5']) {
    assert.deepEqual(codes(program(`Quad value = default; Console.WriteLine(value[${index}]);`)), ['CS9166'], index);
  }
  assert.deepEqual(codes(program('Quad value = default; Console.WriteLine(value[^4] + value[^1]);')), []);
  assert.deepEqual(codes(program('Quad value = default; Console.WriteLine(value[1L]);')), ['CS9172']);
  assert.deepEqual(codes(program('Quad value = default; Console.WriteLine(value[index: 0]);')), ['CS9173']);
});

test('A02-T80 readonly element writes and ref aliases fail; foreach references preserve readonly storage', () => {
  assert.deepEqual(codes(program('', 'static void Read(in Quad value) { value[0] = 1; }')), ['CS8331']);
  assert.deepEqual(codes(program('', 'static void Read(in Quad value) { ref int item = ref value[^1]; }')), ['CS8329']);
  assert.deepEqual(codes(program('Quad value = default; foreach (ref int item in value) item++;')), []);
  assert.deepEqual(codes(program('', 'static void Read(in Quad value) { foreach (ref readonly int item in value) Console.WriteLine(item); }')), []);
  assert.deepEqual(codes(program('', 'static void Read(in Quad value) { foreach (ref int item in value) item++; }')), ['CS8331']);
});

test('A02-T80 ref returns and span returns follow local, value-parameter and ref-parameter lifetimes', () => {
  const members = `static Span<int> View(ref Quad value) => value;
    static ReadOnlySpan<int> ReadView(in Quad value) => value[1..];
    static ref int Tail(ref Quad value) => ref value[^1];
    static ref readonly int Head(in Quad value) => ref value[0];`;
  assert.deepEqual(codes(program('', members)), []);
  assert.deepEqual(codes(program('', 'static Span<int> Bad() { Quad value = default; return value; }')), ['CS8168']);
  assert.deepEqual(codes(program('', 'static Span<int> Bad(Quad value) { return value[..]; }')), ['CS8166']);
  assert.deepEqual(codes(program('', 'static ref int Bad() { Quad value = default; return ref value[0]; }')), ['CS8169']);
  assert.deepEqual(codes(program('', 'static Span<int> Bad(scoped ref Quad value) { return value; }')), ['CS9075']);
});

test('A02-T80 views over inner locals cannot be stored into an outer span', () => {
  assert.deepEqual(codes(program('Span<int> view = default; { Quad value = default; view = value; }')), ['CS8352']);
});

test('A02-T80 inline-array operations are gated below C# 12 and rejected in expression trees', () => {
  const source = program('Quad value = default; Span<int> span = value; Console.WriteLine(value[^1]);');
  assert.deepEqual(codes(source, '11'), ['CS9058', 'CS9058']);
  const tree = program('Quad value = default; System.Linq.Expressions.Expression<Func<int>> expression = () => value[0];');
  assert.deepEqual(codes(tree), ['CS9170']);
});

test('A02-T80 image execution profiles still report unsupported struct storage explicitly', () => {
  const result = compile(program('Quad value = default; value[0] = 7; Console.WriteLine(value[0]);'));
  assert.equal(result.image ?? null, null);
  assert.deepEqual(result.diagnostics.filter(row => row.severity === 'error').map(row => row.code), ['SF2200']);
});
