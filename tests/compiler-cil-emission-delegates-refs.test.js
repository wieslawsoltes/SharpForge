import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';

// SF-A02-T30: delegates over extension methods, delegate equality, synthesized delegate types, constructed attribute
// classes, module initializers through `<Module>::.cctor`, `ref` fields, ref conditionals and `stackalloc`.
// Reference for the behaviour: the fixtures `extension-and-synthesized-delegates` (cil-emission/fixtures) and
// `ref-fields-and-stackalloc`, `generic-attributes` (cil-emission/reference-fixtures) print on .NET 10 what the Roslyn
// build prints (verify-dotnet.mjs, SDK 10.0.201, reference pack 10.0.5). The tests that need `Span<T>` from the
// reference pack are skipped where no .NET SDK is installed.

const pack = loadReferencePack();
const skip = pack ? false : 'no .NET reference pack is installed';

function emit(source, options = {}) {
  const result = compileToAssembly(source, { name: 'Sample', ...options }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly);
  return {
    inspector,
    /** The instructions of a method as `name operand` lines; tokens are shown as `Owner::Member`. */
    lines(owner, name) {
      const type = inspector.types.find(candidate => candidate.name === owner) ?? assert.fail(`no type ${owner}`),
        method = type.methods.find(candidate => candidate.name === name) ?? assert.fail(`no method ${owner}::${name}`);
      return inspector.getMethod(method.token).instructions.map(instruction => {
        if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
        const table = instruction.operand >>> 24;
        if (table === 1 || table === 2 || table === 27) return `${instruction.name} ${inspector.metadata.typeName(instruction.operand)}`;
        const target = inspector.resolveToken(instruction.operand);
        return `${instruction.name} ${target.owner}::${target.name}`;
      });
    },
  };
}
const errorCodes = (source, options = {}) =>
  compileToAssembly(source, { name: 'Sample', ...options })
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => entry.code);
const indexOfLine = (lines, text) => lines.findIndex(line => line === text);

test('A02-T30 a delegate over an extension method is closed over the receiver', () => {
  const { lines } = emit(`using System;
    class Counter { public int Count; }
    static class Extensions { public static void Bump(this Counter counter) { counter.Count++; } }
    class P { static void Main() { var counter = new Counter(); Action bump = counter.Bump; bump(); Console.WriteLine(counter.Count); } }`);
  const body = lines('P', 'Main'),
    function_ = indexOfLine(body, 'ldftn Extensions::Bump');
  assert.ok(function_ > 0, body.join('; '));
  // The receiver, not null, is the target: `ldloc; ldftn; newobj`.
  assert.match(body[function_ - 1], /^ldloc/);
  assert.equal(body[function_ + 1], 'newobj System.Action::.ctor');
});

test('A02-T30 a delegate over an extension method of a value type receiver stays CS1113', () => {
  const codes = errorCodes(`using System;
    static class Extensions { public static int Twice(this int value) { return value * 2; } }
    class P { static void Main() { Func<int> twice = 4.Twice; Console.WriteLine(twice()); } }`);
  assert.deepEqual(codes, ['CS1113']);
});

test('A02-T30 two delegates are compared by Delegate.op_Equality; null and object comparisons by reference', () => {
  const { lines } = emit(`using System;
    class P {
      static void Hello() { }
      static bool Same(Action a, Action b) { return a == b; }
      static bool Differ(Action a, Action b) { return a != b; }
      static bool IsNull(Action a) { return a == null; }
      static bool SameObject(Action a, Action b) { return (object)a == (object)b; }
      static void Main() { Action a = Hello, b = Hello; Console.WriteLine(Same(a, b) + " " + Differ(a, b) + " " + IsNull(a) + " " + SameObject(a, b)); }
    }`);
  assert.ok(lines('P', 'Same').includes('call System.Delegate::op_Equality'));
  assert.ok(lines('P', 'Differ').includes('call System.Delegate::op_Inequality'));
  for (const name of ['IsNull', 'SameObject']) {
    const body = lines('P', name);
    assert.ok(body.includes('ceq') && !body.some(line => line.startsWith('call')), `${name}: ${body.join('; ')}`);
  }
});

