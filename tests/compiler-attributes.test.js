/**
 * SF-A02-T41: attributes. The Roslyn-pinned cases are in packages/compiler/test/differential/fixtures/attributes.js;
 * these tests cover what the analysis records for an attribute (class, constructor, arguments, location), the decoded
 * well-known attributes, the target tables, and the policy for attribute classes the framework registry does not list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { attributesNamed, fullNameOf } from '../packages/compiler/src/binder/attributes.js';
import { attributeLocations, describeTargets } from '../packages/compiler/src/binder/attribute-targets.js';
import { AttributeTargets } from '../packages/compiler/src/symbols/attribute-types.js';
import { linesOf } from './support/semantic-codegen.js';

const analysisOf = source => analyze([parse(new SourceText(source, 'a.cs'))]);
const codesOf = (source, options) => compile(source, options).diagnostics.filter(d => /^CS/.test(d.code)).map(d => d.code);
const typeNamed = (analysis, name) => analysis.assembly.types.find(type => type.name === name);

test('SF-A02-T41 an attribute is bound to its class, constructor, arguments and location', () => {
  const analysis = analysisOf(`using System;
[AttributeUsage(AttributeTargets.Method | AttributeTargets.ReturnValue, AllowMultiple = true, Inherited = false)]
class MarkAttribute : Attribute {
  public MarkAttribute(int level, string text) { }
  public int Order;
}
class Program {
  [Mark(1 + 2, "a" + "b", Order = 7)] [return: MarkAttribute(0, null)] static int M() { return 0; }
  static void Main() { }
}`);
  assert.deepEqual(analysis.diagnostics.filter(d => d.severity === 'error'), []);
  const mark = typeNamed(analysis, 'MarkAttribute'),
    method = typeNamed(analysis, 'Program').getMembers('M')[0];
  assert.deepEqual(mark.attributeUsage, {
    validOn: AttributeTargets.Method | AttributeTargets.ReturnValue,
    allowMultiple: true,
    inherited: false,
  });
  assert.equal(fullNameOf(mark.boundAttributes[0].attributeClass), 'System.AttributeUsageAttribute');
  const [first, second] = method.boundAttributes;
  assert.equal(first.attributeClass, mark);
  assert.equal(first.location, 'method');
  assert.equal(first.attributeConstructor.parameters.length, 2);
  assert.deepEqual(first.arguments.map(argument => argument.constantValue.value), [3, 'ab']);
  assert.deepEqual(first.named.map(entry => [entry.name, entry.member.name, entry.value.constantValue.value]), [['Order', 'Order', 7]]);
  assert.equal(second.location, 'return');
  assert.equal(second.attributeClass, mark);
});

test('SF-A02-T41 well-known attributes are decoded by the class they bind to, not by the name written', () => {
  const analysis = analysisOf(`using System;
using Old = System.ObsoleteAttribute;
namespace Mine { class ObsoleteAttribute : Attribute { public ObsoleteAttribute(string text) { } } class FlagsAttribute : Attribute { } }
[Flags] enum Real { A = 1 }
[Mine.Flags] enum Fake { A = 1 }
class Program {
  [Old("alias", true)] static void ViaAlias() { }
  [System.Obsolete] static void Qualified() { }
  [Mine.Obsolete("mine")] static void NotTheFrameworkOne() { }
  static void Main() { ViaAlias(); Qualified(); NotTheFrameworkOne(); }
}`);
  const program = typeNamed(analysis, 'Program'),
    obsoleteOf = name => program.getMembers(name)[0].obsolete;
  assert.deepEqual(obsoleteOf('ViaAlias'), { message: 'alias', isError: true });
  assert.deepEqual(obsoleteOf('Qualified'), { message: null, isError: false });
  assert.equal(obsoleteOf('NotTheFrameworkOne') ?? null, null);
  assert.equal(typeNamed(analysis, 'Real').isFlagsEnum, true);
  assert.equal(typeNamed(analysis, 'Fake').isFlagsEnum, undefined);
  assert.equal(attributesNamed(program.getMembers('NotTheFrameworkOne')[0], 'Mine.ObsoleteAttribute').length, 1);
  assert.deepEqual(analysis.diagnostics.map(d => d.code).sort(), ['CS0612', 'CS0619']);
});

test('SF-A02-T41 an obsolete use is not reported inside an obsolete declaration, and CS0619 fails the compilation', () => {
  const source = body => `using System;
class Program {
  [Obsolete("old")] static void Old() { }
  [Obsolete("gone", true)] static void Gone() { }
  [Obsolete] static void AlsoOld() { Old(); Gone(); }
  static void Main() { ${body} Console.WriteLine("ran"); }
}`;
  assert.deepEqual(codesOf(source('')), []);
  const warned = compile(source('Old();'));
  assert.deepEqual(warned.diagnostics.map(d => [d.code, d.severity]), [['CS0618', 'warning']]);
  assert.deepEqual(linesOf(source('Old();')), ['ran']);
  const failed = compile(source('Gone();'));
  assert.equal(failed.success, false);
  assert.deepEqual(failed.diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code)).map(d => d.code), ['CS0619']);
});

test('SF-A02-T41 locations and targets of each declaration kind', () => {
  const analysis = analysisOf(`using System;
delegate int D(int a);
struct S { }
interface I { }
enum E { A }
class C<T> {
  C() { }
  static C() { }
  int field;
  int Auto { get; set; }
  int Computed { get { return 0; } set { } }
  event Action FieldLike;
  event Action Custom { add { } remove { } }
  void M(int p) { }
  public static C<T> operator +(C<T> a, C<T> b) { return a; }
  ~C() { }
}`);
  const c = typeNamed(analysis, 'C'),
    locationsOf = symbol => Object.keys(attributeLocations(symbol).targets).join(' '),
    member = name => c.getMembers(name)[0];
  assert.equal(locationsOf(typeNamed(analysis, 'D')), 'type return');
  for (const [name, target] of [['S', 'Struct'], ['I', 'Interface'], ['E', 'Enum'], ['C', 'Class'], ['D', 'Delegate']])
    assert.equal(attributeLocations(typeNamed(analysis, name)).targets.type, AttributeTargets[target], name);
  assert.equal(attributeLocations(member('.ctor')).targets.method, AttributeTargets.Constructor);
  assert.equal(locationsOf(member('.ctor')), 'method');
  assert.equal(attributeLocations(member('.cctor')).targets.method, AttributeTargets.Constructor);
  assert.equal(locationsOf(member('field')), 'field');
  assert.equal(locationsOf(member('Auto')), 'property field');
  assert.equal(locationsOf(member('Computed')), 'property');
  assert.equal(locationsOf(member('Computed').getMethod), 'method return');
  assert.equal(locationsOf(member('Computed').setMethod), 'method param return');
  assert.equal(locationsOf(member('FieldLike')), 'event field method');
  assert.equal(locationsOf(member('Custom')), 'event');
  assert.equal(locationsOf(member('M')), 'method return');
  assert.equal(locationsOf(member('M').parameters[0]), 'param');
  assert.equal(locationsOf(c.typeParameters[0]), 'typevar');
  const mixed = AttributeTargets.Class | AttributeTargets.Property | AttributeTargets.GenericParameter;
  assert.equal(describeTargets(mixed), 'class, property, indexer, type parameter');
  assert.equal(describeTargets(AttributeTargets.All).split(', ').length, 16);
});

test('SF-A02-T41 an attribute class the registry does not list is a framework gap, never a false error', () => {
  // System.ComponentModel is a namespace of the base class library the registry does not model.
  assert.deepEqual(codesOf(`using System.ComponentModel;
[Browsable(false)] class Program { static void Main() { } }`), []);
  // A name that is no type at all is still reported, once per spelling as Roslyn does.
  assert.deepEqual(codesOf('[Nope] class Program { static void Main() { } }'), ['CS0246', 'CS0246']);
  // A namespace-qualified name the registry lacks is a gap too.
  assert.deepEqual(codesOf('[System.Runtime.CompilerServices.SkipLocalsInit] class Program { static void Main() { } }'), []);
});

test('SF-A02-T41 attribute arguments see constants of the enclosing type and report their own binding errors', () => {
  assert.deepEqual(
    codesOf(`using System;
class TextAttribute : Attribute { public TextAttribute(string text, int size) { } }
class Program {
  const string Prefix = "p";
  const int Size = 2;
  [Text(Prefix + "x", Size * 2)] static void Fine() { }
  [Text(Missing, 1)] static void Unknown() { }
  [Text("a")] static void TooFew() { }
  static void Main() { }
}`),
    ['CS0103', 'CS7036'],
  );
});
