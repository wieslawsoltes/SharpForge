import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';

// SF-A02-T30: two false errors on valid C# - `foreach (ref var x in span)` (CS1656) and `nint.Size` (CS0103) - and
// the sweep for the same class of problem. References: the corpus fixtures `ref-foreach/*` and
// `native-integer-names/*` are pinned against Roslyn 5.3.0 (diagnostics by code, start and length; outputs on
// .NET 10.0.5), and `reference-fixtures/ref-foreach-and-keyword-members` of packages/compiler/test/cil-emission prints
// what the Roslyn build prints (verify-dotnet.mjs --references). The tests that need the real libraries are skipped
// where no .NET SDK is installed.

const pack = loadReferencePack();
const skip = pack ? false : 'no .NET reference pack is installed';
/** The C# errors of a program (the direct pipeline: no execution-profile diagnostics). */
const errorsOf = (source, options = {}) =>
  compileToAssembly(source, { name: 'Sample', ...options })
    .diagnostics.filter(entry => entry.severity === 'error' && /^CS/.test(entry.code))
    .map(entry => `${entry.code} ${entry.message}`);
const codesOf = source => errorsOf(source).map(line => line.split(' ')[0]);
const withReferences = source => errorsOf(source, { references: pack.references });
const main = (body, declarations = '') => `using System; using System.Collections.Generic; ${declarations} class P { static void Main() { ${body} } }`;
const grid = `class Grid { int[] data = { 1, 2 }; public Enumerator GetEnumerator() { return new Enumerator(data); }
  public struct Enumerator { int[] data; int index; public Enumerator(int[] data) { this.data = data; index = -1; }
    public bool MoveNext() { return ++index < data.Length; } public ref int Current { get { return ref data[index]; } } } }`;

test('A02-T30 a ref iteration variable over a span is assignable and aliases the element', { skip }, () => {
  assert.deepEqual(withReferences(main('Span<int> span = new int[] { 1, 2 }; foreach (ref var x in span) x *= 2; foreach (ref int y in span) y++;')), []);
  assert.deepEqual(withReferences(main('ReadOnlySpan<int> span = new int[] { 1 }; foreach (ref readonly var x in span) Console.WriteLine(x);')), []);
  const viaMarshal = 'var list = new List<int> { 1 }; foreach (ref var x in System.Runtime.InteropServices.CollectionsMarshal.AsSpan(list)) x++;';
  assert.deepEqual(withReferences(main(viaMarshal)), []);
});

test('A02-T30 the rules of ref iteration variables report what Roslyn reports', () => {
  const codes = body => codesOf(main(body, grid));
  assert.deepEqual(codes('foreach (ref var g in new Grid()) g += 1;'), []);
  assert.deepEqual(codes('int[] array = { 1 }; foreach (ref var a in array) a++;'), ['CS1510']);
  assert.deepEqual(codes('foreach (ref var c in "text") { }'), ['CS1510']);
  assert.deepEqual(codes('foreach (ref readonly var g in new Grid()) g = 1;'), ['CS1656']);
  assert.deepEqual(codes('int other = 0; foreach (ref var g in new Grid()) g = ref other;'), ['CS1656']);
  assert.deepEqual(codes('foreach (var g in new Grid()) g = 1;'), ['CS1656']);
});

test('A02-T30 a ref iteration variable is the reference Current returns, not a copy', () => {
  const result = compileToAssembly(main('foreach (ref var g in new Grid()) g += 5;', grid), { name: 'Sample' });
  assert.deepEqual(
    result.diagnostics.filter(entry => entry.severity === 'error'),
    [],
  );
  const inspector = new AssemblyInspector(result.assembly),
    method = inspector.types.find(type => type.name === 'P').methods.find(candidate => candidate.name === 'Main'),
    names = inspector.getMethod(method.token).instructions.map(instruction => instruction.name),
    current = names.indexOf('call');
  // get_Current is followed by the store of the address; the element is then read and written through it.
  const afterCurrent = names.slice(names.lastIndexOf('call', names.indexOf('stind.i4')));
  assert.match(afterCurrent[1], /^stloc/, names.join('; '));
  assert.ok(names.includes('ldind.i4') && names.includes('stind.i4') && current >= 0);
});

test('A02-T30 nint and nuint name their types in expressions', { skip }, () => {
  const body = `Console.WriteLine(nint.Size + nuint.Size + " " + nint.MaxValue + nuint.MinValue + nint.Zero + nint.Parse("5"));
    nint value = nint.Zero + 3; Console.WriteLine(nint.Equals(value, (nint)3));`;
  assert.deepEqual(withReferences(main(body)), []);
});

test('A02-T30 a declaration named nint wins over the keyword', () => {
  const codes = codesOf(main('Console.WriteLine(nint.Size); Console.WriteLine(nint.Missing);', 'class nint { public const int Size = 99; }'));
  assert.deepEqual(codes, ['CS0117']);
});

test('A02-T30 static members of the built-in type keywords bind against the real libraries', { skip }, () => {
  const lines = [
    'Console.WriteLine(int.MaxValue + " " + long.MinValue + " " + byte.MaxValue + " " + uint.MaxValue + " " + short.MinValue + " " + ulong.MaxValue);',
    'Console.WriteLine(double.Epsilon + " " + float.NaN + " " + double.IsNaN(0.0 / 0.0) + " " + double.Pi + " " + decimal.One + " " + decimal.MaxValue);',
    'Console.WriteLine(string.Empty.Length + " " + string.IsNullOrEmpty("") + " " + string.Join(",", 1, 2) + " " + string.Concat("a", "b"));',
    'Console.WriteLine(char.IsDigit(\'5\') + " " + char.ToUpper(\'a\') + " " + char.MaxValue + " " + bool.TrueString + " " + bool.Parse("true"));',
    'Console.WriteLine(int.Parse("42") + " " + int.TryParse("7", out var seven) + seven + " " + long.Abs(-3) + " " + int.Max(1, 2) + " " + sbyte.MinValue);',
    'Console.WriteLine(object.ReferenceEquals(null, null) + " " + object.Equals(1, 1) + " " + ushort.MaxValue + " " + float.Epsilon);',
  ];
  assert.deepEqual(withReferences(main(lines.join('\n'))), []);
});
