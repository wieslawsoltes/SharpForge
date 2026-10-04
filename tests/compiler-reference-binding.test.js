import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compile, compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';

// SF-A02-T30: binding and emitting against real reference assemblies. Reference for the behaviour: the fixtures of
// packages/compiler/test/cil-emission/reference-fixtures print on .NET 10 what the Roslyn build prints
// (`verify-dotnet.mjs --references`, SDK 10.0.201, reference pack 10.0.5). The tests that need the reference pack are
// skipped where no .NET SDK is installed; the ones at the end exercise the same emitter paths with source types.

const pack = loadReferencePack();
const skip = pack ? false : 'no .NET reference pack is installed';

function inspect(source, options) {
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
const withReferences = source => inspect(source, { references: pack.references });
const errorsOf = (source, options) =>
  compile(source, options)
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => entry.code);
const main = body => `using System; using System.Collections.Generic; using System.Linq;
  class P { static void Main() { ${body} } }`;

test('A02-T30 every AssemblyRef carries the identity of the referenced assembly that defines the type', { skip }, () => {
  const { inspector } = withReferences(
    main('var ages = new Dictionary<string, int>(); Console.WriteLine(ages.GetValueOrDefault("a", 1) + new[] { 1 }.Sum());'),
  );
  const references = new Map(inspector.summary().references.map(reference => [reference.name, reference.version]));
  for (const name of ['System.Runtime', 'System.Console', 'System.Collections', 'System.Linq']) {
    assert.equal(references.get(name), '10.0.0.0', `${name}: ${[...references.keys()].join(', ')}`);
  }
});

test('A02-T30 constants of imported fields and enums fold', { skip }, () => {
  const { lines } = withReferences(
    main(`const long Wide = long.MaxValue; const int Day = (int)DayOfWeek.Friday;
      Console.WriteLine(int.MaxValue); Console.WriteLine(Wide); Console.WriteLine(Day); Console.WriteLine(Math.PI);`),
  );
  const body = lines('P', 'Main');
  assert.ok(!body.some(line => line.startsWith('ldsfld')), 'no constant is read from a field: ' + body.join('; '));
  assert.deepEqual(
    body.filter(line => line.startsWith('ldc.')),
    ['ldc.i4', 'ldc.i8', 'ldc.i4.5', 'ldc.r8'],
  );
  // An imported constant in a constant context: a case label, and a wrong constant conversion is still an error.
  assert.deepEqual(errorsOf(main('switch (3) { case int.MaxValue: break; }'), { references: pack.references }), []);
  assert.deepEqual(errorsOf(main('const byte Small = int.MaxValue;'), { references: pack.references }), ['CS0031']);
});

test('A02-T30 foreach finds MoveNext on the base interface and enumerates explicit implementations through the interface', { skip }, () => {
  const { lines } = withReferences(`using System; using System.Collections; using System.Collections.Generic;
    class Explicit : IEnumerable<int> {
      IEnumerator<int> IEnumerable<int>.GetEnumerator() { yield return 1; }
      IEnumerator IEnumerable.GetEnumerator() { yield return 2; }
    }
    class P {
      static void Typed(IEnumerable<string> items) { foreach (var item in items) Console.WriteLine(item); }
      static void Untyped(IEnumerable items) { foreach (var item in items) Console.WriteLine(item); }
      static void Through() { foreach (var item in new Explicit()) Console.WriteLine(item); }
      static void Main() { }
    }`);
  const typed = lines('P', 'Typed');
  assert.ok(typed.includes('callvirt System.Collections.Generic.IEnumerable`1<string>::GetEnumerator'), typed.join('; '));
  assert.ok(typed.includes('callvirt System.Collections.IEnumerator::MoveNext'));
  assert.ok(typed.includes('callvirt System.Collections.Generic.IEnumerator`1<string>::get_Current'));
  assert.ok(typed.includes('callvirt System.IDisposable::Dispose'));
  // `IEnumerator` is not disposable statically: the enumerator is tested at run time.
  const untyped = lines('P', 'Untyped');
  assert.ok(untyped.includes('isinst System.IDisposable'), untyped.join('; '));
  const through = lines('P', 'Through');
  assert.ok(through.includes('callvirt System.Collections.Generic.IEnumerable`1<int>::GetEnumerator'), through.join('; '));
});

