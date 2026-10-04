import test from 'node:test';
import assert from 'node:assert/strict';
import { Compilation, compile } from '@sharpforge/compiler';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { nestingShapes } from '../packages/compiler/bench/nesting-shapes.js';
import { InferenceCache, MemoizedInference, CallScopedInference } from '../packages/compiler/src/binder/inference-cache.js';

// Compile time must be linear in the length of a call or member chain. The string-typed pipeline used to infer a
// receiver's type three times per enclosing node (3^depth). These tests count `infer` evaluations, not wall time.

/** Compiles `source`; returns the number of `infer` evaluations not answered from the memo, and the result. */
function inferenceWork(source, pipeline = 'bound') {
  const compilation = new Compilation([parse(new SourceText(source, 'Program.cs'))], { pipeline });
  const result = compilation.build();
  const units = compilation.boundPipeline.units;
  return { result, computations: units.reduce((sum, unit) => sum + (unit.binder.inferredTypes?.computations ?? 0), 0) };
}

const depths = [4, 8, 16, 32, 64];

for (const [name, source] of Object.entries(nestingShapes)) {
  test(`inference complexity: ${name} is linear in depth`, () => {
    const work = depths.map(depth => inferenceWork(source(depth)).computations);
    for (let index = 1; index < depths.length; index++) {
      const growth = work[index] - work[index - 1],
        added = depths[index] - depths[index - 1];
      // At most a constant number of inferences per added level: doubling the depth at most doubles the work.
      assert(growth <= 4 * added, `${name}: ${work.join(', ')} evaluations at depths ${depths.join(', ')}`);
    }
    assert(work.at(-1) <= 4 * depths.at(-1) + 16, `${name}: ${work.at(-1)} evaluations at depth ${depths.at(-1)}`);
  });
}

test('inference complexity: shapes compile without errors at the depths the benchmark reports', () => {
  for (const [name, source] of Object.entries(nestingShapes))
    for (const depth of [4, 12, 24]) {
      const result = compile(source(depth));
      assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error').map(d => d.code), [], `${name} at ${depth}`);
    }
});

test('inference complexity: the legacy method compiler handles a 64-level chain', () => {
  // Call-scoped memo: each query is linear, so the whole chain is quadratic at worst; 3^64 would never finish.
  for (const name of ['callChain', 'memberChain', 'genericCallChain', 'genericMemberChain']) {
    const compilation = new Compilation([parse(new SourceText(nestingShapes[name](64), 'Program.cs'))], { pipeline: 'legacy' });
    assert.equal(typeof compilation.build().success, 'boolean', name);
  }
});

test('inference complexity: memoized and legacy pipelines report the same diagnostics for a chain', () => {
  const source = nestingShapes.callChain(10).replace('.Wrap();', '.Missing();');
  const key = d => [d.code, d.start, d.length, d.message].join('|');
  const bound = new Compilation([parse(new SourceText(source, 'Program.cs'))], { pipeline: 'bound' }).build();
  const legacy = new Compilation([parse(new SourceText(source, 'Program.cs'))], { pipeline: 'legacy' }).build();
  assert.equal(bound.success, false);
  assert.deepEqual(bound.diagnostics.map(key).sort(), legacy.diagnostics.map(key).sort());
});

/** A base whose `infer` counts evaluations and reads a local from mutable state. */
class CountingBase {
  constructor() {
    this.c = { methods: [], types: [] };
    this.evaluations = 0;
    this.locals = new Map();
    this.scope = { name: 'outer' };
  }

  local(name, type) {
    this.locals.set(name, type);
    return { name, type };
  }

  infer(node) {
    this.evaluations++;
    if (node.kind === 'Name') return this.locals.get(node.name) ?? 'error';
    return this.infer(node.target) === 'error' ? 'error' : 'int';
  }
}

test('inference memo: a type is remembered until a scope, a local or a declaration changes', () => {
  const binder = new (MemoizedInference(CountingBase))();
  const name = { kind: 'Name', name: 'x' },
    member = { kind: 'Member', target: name };
  assert.equal(binder.infer(member), 'error');
  assert.equal(binder.infer(member), 'error');
  assert.equal(binder.evaluations, 2, 'the second query is answered from the memo');
  assert.equal(binder.inferredTypes.hits, 1);

  binder.local('x', 'string');
  assert.equal(binder.infer(member), 'int', 'declaring a local forgets the remembered types');

  const evaluations = binder.evaluations;
  binder.scope = { name: 'inner' };
  binder.infer(member);
  assert.equal(binder.evaluations, evaluations + 2, 'entering a scope forgets the remembered types');

  binder.c.methods.push({});
  binder.infer(member);
  assert.equal(binder.evaluations, evaluations + 4, 'a newly declared method forgets the remembered types');
  binder.c.types.push({});
  binder.infer(member);
  assert.equal(binder.evaluations, evaluations + 6, 'a newly declared type forgets the remembered types');
  binder.infer(name);
  assert.equal(binder.evaluations, evaluations + 6);
  assert.equal(binder.infer(null), 'error');
});

test('inference memo: the call-scoped policy forgets everything when the outermost query returns', () => {
  const compiler = new (CallScopedInference(CountingBase))();
  const name = { kind: 'Name', name: 'x' },
    inner = { kind: 'Member', target: name };
  compiler.infer(inner);
  assert.equal(compiler.evaluations, 2);
  assert.equal(compiler.inferredTypes.types.size, 0, 'nothing outlives the outermost query');
  compiler.locals.set('x', 'int');
  assert.equal(compiler.infer(inner), 'int', 'state changed between queries is seen without an invalidation hook');
  assert.equal(compiler.infer(null), 'error');
});

test('inference memo: a result computed across a forget is not stored', () => {
  const cache = new InferenceCache();
  cache.types.set('node', 'int');
  const generation = cache.generation;
  cache.forget();
  assert.equal(cache.types.size, 0);
  assert.equal(cache.generation, generation + 1);
  cache.syncDeclarations({ methods: [1], types: [] });
  cache.types.set('node', 'int');
  cache.syncDeclarations({ methods: [1], types: [] });
  assert.equal(cache.types.size, 1, 'unchanged declarations keep the memo');
  cache.syncDeclarations({ methods: [1, 2], types: [] });
  assert.equal(cache.types.size, 0);
});
