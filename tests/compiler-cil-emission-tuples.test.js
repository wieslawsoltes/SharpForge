import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AssemblyInspector, decodeCoded, decodeCustomAttribute } from '@sharpforge/cil';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';

// SF-A02-T30: tuples as real System.ValueTuple constructions in CIL emitted from bound trees, deconstruction, and
// TupleElementNamesAttribute. References: the fixture `tuples-and-deconstruction` of packages/compiler/test/cil-emission
// prints on .NET 10 what the Roslyn build prints (verify-dotnet.mjs), and
// packages/compiler/test/reference-assembly/tuples.roslyn.txt is the Roslyn build of tuples.cs read with .NET
// reflection (compare.mjs: every line but the four assembly attributes agrees).

const NAMES = 'System.Runtime.CompilerServices.TupleElementNamesAttribute';
const samples = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'compiler', 'test', 'reference-assembly');

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly);
  return {
    inspector,
    lines(owner, name) {
      const type = inspector.types.find(candidate => candidate.name === owner) ?? assert.fail(`no type ${owner}`),
        method = type.methods.find(candidate => candidate.name === name) ?? assert.fail(`no method ${owner}::${name}`);
      return inspector.getMethod(method.token).instructions.map(instruction => {
        if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
        const token = instruction.operand,
          table = token >>> 24;
        if (table === 1 || table === 2 || table === 27) return `${instruction.name} ${inspector.metadata.typeName(token)}`;
        const target = inspector.resolveToken(token);
        return `${instruction.name} ${target.owner}::${target.name}`;
      });
    },
  };
}
const count = (lines, text) => lines.filter(line => line === text).length;

/** The TupleElementNames rows of an image as `[parent token, names]`. */
function tupleNames(assembly) {
  const inspector = new AssemblyInspector(assembly),
    metadata = inspector.metadata,
    rows = [];
  for (const [parent, type, value] of metadata.rows[12] ?? []) {
    const constructor = decodeCoded('CustomAttributeType', type),
      owner = metadata.typeName(decodeCoded('MemberRefParent', metadata.row(constructor)[0]));
    if (owner !== NAMES) continue;
    const decoded = decodeCustomAttribute(metadata.blob(value), constructor, { metadata });
    assert.equal(decoded.success, true);
    const names = decoded.constructorArguments[0].value.map(entry => (entry && typeof entry === 'object' ? entry.value : entry));
    rows.push([decodeCoded('HasCustomAttribute', parent), names]);
  }
  return { inspector, rows };
}

test('A02-T30 a tuple literal constructs the ValueTuple; elements are its fields', () => {
  const { lines } = emit(`class C {
      static (int, string) Make(int a) { return (a, "x"); }
      static int First((int, string) t) { return t.Item1; }
      static void Set(ref (int Count, string Label) t) { t.Count = 3; }
      static int Main() { var t = Make(2); Set(ref t); return First(t); }
    }`);
  assert.deepEqual(lines('C', 'Make'), ['ldarg.0', 'ldstr', 'newobj System.ValueTuple`2<int, string>::.ctor', 'ret']);
  assert.deepEqual(lines('C', 'First'), ['ldarga.s', 'ldfld System.ValueTuple`2<int, string>::Item1', 'ret']);
  assert.deepEqual(lines('C', 'Set'), ['ldarg.0', 'ldc.i4.3', 'stfld System.ValueTuple`2<int, string>::Item1', 'ret']);
});

test('A02-T30 a tuple of more than seven elements nests in Rest, on construction and on access', () => {
  const { lines } = emit(`class C {
      static int Ninth((int, int, int, int, int, int, int, int, int) t) { return t.Item9; }
      static int Main() { return Ninth((1, 2, 3, 4, 5, 6, 7, 8, 9)); }
    }`);
  const wide = 'System.ValueTuple`8<int, int, int, int, int, int, int, System.ValueTuple`2<int, int>>';
  assert.deepEqual(lines('C', 'Ninth'), ['ldarga.s', `ldflda ${wide}::Rest`, 'ldfld System.ValueTuple`2<int, int>::Item2', 'ret']);
  const main = lines('C', 'Main');
  assert.ok(main.indexOf('newobj System.ValueTuple`2<int, int>::.ctor') < main.indexOf(`newobj ${wide}::.ctor`), 'Rest is built before the outer tuple');
});