test('A02-T30 LINQ binds: generic extension methods, lambdas, and an invoked name skips a property', { skip }, () => {
  const { lines } = withReferences(
    main(`var list = new List<int> { 1, 2, 3 };
      Console.WriteLine(list.Where(n => n > 1).Select(n => n * 2).Sum());
      Console.WriteLine(list.Count(n => n > 1) + list.Count);`),
  );
  const body = lines('P', 'Main').join('; ');
  for (const member of ['Where', 'Select', 'Sum', 'Count']) assert.match(body, new RegExp(`call System\\.Linq\\.Enumerable::${member}`));
  assert.match(body, /callvirt System\.Collections\.Generic\.List`1<int>::get_Count/);
});

test('A02-T30 with references a missing member is an error, not an incomplete analysis', { skip }, () => {
  const options = { references: pack.references };
  assert.deepEqual(errorsOf(main('new List<int>().Missing();'), options), ['CS1061']);
  assert.deepEqual(errorsOf(main('Console.WriteLine("x".Lenght);'), options), ['CS1061']);
  // No extension method named Count takes these arguments: the property is what the name means.
  assert.deepEqual(errorsOf('class P { static void Main() { new System.Collections.Generic.List<int>().Count(); } }', options), ['CS1955']);
});

test('A02-T30 span conversions call the operators of the span types; ref-returning members keep their modifiers', { skip }, () => {
  const { inspector, lines } = withReferences(
    main(`int[] numbers = { 1, 2 }; Span<int> span = numbers; ReadOnlySpan<int> view = span; ReadOnlySpan<char> text = "ab";
      span[0] = 5; Console.WriteLine(view[1] + text[0] + text.ToString());
      Console.WriteLine(string.Join('-', "a", "b"));`),
  );
  const body = lines('P', 'Main'),
    text = body.join('; ');
  assert.match(text, /call System\.Span`1<int>::op_Implicit; stloc/);
  assert.match(text, /call System\.String::op_Implicit/);
  // `span[0] = 5` stores through the reference the getter returns; reading loads through it.
  assert.match(text, /call System\.Span`1<int>::get_Item; ldc\.i4\.5; stind\.i4/);
  assert.match(text, /call System\.ReadOnlySpan`1<int>::get_Item; ldind\.i4/);
  // A ref struct is never boxed for a virtual call.
  assert.match(text, /constrained\. System\.ReadOnlySpan`1<char>; callvirt System\.Object::ToString/);
  assert.ok(!body.some(line => line.startsWith('box System.ReadOnlySpan')));
  // `ref readonly T this[int]` is `modreq(InAttribute) T&`: the MemberRef signature names the modifier.
  const typeReferences = inspector.metadata.rows[1].map(row => inspector.metadata.string(row[1]));
  assert.ok(typeReferences.includes('InAttribute'), typeReferences.join(', '));
});

test('A02-T30 System.Threading.Lock, FormattableString and decimal constants emit', { skip }, () => {
  const { lines } = withReferences(
    main(`var gate = new System.Threading.Lock(); lock (gate) { Console.WriteLine(1.5m); }
      FormattableString text = $"{1} of {2}"; Console.WriteLine(text.ArgumentCount);`),
  );
  const text = lines('P', 'Main').join('; ');
  assert.match(text, /callvirt System\.Threading\.Lock::EnterScope/);
  assert.match(text, /call System\.Threading\.Lock\+Scope::Dispose/);
  assert.match(text, /ldc\.i4\.s; ldc\.i4\.0; ldc\.i4\.0; ldc\.i4\.0; ldc\.i4\.1; newobj System\.Decimal::\.ctor/);
  assert.match(text, /call System\.Runtime\.CompilerServices\.FormattableStringFactory::Create/);
});

test('A02-T30 a ref-returning indexer or property of a source type is read, written and referenced through its pointer', () => {
  const { lines } = inspect(`class Buffer {
      public int[] Items = new int[3];
      public ref int this[int index] => ref Items[index];
      public ref int First => ref Items[0];
    }
    class P {
      static int Run(Buffer buffer) {
        buffer[1] = 20;
        buffer[1] += 5;
        buffer.First = 3;
        ref int last = ref buffer[2];
        last = 9;
        return buffer[1] + buffer.First;
      }
      static void Main() { System.Console.WriteLine(Run(new Buffer())); }
    }`);
  const text = lines('P', 'Run').join('; ');
  assert.match(text, /callvirt Buffer::get_Item; ldc\.i4\.s; stind\.i4/);
  assert.match(text, /callvirt Buffer::get_First; ldc\.i4\.3; stind\.i4/);
  // `ref buffer[2]` is the pointer itself, not the address of a copy.
  assert.match(text, /ldc\.i4\.2; callvirt Buffer::get_Item; stloc/);
  assert.match(text, /callvirt Buffer::get_First; ldind\.i4/);
});

test('A02-T30 without references the registry stays the library and its behaviour is unchanged', () => {
  const { inspector, lines } = inspect('class P { static void Main() { System.Console.WriteLine(int.MaxValue); } }');
  assert.deepEqual(
    inspector.summary().references.map(reference => `${reference.name} ${reference.version}`),
    ['System.Runtime 8.0.0.0', 'System.Console 8.0.0.0'],
  );
  assert.deepEqual(lines('P', 'Main'), ['ldc.i4', 'box System.Int32', 'call System.Console::WriteLine', 'ret']);
});