test('A02-T30 a delegate type synthesized for a lambda is a TypeDef of the assembly, one per signature', () => {
  const { inspector, lines } = emit(`using System;
    class P { static void Main() {
      var add = (int left, int right = 10) => left + right;
      var times = (int left, int right = 10) => left * right;
      var count = (params int[] values) => values.Length;
      add = times;
      Console.WriteLine(add(2) + count(1, 2));
    } }`);
  const names = inspector.types.map(type => type.name).filter(name => name.startsWith('<>f__AnonymousDelegate'));
  assert.deepEqual(names, ['<>f__AnonymousDelegate0', '<>f__AnonymousDelegate1']);
  const delegate = inspector.types.find(type => type.name === '<>f__AnonymousDelegate0');
  assert.deepEqual(delegate.methods.map(method => method.name).slice(0, 2), ['.ctor', 'Invoke']);
  assert.ok(lines('P', 'Main').includes('callvirt <>f__AnonymousDelegate0::Invoke'));
});

test('A02-T30 module initializers run from <Module>::.cctor for every entry-point type shape', () => {
  const program = entryType => `using System; using System.Runtime.CompilerServices;
    static class Startup { [ModuleInitializer] internal static void First() { Console.WriteLine("first"); }
      [ModuleInitializer] internal static void Second() { Console.WriteLine("second"); } }
    ${entryType}`;
  const withInitializer = emit(program('class P { static P() { Console.WriteLine("P"); } static void Main() { Console.WriteLine("main"); } }'));
  assert.deepEqual(withInitializer.lines('<Module>', '.cctor'), ['call Startup::First', 'call Startup::Second', 'ret']);
  assert.ok(!withInitializer.lines('P', 'Main').some(line => line.startsWith('call Startup::')));
  const initializedField = emit(program('class P { static int value = 3; static void Main() { Console.WriteLine(value); } }'));
  assert.equal(initializedField.lines('<Module>', '.cctor').length, 3);
  // The previous no-constructor assertion encoded the defective Main-only startup fallback.
  const plain = emit(program('class P { static void Main() { Console.WriteLine("main"); } }'));
  assert.deepEqual(plain.lines('<Module>', '.cctor'), ['call Startup::First', 'call Startup::Second', 'ret']);
  assert.ok(!plain.lines('P', 'Main').some(line => line.startsWith('call Startup::')));
});

test('A02-T30 a program without module initializers declares nothing on <Module>', () => {
  const { inspector } = emit('class P { static P() { } static void Main() { } }');
  assert.equal(inspector.types.find(type => type.name === '<Module>').methods.length, 0);
});

