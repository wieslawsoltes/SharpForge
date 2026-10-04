/**
 * SF-A02-T47: unsafe code. The Roslyn-pinned cases are in packages/compiler/test/differential/fixtures/unsafe-code.js
 * (fixtures marked `allowUnsafe` are compiled with /unsafe on both sides); these tests cover the pure rule functions,
 * the option, and what code generation does with unsafe code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { coreTypes } from '../packages/compiler/src/symbols/core-types.js';
import { PointerTypeSymbol } from '../packages/compiler/src/symbols/types.js';
import { Conversions } from '../packages/compiler/src/conversions/classify.js';
import { pointerConversionKind } from '../packages/compiler/src/conversions/pointer.js';
import { pointerBinaryOperator, pointerUnaryOperator } from '../packages/compiler/src/overload/pointer-operators.js';
import { isManagedType, findPointerSyntax } from '../packages/compiler/src/binder/unsafe-declarations.js';
import { linesOf } from './support/semantic-codegen.js';

const core = coreTypes(),
  conversions = new Conversions(core),
  pointerTo = type => new PointerTypeSymbol(type),
  intPointer = pointerTo(core.int),
  voidPointer = pointerTo(core.void);
const codes = (source, options) => compile(source, options).diagnostics.filter(d => /^CS/.test(d.code)).map(d => d.code);

test('SF-A02-T47 pointer conversions: to void* implicitly, between pointers and integers explicitly', () => {
  const kind = (from, to) => pointerConversionKind(from, to, type => conversions.kindOf(type));
  assert.equal(kind(intPointer, voidPointer), 'ImplicitPointerToVoid');
  assert.equal(kind(voidPointer, intPointer), 'ExplicitPointerToPointer');
  assert.equal(kind(intPointer, pointerTo(core.double)), 'ExplicitPointerToPointer');
  assert.equal(kind(intPointer, core.long), 'ExplicitPointerToInteger');
  assert.equal(kind(core.byte, intPointer), 'ExplicitIntegerToPointer');
  assert.equal(kind(intPointer, core.double), null);
  assert.equal(kind(core.string, intPointer), null);
  assert.equal(kind(intPointer, core.object), null);
  assert.equal(conversions.classifyImplicit(intPointer, voidPointer).isImplicit, true);
  assert.equal(conversions.classifyImplicit(voidPointer, intPointer).exists, false);
  assert.equal(conversions.classifyExplicit(voidPointer, intPointer).isExplicit, true);
  assert.equal(conversions.classifyImplicit(intPointer, core.object).exists, false);
});

test('SF-A02-T47 pointer operators: offsets, distances and comparisons', () => {
  const offsetType = (expression, kind) => (expression.type === core.keyword(kind) ? expression.type : null),
    operator = (text, left, right) => pointerBinaryOperator(text, left, right, core, offsetType),
    p = { type: intPointer },
    q = { type: pointerTo(core.double) },
    v = { type: voidPointer },
    i = { type: core.int },
    nothing = { type: null, literal: 'null' };
  assert.equal(operator('+', p, i).resultType, intPointer);
  assert.equal(operator('+', i, p).resultType, intPointer);
  assert.equal(operator('-', p, i).resultType, intPointer);
  assert.equal(operator('-', i, p), null);
  assert.equal(operator('-', p, p).resultType, core.long);
  assert.equal(operator('-', p, q), null);
  assert.equal(operator('+', p, p), null);
  assert.equal(operator('*', p, i), null);
  assert.equal(operator('<', p, q).resultType, core.bool);
  assert.equal(operator('==', p, nothing).resultType, core.bool);
  assert.equal(operator('==', p, i), null);
  assert.equal(operator('+', v, i).code, 'CS0242');
  assert.equal(operator('+', i, i), null);
  assert.equal(pointerUnaryOperator('++', p).resultType, intPointer);
  assert.equal(pointerUnaryOperator('--', v).code, 'CS0242');
  assert.equal(pointerUnaryOperator('-', p), null);
});

test('SF-A02-T47 managed types and pointer syntax', () => {
  const analysis = analyze([
    parse(new SourceText('struct Plain { int a; Plain2 b; } struct Plain2 { double d; } struct Holds { Plain p; string s; } class C { int*[] f; }', 'a.cs')),
  ]);
  const type = name => analysis.assembly.types.find(candidate => candidate.name === name);
  assert.equal(isManagedType(core.int), false);
  assert.equal(isManagedType(core.string), true);
  assert.equal(isManagedType(core.arrayOf(core.int)), true);
  assert.equal(isManagedType(intPointer), false);
  assert.equal(isManagedType(type('Plain')), false);
  assert.equal(isManagedType(type('Holds')), true);
  const field = type('C').getMembers('f')[0];
  assert.equal(findPointerSyntax(field.typeSyntax).toString().trim(), 'int*');
  assert.equal(findPointerSyntax(type('Plain').getMembers('a')[0].typeSyntax), null);
});

test('SF-A02-T47 the unsafe modifier and block need the allowUnsafe option', () => {
  const source = `using System;
class Program {
  static unsafe int Twice(int value) { return value * 2; }
  static void Main() { unsafe { Console.WriteLine(Twice(4) + sizeof(int)); } }
}`;
  assert.deepEqual(codes(source), ['CS0227', 'CS0227']);
  assert.deepEqual(codes(source, { allowUnsafe: true }), []);
  assert.deepEqual(linesOf(source, { allowUnsafe: true }), ['12']);
});

test('SF-A02-T47 pointers bind without errors and are reported as not executable', () => {
  const result = compile(
    `using System;
unsafe class Program {
  static void Main() { int x = 1; int* p = &x; *p = 2; Console.WriteLine(x); }
}`,
    { allowUnsafe: true },
  );
  assert.equal(result.image, null);
  // No C# error: the program is valid. The profile's own diagnostics stay next to the one SF2200 that names the gap.
  assert.deepEqual(result.diagnostics.filter(d => /^CS/.test(d.code)), []);
  const errors = result.diagnostics.filter(d => d.code === 'SF2200');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /pointer types \(the image has no addressable storage\)/);
});

test('SF-A02-T47 pointers outside an unsafe context are CS0214 wherever they are written', () => {
  const source = body => `class Program { ${body} static void Main() { } }`;
  assert.deepEqual(codes(source('int* field;'), { allowUnsafe: true }).filter(code => code !== 'CS0169'), ['CS0214']);
  assert.deepEqual(codes(source('static void M(int* p) { }'), { allowUnsafe: true }), ['CS0214']);
  assert.deepEqual(codes(source('static void M() { int x = 0; int* p = &x; }'), { allowUnsafe: true }), ['CS0214', 'CS0214']);
  assert.deepEqual(codes(source('unsafe static void M() { int x = 0; int* p = &x; }'), { allowUnsafe: true }), []);
  assert.deepEqual(codes(source('static void M() { System.Action a = () => { unsafe { int x = 0; int* p = &x; } }; }'), { allowUnsafe: true }), []);
});
