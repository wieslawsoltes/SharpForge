import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToAssembly } from '@sharpforge/compiler';
import { parse, previewRevisions } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { SemanticAnalysis } from '../packages/compiler/src/semantic-analysis.js';
import { AnalysisModel } from '../packages/compiler/src/semantic/analysis-model.js';
import { importAssembly } from '../packages/compiler/src/metadata-import/pe-symbols.js';
import { unionShapeOf } from '../packages/compiler/src/symbols/union-shape.js';
import { NullableAnnotation, SymbolKind, TypeKind } from '../packages/compiler/src/symbols/types.js';
import { unionContracts, unionInputs, unionPreviewOptions } from './fixtures/compiler-unions/contracts.js';
import { runUnion as run, unionNativeSkip, unionReferences, unionReferenceSkip } from './fixtures/compiler-unions/native-test.js';

// Proposal expectations, not fabricated Roslyn output: the pinned SDK does not parse union declarations.
const analyze = (source, options = {}) => {
  const files = unionInputs(source).map(file => parse(new SourceText(file.text, file.uri), undefined,
    { languageVersion: options.langVersion ?? 'preview' }));
  const analysis = new SemanticAnalysis(files, { ...unionPreviewOptions, ...options });
  analysis.run();
  return analysis;
};
const errors = analysis => analysis.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
const codes = analysis => errors(analysis).map(diagnostic => diagnostic.code);

test('SF-A02-T89 proposal stamp is exact and does not claim a Roslyn oracle', () => {
  assert.equal(previewRevisions.Unions.commit, '412dc3023500b69f684c365762e38db6ee7564ea');
  assert.equal(previewRevisions.Unions.revision, 1);
  assert.equal(previewRevisions.Unions.roslyn, false);
});

test('union lowering declares a real struct, nullable Value and one constructor per case', () => {
  const analysis = analyze('public union NumberOrText(int, string);');
  assert.deepEqual(codes(analysis), []);
  const type = analysis.assembly.types.find(candidate => candidate.name === 'NumberOrText');
  assert.equal(type.typeKind, TypeKind.Struct);
  assert.equal(type.isRecord, false);
  const shape = unionShapeOf(type, analysis.core);
  assert.equal(shape.valid, true);
  assert.deepEqual(shape.caseTypes.map(caseType => caseType.toDisplayString()), ['int', 'string']);
  assert.equal(shape.valueProperty.typeWithAnnotations.nullableAnnotation, NullableAnnotation.Annotated);
  assert.equal(type.interfaces.some(iface => iface.name === 'IUnion'), true);
  assert.equal(type.getMembers('op_Implicit').length, 0, 'union conversions are compiler behavior, not synthesized operators');
  const emitted = compileToAssembly(unionInputs('public union NumberOrText(int, string);'), { ...unionPreviewOptions, outputKind: 'library' });
  assert.equal(emitted.success, true, JSON.stringify(emitted.diagnostics));
  const imported = importAssembly(emitted.assembly).globalNamespace.lookupType('NumberOrText', 0);
  assert.equal(imported.typeKind, TypeKind.Struct);
  assert.equal(imported.getMembers('.ctor').length, 2);
  assert.equal(imported.getMembers().filter(member => member.kind === SymbolKind.Field && !member.isStatic).length, 1);
  assert.equal(imported.attributes.some(attribute => attribute.attributeClassName === 'System.Runtime.CompilerServices.UnionAttribute'), true);
});

test('required union contracts are never synthesized when missing', () => {
  const source = 'public union U(int, string); class Program { static void Main() { } }';
  const emitted = compileToAssembly(source, unionPreviewOptions);
  assert.equal(emitted.success, false);
  assert.deepEqual(emitted.diagnostics.filter(diagnostic => diagnostic.code === 'CS0518').map(diagnostic => diagnostic.message).sort(), [
    "Predefined type 'System.Runtime.CompilerServices.IUnion' is not defined or imported",
    "Predefined type 'System.Runtime.CompilerServices.UnionAttribute' is not defined or imported",
  ]);
});

test('required union contracts can come from referenced assemblies', { skip: unionReferenceSkip }, () => {
  const source = 'public union U(int, string); class Program { static void Main() { } }';
  const contracts = compileToAssembly(unionContracts, {
    ...unionPreviewOptions, outputKind: 'library', name: 'UnionContracts', references: unionReferences,
  });
  assert.equal(contracts.success, true, JSON.stringify(contracts.diagnostics));
  const referenced = compileToAssembly(source, {
    ...unionPreviewOptions, references: [...unionReferences, { bytes: contracts.assembly, display: 'UnionContracts.dll' }],
  });
  assert.equal(referenced.success, true, JSON.stringify(referenced.diagnostics));
});

