import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { VirtualMachine } from '@sharpforge/runtime';
import { applicableRuleCodes, needsSemanticRules } from '../packages/compiler/src/semantic/profile-rechecks.js';

// A type named `var` (SF-A02-T52). The Roslyn-pinned programs are the `var-type-name` fixtures of
// packages/compiler/test/differential.

const program = (body, declarations = 'class var { public int X = 3; }') =>
  `using System; ${declarations} class Program { static void Main() { ${body} } }`;
const errorsOf = source =>
  compile(source)
    .diagnostics.filter(d => d.severity === 'error')
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
const parsed = source => [parse(new SourceText(source, 'Program.cs'))];

test('with a class named var, `var x = e` declares a variable of that class: no inference', () => {
  assert.deepEqual(errorsOf(program('var w = 5;')), ['CS0029:5']);
  assert.deepEqual(errorsOf(program('var s = "text"; var v = new var();')), ['CS0029:"text"']);
  // The pipeline's own warning about the wrongly inferred local is not kept next to the error.
  assert.deepEqual(compile(program('var w = 5;')).diagnostics.map(d => d.code), ['CS0029']);
});

test('a valid program with a class named var still compiles on the execution pipeline and runs', () => {
  const result = compile(program('var v = new var(); Console.WriteLine(v.X);'));
  assert.equal(result.success, true);
  assert.equal(new VirtualMachine(result.image).run().output, '3\n');
});

test('the analysis is consulted only for programs that declare a type or alias named var', () => {
  assert.equal(needsSemanticRules(parsed(program('var w = 5;', ''))), false);
  assert.equal(needsSemanticRules(parsed(program('int variable = 5;', 'class variance { }'))), false);
  assert.deepEqual([...applicableRuleCodes(parsed(program('var w = 5;')))].sort(), ['CS0029', 'CS0037', 'CS0266']);
  assert.equal(needsSemanticRules(parsed('using var = System.Int32; class Program { static void Main() { } }')), true);
});

test('only the rules of the constructs a program has are taken from the analysis', () => {
  // Two catch clauses select the catch rules; the codes of the `var` rule are not among them.
  const source = program('try { } catch (Exception) { } catch { }', '');
  const codes = applicableRuleCodes(parsed(source));
  assert.equal(codes.has('CS1017'), true);
  assert.equal(codes.has('CS0029'), false);
});