test('A02-T30 a constructed attribute class is named through its construction', () => {
  const { inspector } = emit(`using System;
    class TagAttribute<T> : Attribute { public TagAttribute(T value) { } public T Value { get; set; } }
    [Tag<int>(7)] class Tagged { [Tag<string>("text", Value = "named")] public void Method() { } }
    class P { static void Main() { } }`);
  const metadata = inspector.metadata,
    constructors = (metadata.rows[12] ?? []).map(row => inspector.resolveToken((row[1] >>> 3) | ((row[1] & 7) === 3 ? 0x0a000000 : 0x06000000)));
  const owners = constructors.map(constructor => constructor.owner).filter(owner => owner.startsWith('TagAttribute'));
  assert.equal(owners.length, 2, JSON.stringify(constructors.map(constructor => constructor.owner)));
  for (const owner of owners) assert.match(owner, /^TagAttribute`1</);
});

test('A02-T30 a ref field is declared with a by-reference signature', { skip }, () => {
  const result = compileToAssembly(
    `using System;
    ref struct Cursor {
      public ref int Current;
      public ref readonly long Wide;
      public int Plain;
      public Cursor(Span<int> items) { Current = ref items[0]; }
    }
    class P { static void Main() { int[] data = { 1 }; var cursor = new Cursor(data); cursor.Current = 5; Console.WriteLine(data[0]); } }`,
    { name: 'Sample', references: pack.references },
  );
  assert.deepEqual(
    result.diagnostics.filter(entry => entry.severity === 'error'),
    [],
  );
  // The inspector of @sharpforge/cil refuses BYREF in a field signature (a rule older than C# 11), so the method
  // bodies cannot be listed here; the fixture `ref-fields-and-stackalloc` runs them on .NET.
  const metadata = new AssemblyInspector(result.assembly).metadata,
    signatures = new Map(metadata.rows[4].map(row => [metadata.string(row[1]), [...metadata.blob(row[2])]]));
  const FIELD = 0x06,
    BYREF = 0x10,
    INT32 = 0x08,
    INT64 = 0x0a;
  assert.deepEqual(signatures.get('Current'), [FIELD, BYREF, INT32]);
  assert.deepEqual(signatures.get('Wide'), [FIELD, BYREF, INT64]);
  assert.deepEqual(signatures.get('Plain'), [FIELD, INT32]);
});

test('A02-T30 a ref conditional denotes the chosen variable', () => {
  const { lines } = emit(`using System;
    class P {
      static ref int Larger(ref int left, ref int right) => ref (left > right ? ref left : ref right);
      static void Main() { int a = 1, b = 2; Larger(ref a, ref b) = 9; (a > b ? ref a : ref b) += 1; Console.WriteLine(a + " " + b); }
    }`);
  const larger = lines('P', 'Larger');
  // Both branches leave an address; nothing is read through it before the return.
  assert.equal(larger.filter(line => line === 'ldarg.0' || line === 'ldarg.1').length, 4, larger.join('; '));
  assert.equal(larger.at(-1), 'ret');
  assert.equal(larger.filter(line => line === 'ldind.i4').length, 2);
});

test('A02-T30 stackalloc is localloc over an empty stack; operands evaluated before it are saved', { skip }, () => {
  const { lines } = emit(
    `using System;
    class P {
      static int Sum(ReadOnlySpan<int> values) { int sum = 0; foreach (var value in values) sum += value; return sum; }
      static int Plain(int count) { Span<int> span = stackalloc int[count]; return span.Length; }
      static string Nested() { return "sum " + Sum(stackalloc int[] { 1, 2 }); }
      static void Main() { Console.WriteLine(Plain(3) + Nested()); }
    }`,
    { references: pack.references },
  );
  const plain = lines('P', 'Plain'),
    allocation = indexOfLine(plain, 'localloc');
  assert.deepEqual(plain.slice(allocation - 3, allocation), ['conv.u', 'ldc.i4.4', 'mul.ovf.un'], plain.join('; '));
  assert.match(plain[allocation + 2], /^newobj System\.Span`1.*::\.ctor$/);
  const nested = lines('P', 'Nested'),
    nestedAllocation = indexOfLine(nested, 'localloc'),
    saved = nested.slice(0, nestedAllocation);
  // "sum " is stored before the allocation and loaded again after it.
  assert.ok(indexOfLine(saved, 'ldstr') >= 0 && saved.some(line => line.startsWith('stloc')), nested.join('; '));
  assert.equal(nested.filter(line => line === 'stind.i4').length, 2);
});

test('A02-T30 stackalloc of a pointer type outside the cases the emitter covers is refused, never miscompiled', () => {
  const result = compileToAssembly(`class P { static unsafe void Main() { int* p = stackalloc int[2]; p[0] = 1; System.Console.WriteLine(p[0]); } }`, {
    name: 'Sample',
    allowUnsafe: true,
  });
  const errors = result.diagnostics.filter(entry => entry.severity === 'error');
  if (result.assembly) assert.deepEqual(errors, []);
  else
    assert.deepEqual(
      errors.map(entry => entry.code),
      ['SF2200'],
    );
});
