import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compile, compileToAssembly, compileToReferenceAssembly, createReferenceSet } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';

// SF-A02-T30: members of real reference assemblies the registry modelled differently or not at all - operators of
// special types, attribute usage and overload priority read from metadata, params collection betterness, events,
// decimal conversions, `typeof` of an unbound generic type. Reference: the fixtures `decimals` and `framework-tour-2`
// of packages/compiler/test/cil-emission/reference-fixtures print on .NET 10 what the Roslyn build prints
// (`verify-dotnet.mjs --references`, SDK 10.0.201, reference pack 10.0.5). Skipped where no .NET SDK is installed.

const pack = loadReferencePack();
const skip = pack ? false : 'no .NET reference pack is installed';
const options = extra => ({ name: 'Sample', references: pack.references, ...extra });

function errorsOf(source, extra) {
  return compile(source, options(extra))
    .diagnostics.filter(entry => entry.severity === 'error' && /^CS/.test(entry.code))
    .map(entry => entry.code);
}
const withMain = declarations => declarations + ' class P { static void Main() { } }';

/** The instructions of `P::Main` as `name Owner::Member` lines. */
function mainOf(body, usings = 'using System; using System.Collections.Generic;') {
  const result = compileToAssembly(`${usings} class P { static void Main() { ${body} } }`, options()),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly),
    method = inspector.types.find(type => type.name === 'P').methods.find(candidate => candidate.name === 'Main');
  return inspector
    .getMethod(method.token)
    .instructions.map(instruction => {
      if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
      const table = instruction.operand >>> 24;
      if (table === 1 || table === 2) return `${instruction.name} ${inspector.metadata.typeName(instruction.operand)}`;
      if (table === 27) return `${instruction.name} spec:${inspector.metadata.typeName(instruction.operand)}`;
      const target = inspector.resolveToken(instruction.operand);
      return `${instruction.name} ${target.owner}::${target.name}`;
    })
    .join('; ');
}

test('A02-T30 operators of DateTime and decimal are the operator methods of the referenced types', { skip }, () => {
  const text = mainOf(`var later = new DateTime(2024, 1, 31) + TimeSpan.FromDays(1); var gap = later - DateTime.MinValue;
    int two = 2; decimal total = two; total += 3 * 1.5m; int whole = (int)total; decimal? maybe = total; var sum = maybe + 1;
    Console.WriteLine(later > DateTime.MinValue); Console.WriteLine(gap); Console.WriteLine(whole); Console.WriteLine(sum);`);
  for (const member of ['System.DateTime::op_Addition', 'System.DateTime::op_Subtraction', 'System.DateTime::op_GreaterThan']) {
    assert.ok(text.includes('call ' + member), `${member}: ${text}`);
  }
  // int -> decimal and decimal -> int are the conversion operators of System.Decimal, also around a lifted operator.
  assert.match(text, /ldloc\.2; call System\.Decimal::op_Implicit/);
  assert.match(text, /call System\.Decimal::op_Explicit/);
  assert.match(text, /ldc\.i4\.1; call System\.Decimal::op_Implicit; stloc/);
  assert.deepEqual(errorsOf('class P { static void Main() { var bad = System.DateTime.MinValue + 1; } }'), ['CS0019']);
});

test('A02-T30 AttributeUsage is read from metadata: targets, repetition and constructor arguments are checked', { skip }, () => {
  assert.deepEqual(errorsOf(withMain('using System; [Flags] class C { }')), ['CS0592']);
  assert.deepEqual(errorsOf(withMain('using System; class C { void M([Obsolete] int x) { } }')), ['CS0592']);
  assert.deepEqual(errorsOf(withMain('using System; [Serializable, Serializable] class C { }')), ['CS0579']);
  assert.deepEqual(errorsOf(withMain('using System; [Obsolete(5)] class C { }')), ['CS1503']);
  assert.deepEqual(errorsOf(withMain('using System; [Obsolete(Missing = 1)] class C { }')), ['CS0246']);
  // Valid uses stay valid: AllowMultiple and inherited usage.
  assert.deepEqual(errorsOf(`using System; using System.Diagnostics;
    [Flags] enum E { A = 1 } [Obsolete("old", false)] class C { [Conditional("A"), Conditional("B")] void M() { } }
    class P { static void Main() { } }`), []);
});

test('A02-T30 params collections: the better collection type decides, also when no argument goes into it', { skip }, () => {
  const text = mainOf('Console.WriteLine(string.Format("none")); Console.WriteLine(string.Format("{0}{1}{2}{3}", 1, 2, 3, 4));');
  assert.match(text, /call System\.ReadOnlySpan`1<object>::op_Implicit; call System\.String::Format/);
  // Before C# 13 only the array is a params collection.
  const older = 'class P { static void Main() { System.Console.WriteLine(string.Format("{0}{1}{2}{3}", 1, 2, 3, 4)); } }';
  assert.deepEqual(errorsOf(older, { langVersion: '12' }), []);
});

test('A02-T30 OverloadResolutionPriority of a referenced member is honoured', { skip }, () => {
  const library = compileToReferenceAssembly(
    `using System.Runtime.CompilerServices;
     public static class Library {
       [OverloadResolutionPriority(1)] public static int Pick(object value) => 1;
       public static int Pick(string value) => 2;
       public static int Plain(object value) => 1;
       public static int Plain(string value) => 2;
     }`,
    options({ name: 'Library', outputKind: 'library' }),
  );
  assert.ok(library.assembly, JSON.stringify(library.diagnostics.map(entry => entry.message)));
  const references = createReferenceSet([...pack.pack.files.map((path, index) => pack.references[index]), { bytes: library.assembly, display: 'Library.dll' }]),
    emitted = compileToAssembly('class P { static int Main() { return Library.Pick("x") * 10 + Library.Plain("x"); } }', { name: 'Sample', references }),
    inspector = new AssemblyInspector(emitted.assembly),
    signatures = [];
  for (const row of inspector.metadata.rows[10] ?? []) {
    signatures.push(`${inspector.metadata.string(row[1])}:${[...inspector.metadata.blob(row[2])].join(',')}`);
  }
  // Pick(object): the parameter is ELEMENT_TYPE_OBJECT (0x1c); Plain(string): ELEMENT_TYPE_STRING (0x0e).
  assert.ok(signatures.includes('Pick:0,1,8,28'), signatures.join(' | '));
  assert.ok(signatures.includes('Plain:0,1,8,14'), signatures.join(' | '));
});

test('A02-T30 events of referenced types, typeof of an unbound generic type, and names that are not extension receivers', { skip }, () => {
  const text = mainOf(
    `var items = new ObservableCollection<int>(); items.CollectionChanged += (s, e) => Console.WriteLine(e.Action); items.Add(1);
     Console.WriteLine(typeof(Dictionary<,>).IsGenericTypeDefinition); Console.WriteLine(typeof(List<int>).IsGenericTypeDefinition);`,
    'using System; using System.Collections.Generic; using System.Collections.ObjectModel;',
  );
  assert.match(text, /callvirt System\.Collections\.ObjectModel\.ObservableCollection`1<int>::add_CollectionChanged/);
  assert.match(text, /ldtoken System\.Collections\.Generic\.Dictionary`2;/);
  assert.match(text, /ldtoken spec:/);
  // `Count` exists as an extension method (of spans and sequences), but none takes an int: the name is unknown.
  assert.deepEqual(errorsOf('using System; using System.Linq; class P { static void Main() { int n = 1; var c = n.Count; } }'), ['CS1061']);
});
