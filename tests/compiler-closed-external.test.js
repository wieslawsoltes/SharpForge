import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from '@sharpforge/compiler';
import { importAssembly } from '../packages/compiler/src/metadata-import/pe-symbols.js';
import { isImportedClosedClass, closedTypeAttribute } from '../packages/compiler/src/binder/closed-metadata.js';
import { supportedCompilerFeatures } from '../packages/compiler/src/metadata-import/attributes.js';

// PROVISIONAL (C# 15 preview): csharplang/proposals/csharp-15.0/closed-hierarchies.md revision 1. Roslyn 5.3 has no
// closed classes, so nothing here is pinned against it: every assertion is the text of the pinned proposal.
// Closed.dll (packages/compiler/test/references/fixtures.js) is built by Roslyn from classes marked [IsClosedType],
// the metadata form the proposal's "Lowering" section defines.
const root = new URL('../packages/compiler/test/references/assemblies/', import.meta.url);
const bytes = file => new Uint8Array(readFileSync(new URL(file, root)));
const core = new Uint8Array(readFileSync(new URL('./fixtures/metadata/MiniStandard.dll', import.meta.url)));
const references = [
  { bytes: core, display: 'MiniStandard.dll' },
  { bytes: bytes('Closed.dll'), display: 'Closed.dll' },
];
const compileWith = (source, options = {}) => compile(source, { langVersion: 'preview', references, ...options });
const codesOf = result => result.diagnostics.filter(d => d.severity === 'error' && !/^SF1|^SF2200$|^SF209/.test(d.code)).map(d => d.code);
const rulesOf = result => result.diagnostics.filter(d => d.code === 'SF2203');
const main = 'class Program { static void Main() { } }\n';

test('SF-A02-T90 metadata: a class marked [IsClosedType] is a closed class with the subtypes of its own assembly', () => {
  const assembly = importAssembly(bytes('Closed.dll')),
    type = name => assembly.globalNamespace.lookupType('Shapes.' + name, 0);
  assert.equal(closedTypeAttribute, 'System.Runtime.CompilerServices.IsClosedTypeAttribute');
  assert.equal(isImportedClosedClass(type('Shape')), true);
  assert.equal(type('Shape').isClosedClass, true);
  assert.deepEqual(type('Shape').closedSubtypes.map(subtype => subtype.name).sort(), ['Circle', 'Solid', 'Square']);
  // A subtype is closed only when it is marked itself.
  assert.equal(isImportedClosedClass(type('Solid')), true);
  assert.deepEqual(type('Solid').closedSubtypes, []);
  assert.equal(isImportedClosedClass(type('Circle')), false);
  assert.equal(isImportedClosedClass(type('Open')), false);
  assert.equal(type('Open').isClosedClass, undefined);
  assert.equal(isImportedClosedClass(null), false);
  assert.ok(supportedCompilerFeatures.includes('ClosedClasses'), 'constructors marked [CompilerFeatureRequired("ClosedClasses")] stay usable');
});

test('SF-A02-T90 same-assembly restriction: deriving directly from a closed class of another assembly is an error', () => {
  const result = compileWith(`class Mine : Shapes.Shape { }\n${main}`),
    [rule] = rulesOf(result);
  assert.equal(rulesOf(result).length, 1);
  assert.match(rule.message, /cannot directly derive from 'Shapes\.Shape': it is closed and declared in another assembly/);
  assert.match(rule.message, /closed-hierarchies\.md revision 1/);
  assert.equal(rule.severity, 'error');
  assert.equal(result.image, null);
  // Reported on the base class in the base list.
  assert.equal(rule.start, 'class Mine : '.length);
  assert.equal(rule.length, 'Shapes.Shape'.length);
  // A closed subtype of the closed class is closed too.
  assert.equal(rulesOf(compileWith(`class Mine : Shapes.Solid { }\n${main}`)).length, 1);
});

test('SF-A02-T90 same-assembly restriction: what stays allowed', () => {
  // "public class C2 : CO { ... }  // Ok, 'CO' is not closed": a subtype that is not closed can be derived from.
  for (const base of ['Shapes.Circle', 'Shapes.Open']) {
    const result = compileWith(`class Mine : ${base} { }\n${main}`);
    assert.deepEqual(rulesOf(result), [], base);
    assert.deepEqual(codesOf(result), [], base);
  }
  // Using the closed class without deriving from it: fields, parameters, creation of its subtypes.
  const use = compileWith(`class Holder { Shapes.Shape shape = new Shapes.Circle(); int Sides(Shapes.Shape s) { return s.Sides + shape.Sides; } }\n${main}`);
  assert.deepEqual(rulesOf(use), []);
  assert.deepEqual(codesOf(use), []);
  // The restriction is a property of the referenced class, not of the language version of the consumer.
  assert.equal(rulesOf(compileWith(`class Mine : Shapes.Shape { }\n${main}`, { langVersion: '14' })).length, 1);
});

test('SF-A02-T90 exhaustiveness: a switch over the subtypes of an imported closed class needs no default arm', () => {
  const program = arms => `class Program {
  static int Sides(Shapes.Shape shape) { return shape switch { ${arms} }; }
  static void Main() { }
}
`;
  const warningsOf = result => result.diagnostics.filter(d => d.code === 'CS8509' || d.code === 'CS8510').map(d => d.code);
  assert.deepEqual(warningsOf(compileWith(program('Shapes.Circle c => 0, Shapes.Square s => 4, Shapes.Solid o => 6'))), []);
  assert.deepEqual(warningsOf(compileWith(program('Shapes.Circle c => 0, Shapes.Square s => 4'))), ['CS8509'], 'Solid is not handled');
  assert.deepEqual(warningsOf(compileWith(program('Shapes.Circle c => 0, Shapes.Square s => 4, Shapes.Solid o => 6, Shapes.Shape rest => 9'))), ['CS8510']);
  // A class that is not closed is never exhausted by its subtypes.
  const open = `class A : Shapes.Open { }
class Program {
  static int Kind(Shapes.Open value) { return value switch { A a => 1 }; }
  static void Main() { }
}
`;
  assert.deepEqual(warningsOf(compileWith(open)), ['CS8509']);
});
