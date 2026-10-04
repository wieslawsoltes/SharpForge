import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '@sharpforge/compiler';
import { closureScopes } from '../packages/compiler/src/emit/cil/closure-scopes.js';

// SF-A02-T30: lambdas and local functions inside a generic local function (what they become is generic over the type
// parameters of the method and of every generic local function around them), and using resources that a lambda
// captures (disposed from a copy, not from the closure cell). Reference on real .NET: the Roslyn-pinned programs
// `reduced-functional/lambdas-in-generic-local-functions`, `reduced-functional/captured-using-resources` and
// `stress-threading/lazy-pool-rwlock` (tests/compiler-stress-corpus.test.js).

const errorsOf = source =>
  compileToAssembly(source, { name: 'Fixture' })
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => entry.code + ' ' + entry.message);

test('A02-T30 a lambda inside a generic local function emits', () => {
  const source = `using System;
static class Program {
  static void Main() {
    T Twice<T>(T seed, Func<T, T> step) { T Once(T value) => step(value); Func<T, T> both = value => Once(Once(value)); return both(seed); }
    Console.WriteLine(Twice(4, x => x + 1));
  }
}`;
  assert.deepEqual(errorsOf(source), []);
});

test('A02-T30 a captured using resource emits', () => {
  const source = `using System;
sealed class Resource : IDisposable { public bool Open = true; public void Dispose() { Open = false; } }
static class Program {
  static void Main() {
    using var resource = new Resource();
    Func<bool> open = () => resource.Open;
    Console.WriteLine(open());
  }
}`;
  assert.deepEqual(errorsOf(source), []);
});

test('A02-T30 closure scopes: each generic local function adds its type parameters for what it contains', () => {
  const outerParameter = { name: 'TMethod' },
    innerParameter = { name: 'T' },
    variable = { name: 'seen' },
    innerLambda = { kind: 'Lambda', body: { kind: 'Block', statements: [] } },
    generic = { typeParameters: [innerParameter], body: { kind: 'Block', statements: [innerLambda] } },
    outerLambda = { kind: 'Lambda', body: { kind: 'Block', statements: [] } },
    root = { kind: 'Block', statements: [{ kind: 'LocalFunction', method: generic }, outerLambda] },
    context = { owner: {}, typeParameters: [outerParameter] },
    declared = new Map([[generic, { declared: new Set([variable]) }]]),
    scopes = closureScopes(root, context, { of: key => declared.get(key) ?? null });
  assert.equal(scopes.ofFunction.get(generic), context);
  assert.equal(scopes.ofFunction.get(outerLambda), context);
  assert.deepEqual(scopes.ofFunction.get(innerLambda).typeParameters, [outerParameter, innerParameter]);
  assert.equal(scopes.ofVariable.get(variable), scopes.ofFunction.get(innerLambda));
});
