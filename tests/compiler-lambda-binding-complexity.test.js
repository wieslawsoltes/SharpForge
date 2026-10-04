import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { SemanticAnalysis } from '../packages/compiler/src/semantic-analysis.js';
import { lambdaShapes, overloadedLambdaShape } from '../packages/compiler/bench/lambda-shapes.js';

// Nested lambdas used to be bound 2^depth times (4^depth with two overloads): every binding of a body created fresh
// lambda nodes for the lambdas inside it, each of which was bound for its conversion and again to finish it.
// These tests count lambda body bindings, not wall time.

/** Analyses `source`; returns how many times a lambda body was bound, and the diagnostics. */
function lambdaWork(source) {
  const analysis = new SemanticAnalysis([parse(new SourceText(source, 'Program.cs'))], {});
  const result = analysis.run();
  return { bindings: analysis.lambdaBodyBindings ?? 0, errors: result.diagnostics.filter(d => d.severity === 'error').map(d => d.code) };
}

const depths = [2, 4, 8, 16];

for (const [name, source] of Object.entries(lambdaShapes)) {
  test(`lambda binding complexity: ${name} is polynomial in depth`, () => {
    const work = depths.map(depth => lambdaWork(source(depth)));
    for (const [index, depth] of depths.entries()) {
      assert.deepEqual(work[index].errors, [], `${name} at ${depth}`);
      // One speculative binding per enclosing level plus the final one: at most quadratic.
      assert(work[index].bindings <= depth * depth + 4 * depth + 8, `${name}: ${work[index].bindings} bindings at depth ${depth}`);
    }
    // Doubling the depth at most quadruples the work (2^depth would multiply it by 256 from 8 to 16).
    assert(work[3].bindings <= 4.5 * work[2].bindings, `${name}: ${work.map(w => w.bindings).join(', ')}`);
  });
}

test('lambda binding complexity: two overloads per level stay at three bindings per level', () => {
  const work = [3, 4, 5, 6].map(depth => lambdaWork(overloadedLambdaShape(depth)).bindings);
  for (let index = 1; index < work.length; index++)
    assert(work[index] <= 3.2 * work[index - 1] + 8, `bindings ${work.join(', ')} grow faster than 3^depth`);
});

test('lambda binding complexity: nested lambdas still compile and report their diagnostics once', () => {
  for (const [name, source] of Object.entries(lambdaShapes)) {
    const result = compile(source(6));
    assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error').map(d => d.code), [], name);
  }
  // An error in the innermost body is reported exactly once, whatever the nesting depth.
  for (const depth of [1, 3, 6]) {
    const source = lambdaShapes.lambdaArgument(depth).replace('=> 1)', '=> missing)');
    const codes = compile(source).diagnostics.filter(d => d.code === 'CS0103');
    assert.equal(codes.length, 1, `depth ${depth}`);
  }
  // A warning inside a nested block lambda (unused local) is reported once.
  for (const depth of [1, 3, 6]) {
    const source = lambdaShapes.blockLambdaArgument(depth).replace('{ return 1; }', '{ int unused; return 1; }');
    const result = compile(source);
    assert.equal(result.diagnostics.filter(d => d.code === 'CS0168').length, 1, `depth ${depth}`);
  }
});

test('lambda binding complexity: a body bound for inference is reused only when it needs no conversion', () => {
  const generic = 'static T F<T>(Func<int, T> f) { return f(1); }';
  const program = body => `using System; class Program { ${generic} static long G(Func<int, long> f) { return f(1); } static void Main() { ${body} } }`;
  // `x + 1` is an int: for Func<int, long> the body needs a conversion and is bound for that type.
  assert.deepEqual(lambdaWork(program('var a = G(x => x + 1);')).errors, []);
  assert.deepEqual(lambdaWork(program('var a = F(x => x + 1); long b = F(y => (long)y);')).errors, []);
  // A string does not convert to long: the error is reported, once.
  assert.deepEqual(lambdaWork(program('var a = G(x => "s");')).errors, ['CS0029', 'CS1662']);
});
