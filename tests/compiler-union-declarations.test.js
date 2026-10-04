import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToAssembly } from '@sharpforge/compiler';
import { parse, previewRevisions } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { SemanticAnalysis } from '../packages/compiler/src/semantic-analysis.js';
import { importAssembly } from '../packages/compiler/src/metadata-import/pe-symbols.js';
import { unionShapeOf } from '../packages/compiler/src/symbols/union-shape.js';
import { NullableAnnotation, SymbolKind, TypeKind } from '../packages/compiler/src/symbols/types.js';
import { unionContracts, unionInputs, unionPreviewOptions } from './fixtures/compiler-unions/contracts.js';

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
const run = source => {
  const compiled = compileToAssembly(unionInputs(source), unionPreviewOptions);
  assert.equal(compiled.success, true, compiled.diagnostics.map(diagnostic => diagnostic.code + ': ' + diagnostic.message).join('\n'));
  const result = new CilVirtualMachine(compiled.assembly, { maxInstructions: 100000 }).run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  return result.output;
};

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
  assert.equal(imported.getMembers().filter(member => member.kind === SymbolKind.Field && !member.isStatic).length, 1);
  assert.equal(imported.attributes.some(attribute => attribute.attributeClassName === 'System.Runtime.CompilerServices.UnionAttribute'), true);
});

test('required union contracts come from source or references and are never synthesized', () => {
  const source = 'public union U(int, string); class Program { static void Main() { } }';
  const emitted = compileToAssembly(source, unionPreviewOptions);
  assert.equal(emitted.success, false);
  assert.deepEqual(emitted.diagnostics.filter(diagnostic => diagnostic.code === 'CS0518').map(diagnostic => diagnostic.message).sort(), [
    "Predefined type 'System.Runtime.CompilerServices.IUnion' is not defined or imported",
    "Predefined type 'System.Runtime.CompilerServices.UnionAttribute' is not defined or imported",
  ]);
  const contracts = compileToAssembly(unionContracts, { ...unionPreviewOptions, outputKind: 'library', name: 'UnionContracts' });
  assert.equal(contracts.success, true, JSON.stringify(contracts.diagnostics));
  const referenced = compileToAssembly(source, { ...unionPreviewOptions, references: [{ bytes: contracts.assembly, display: 'UnionContracts.dll' }] });
  assert.equal(referenced.success, true, JSON.stringify(referenced.diagnostics));
});

test('generated constructor boxing, default null and struct copies execute on direct CIL', () => {
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

test('generic, nullable and nested case types retain their construction signatures', () => {
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
    'ref struct RefLike { } union U(RefLike, string);',
  ];
  for (const source of cases) {
    const analysis = analyze(source);
    assert.ok(codes(analysis).includes('SF2203'), source + '\n' + JSON.stringify(analysis.diagnostics));
    assert.ok(errors(analysis).filter(diagnostic => diagnostic.code === 'SF2203').every(diagnostic => /unions\.md revision 1/.test(diagnostic.message)));
  }
  assert.deepEqual(codes(analyze('union U(int, string) { public static int Cache; private U(bool value) : this(1) { } public int Number() => 1; }')), []);
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
