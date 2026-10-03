import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { SymbolKind } from '../packages/compiler/src/symbols/types.js';
import { MethodKind } from '../packages/compiler/src/symbols/members.js';
import { pairPartialMethods, isUnimplementedPartial, isPartialMethod } from '../packages/compiler/src/binder/partial-methods.js';

// SF-A02-T54: partial methods. The Roslyn-pinned programs are the `partial-methods` fixtures of
// packages/compiler/test/differential; these tests cover the pairing rule on its own and the boundaries.

/** A stand-in method symbol: only what pairing reads. */
const part = (name, hasBody, words = ['partial']) => ({
  kind: SymbolKind.Method,
  methodKind: MethodKind.Ordinary,
  name,
  signatureKey: name + '()',
  hasBody,
  modifierWords: words,
});

const codesOf = source =>
  compile(source)
    .diagnostics.filter(d => d.code.startsWith('CS'))
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);

test('A02-T54 pairing links the parts and leaves the definition in the member list', () => {
  const definition = part('M', false),
    implementation = part('M', true),
    other = part('Other', false, []),
    members = [definition, other, implementation];
  assert.deepEqual(pairPartialMethods(members), []);
  assert.deepEqual(members, [definition, other]);
  assert.equal(definition.partialImplementationPart, implementation);
  assert.equal(implementation.partialDefinitionPart, definition);
  assert.equal(isUnimplementedPartial(definition), false);
});

test('A02-T54 pairing: the implementation may come first; the definition is still the member', () => {
  const implementation = part('M', true),
    definition = part('M', false),
    members = [implementation, definition];
  assert.deepEqual(pairPartialMethods(members), []);
  assert.deepEqual(members, [definition]);
});

test('A02-T54 pairing: repeated parts stay members and are reported', () => {
  const first = part('M', false),
    second = part('M', false),
    implementation = part('M', true),
    extra = part('M', true),
    members = [first, second, implementation, extra];
  const rows = pairPartialMethods(members);
  assert.deepEqual(
    rows.map(row => [row.code, row.member]),
    [
      ['CS0756', second],
      ['CS0757', extra],
    ],
  );
  assert.deepEqual(members, [first, second, extra]);
  assert.equal(first.partialImplementationPart, implementation);
});

test('A02-T54 a definition alone is unimplemented; a method that is not partial never is', () => {
  const definition = part('M', false);
  pairPartialMethods([definition]);
  assert.equal(isUnimplementedPartial(definition), true);
  assert.equal(isPartialMethod(part('M', false, ['static'])), false);
  assert.equal(isUnimplementedPartial(part('M', false, ['abstract'])), false);
});

test('A02-T54 calls to an unimplemented partial method are removed with their arguments, on both back ends', () => {
  const source =
    'using System; partial class C { partial void Gone(int x); partial void Kept(int x); ' +
    'public void Run() { Gone(Side()); Kept(Side()); } static int Side() { Console.WriteLine("side"); return 1; } } ' +
    'partial class C { partial void Kept(int x) { Console.WriteLine("kept " + x); } } ' +
    'class P { static void Main() { new C().Run(); } }';
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(new VirtualMachine(result.image).run().output, 'side\nkept 1\n');
  const il = compileToIL(source, { includeDebug: false });
  assert.equal(il.success, true);
  assert.equal(new CilVirtualMachine(il.assembly).run().output, 'side\nkept 1\n');
});

test('A02-T54 a valid program with partial methods no longer reports SF2010', () => {
  const source = 'partial class C { partial void M(); partial void M() { } static void Main() { new C().M(); } }';
  assert.deepEqual(compile(source).diagnostics, []);
});

test('A02-T54 declaration rules are reported on the method name', () => {
  assert.deepEqual(codesOf('partial class C { partial void M() { } static void Main() { } }'), ['CS0759:M']);
  assert.deepEqual(codesOf('class C { partial void M(); static void Main() { } }'), ['CS0751:M']);
  assert.deepEqual(codesOf('partial class C { public partial void M(); static void Main() { } }'), ['CS8795:M']);
  assert.deepEqual(codesOf('partial class C { partial int M(); static void Main() { } }'), ['CS8796:M']);
});

test('A02-T54 a delegate cannot point at an unimplemented partial method (CS0762)', () => {
  const source = 'partial class C { partial void M(); void Use() { System.Action a = M; a(); } static void Main() { } }';
  const errors = compile(source).diagnostics.filter(d => d.code.startsWith('CS'));
  assert.deepEqual(
    errors.map(d => [d.code, d.message]),
    [['CS0762', "Cannot create delegate from method 'C.M()' because it is a partial method without an implementing declaration"]],
  );
});