test('semantic conversion and type queries retain the union conversion before its creation plan', () => {
  const source = 'union U(long, string); class C { U Make() => 42; }';
  const files = unionInputs(source).map(file => parse(new SourceText(file.text, file.uri), undefined, { languageVersion: 'preview' }));
  const model = new AnalysisModel(files, unionPreviewOptions);
  const start = source.indexOf('42');
  const node = { uri: 'Program.cs', start, end: start + 2 };
  assert.equal(model.getConversion(node).kind, 'ImplicitUnion');
  assert.equal(model.getTypeInfo(node).type.toDisplayString(), 'int');
  assert.equal(model.getTypeInfo(node).convertedType.toDisplayString(), 'U');
});

test('generated constructor boxing, default null and struct copies execute on direct CIL', { skip: unionNativeSkip }, () => {
  assert.equal(run(`
using System;
union U(int, string);
class Program
{
    static void Main()
    {
        U first = 42;
        U copy = first;
        first = "changed";
        Console.WriteLine(copy is int number && number == 42);
        Console.WriteLine(first is string text && text == "changed");
        Console.WriteLine(default(U).Value == null);
        Console.WriteLine(new U(9) is int nine && nine == 9);
    }
}`), 'True\nTrue\nTrue\nTrue\n');
});

test('union metadata imports retain case conversions and pattern matching', { skip: unionReferenceSkip }, () => {
  const library = compileToAssembly(unionInputs('public union Imported(int, string);'), {
    ...unionPreviewOptions, name: 'ImportedUnions', outputKind: 'library', references: unionReferences,
  });
  assert.equal(library.success, true, JSON.stringify(library.diagnostics));
  const consumer = compileToAssembly(`class Program
    { static void Main() { Imported value = 3; System.Console.WriteLine(value is int number && number == 3); } }`, {
    ...unionPreviewOptions, references: [...unionReferences, { bytes: library.assembly, display: 'ImportedUnions.dll' }],
  });
  assert.equal(consumer.success, true, JSON.stringify(consumer.diagnostics));
});

test('generic, nullable and nested case types retain their construction signatures', { skip: unionNativeSkip }, () => {
  assert.equal(run(`
using System;
union Inner(int, string);
union Outer(Inner, bool);
union Generic<T>(T, string);
union Maybe(int?, string);
class Program
{
    static void Main()
    {
        Generic<int> generic = 17;
        Inner inner = 5;
        Outer outer = inner;
        Maybe nullable = (int?)null;
        Console.WriteLine(generic is int value && value == 17);
        Console.WriteLine(outer is Inner nested && nested is int five && five == 5);
        Console.WriteLine(nullable is null);
    }
}`), 'True\nTrue\nTrue\n');
});

test('union declarations enforce storage, constructor, case-type and generated-member restrictions', () => {
  const cases = [
    'union U(int, string) { public int field; }',
    'union U(int, string) { public int Stored { get; set; } }',
    'union U(int, string) { public event System.Action Changed; }',
    'union U(int, string) { public U(bool value) : this(1) { } }',
    'union U(int, string) { private U(bool value) { } }',
    'union U(int, string) { private U(bool value) : this() { } }',
    'union U(int, string) { public object Value => null; }',
    'union U(int, int);',
    'union U(void, int);',
    'ref struct RefLike { } union U(RefLike, string);',
  ];
  for (const source of cases) {
    const analysis = analyze(source);
    assert.ok(codes(analysis).includes('SF2203'), source + '\n' + JSON.stringify(analysis.diagnostics));
    assert.ok(errors(analysis).filter(diagnostic => diagnostic.code === 'SF2203').every(diagnostic => /unions\.md revision 1/.test(diagnostic.message)));
  }
  assert.deepEqual(codes(analyze(`union U(int, string)
    { public static int Cache; private U(bool value, int unused) : this(1) { } public int Number() => 1; }`)), []);
  assert.ok(codes(analyze('class Hidden { } public union U(Hidden, int);')).includes('CS0051'));
});

test('union declarations remain preview-only and the source VM reports its real struct boundary', () => {
  const source = 'union U(int, string); class Program { static void Main() { U value = 1; System.Console.WriteLine(value.Value); } }';
  const stable = compileToAssembly(unionInputs(source), { ...unionPreviewOptions, langVersion: '14' });
  assert.ok(stable.diagnostics.some(diagnostic => diagnostic.code === 'CS8652'));
  assert.equal(stable.assembly, null);
  const sourceVm = compile(unionInputs(source), unionPreviewOptions);
  assert.equal(sourceVm.image, null);
  assert.ok(sourceVm.diagnostics.some(diagnostic => diagnostic.code === 'SF2200'), JSON.stringify(sourceVm.diagnostics));
});

test('the CIL VM explicitly rejects managed-reference and generic union aggregate storage', () => {
  for (const declaration of ['union U(int, string);', 'union Generic<T>(T, string);']) {
    const type = declaration.includes('Generic') ? 'Generic<int>' : 'U';
    const compiled = compileToAssembly(unionInputs(`${declaration}
      class Program { static void Main() { ${type} value = 1; System.Console.WriteLine(value.Value); } }`), unionPreviewOptions);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    assert.throws(() => new CilVirtualMachine(compiled.assembly),
      /managed-reference fields|Generic aggregate owners require T03 value storage/);
  }
});