test('A02-T30 tuple conversions and equality work element by element', () => {
  const { lines } = emit(`class C {
      static (long, object) Widen((int, string) t) { return t; }
      static bool Same((int, string) a, (int, string) b) { return a == b; }
      static bool Differ((int, long) a) { return a != (1, 2); }
      static int Main() { return Same((1, "a"), (1, "a")) && Differ((1, 3)) && Widen((1, "a")).Item1 == 1 ? 0 : 1; }
    }`);
  const widen = lines('C', 'Widen');
  assert.ok(widen.includes('conv.i8'), 'the first element is widened');
  assert.equal(widen.at(-2), 'newobj System.ValueTuple`2<long, object>::.ctor');
  const same = lines('C', 'Same');
  assert.equal(count(same, 'ldfld System.ValueTuple`2<int, string>::Item1'), 2);
  assert.ok(same.some(line => line.endsWith('::op_Equality')), 'strings compare by value: ' + same.join(' | '));
  assert.equal(count(same, 'brfalse.s'), 2, 'equality stops at the first unequal pair');
  assert.equal(count(lines('C', 'Differ'), 'brtrue.s'), 2, 'inequality stops at the first pair that differs');
});

test('A02-T30 deconstruction evaluates the right side before it stores, and calls Deconstruct with out temporaries', () => {
  const { lines } = emit(`struct P { public int X, Y; public void Deconstruct(out int x, out long y) { x = X; y = Y; } }
    class C {
      static void Swap(ref int a, ref int b) { (a, b) = (b, a); }
      static long Sum(P p) { var (x, y) = p; return x + y; }
      static int Main() { int a = 1, b = 2; Swap(ref a, ref b); return (int)Sum(new P()) + a; }
    }`);
  const swap = lines('C', 'Swap'),
    lastLoad = swap.lastIndexOf('ldind.i4'),
    firstStore = swap.indexOf('stind.i4');
  assert.ok(lastLoad >= 0 && lastLoad < firstStore, 'both values are read before either target is written');
  const sum = lines('C', 'Sum');
  assert.ok(sum.includes('call P::Deconstruct'));
  // The address of the copy of the value, then one temporary per out parameter.
  assert.equal(count(sum, 'ldloca.s'), 3);
});

test('A02-T30 positional patterns read tuple elements and Deconstruct parts', () => {
  const { lines } = emit(`class C {
      static string Name((int, int) p) { switch (p) { case (0, 0): return "o"; case (var x, 0): return "x"; default: return "p"; } }
      static int Main() { return Name((0, 0)).Length; }
    }`);
  const name = lines('C', 'Name');
  assert.ok(name.includes('ldfld System.ValueTuple`2<int, int>::Item1') && name.includes('ldfld System.ValueTuple`2<int, int>::Item2'));
});

test('A02-T30 TupleElementNames is written on fields, parameters, return values and properties, as Roslyn encodes it', () => {
  const source = readFileSync(join(samples, 'tuples.cs'), 'utf8'),
    result = compileToReferenceAssembly(source, { name: 'Tuples' });
  assert.deepEqual(result.diagnostics.filter(entry => entry.severity === 'error'), []);
  const { inspector, rows } = tupleNames(result.assembly),
    type = inspector.types.find(candidate => candidate.name === 'Sample.Tuples'),
    field = name => type.fields.find(candidate => candidate.name === name).token,
    namesOn = parent => rows.filter(row => row[0] === parent).map(row => row[1]);
  assert.deepEqual(namesOn(field('Pair')), [['Count', 'Label']]);
  assert.deepEqual(namesOn(field('Plain')), [], 'a tuple without names has no attribute');
  // The names of all nine elements, then one null per element of the tuple nested in Rest.
  assert.deepEqual(namesOn(field('Wide')), [['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', null, null]]);
  assert.deepEqual(namesOn(field('Listed')), [['Key', null]]);
  const all = rows.map(row => row[1]);
  assert.ok(all.some(names => names.join() === 'First,Where,X,Y'), 'nested tuples follow in pre-order (property Names)');
  assert.ok(all.some(names => names.join() === 'Sum,'), 'the return value of Compute');
  assert.ok(all.some(names => names.join() === 'left,right'), 'the parameter of Compute');
  assert.ok(all.some(names => names.join() === ',,Inner,'), 'the return value of Nested');
  // Return values: a Param row with sequence 0 carries the attribute.
  const returns = rows.filter(row => row[0] >>> 24 === 8 && inspector.metadata.row(row[0])[1] === 0);
  assert.equal(returns.length, 3, "Compute, Nested and the getter of Names");
});

test('A02-T30 string elements compare by value: string == string binds to the string operator', () => {
  const { lines } = emit(`class C {
      static bool Same(string a, string b) { return a == b; }
      static bool Identical(string a, string b) { return (object)a == (object)b; }
      static int Main() { return Same("a", "b") || Identical("a", "b") ? 1 : 0; }
    }`);
  assert.ok(lines('C', 'Same').some(line => line.endsWith('::op_Equality')));
  assert.deepEqual(lines('C', 'Identical'), ['ldarg.0', 'ldarg.1', 'ceq', 'ret'], 'object operands still compare references');
});
