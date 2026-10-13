import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { createTypeDesc, TypeKind } from '../packages/clr/src/type-system/type-desc.js';
import { InstantiationClosures } from '../packages/clr/src/generics/instantiation-closure.js';
import { GenericResolutionContext } from '../packages/clr/src/generics/resolution-context.js';
import { arrayContext } from './clr-types-array-fixtures.js';
import { openGenerics, generic, variable } from './clr-generics-instantiation-fixtures.js';

const fails = code => error => error.code === code;

test('CLR finite-closure discovery has explicit depth and shared work bounds before loaded publication', async () => {
  const deep = await openGenerics({ typeOptions: { maxDepth: 6 } }, { decorate({ type, base, tokens }) {
    let previous = tokens.box;
    for (let index = 0; index < 10; index++) {
      const current = type(`Chain${index}\`1`, 1);
      base(previous, generic(current, [variable()]), `chain${index}`);
      previous = current;
    }
  } });
  await assert.rejects(deep.types.load(deep.module, deep.tokens.box), fails(LoadErrorCode.LimitExceeded));
  assert.equal(deep.definitions.box.isLoaded, false);
  const wide = await openGenerics({ typeOptions: { maxGenericWork: 100 } }, { decorate({ type, contract, tokens }) {
    for (let index = 0; index < 20; index++) {
      const current = type(`IContract${index}\`1`, 1, { flags: 0xa1 });
      contract(tokens.box, generic(current, [variable()]), `contract${index}`);
    }
  } });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(wide.types.load(wide.module, wide.tokens.box), fails(LoadErrorCode.LimitExceeded));
    assert.equal(wide.definitions.box.isLoaded, false);
  }
  assert.equal(await wide.types.load(wide.module, wide.specs.integer), wide.types.intrinsic('System.Int32'));
  assert.equal(deep.module.methodBodyReadCount + wide.module.methodBodyReadCount, 0);
});

test('CLR an absent base does not consume a closure depth level at the exact construction boundary', async () => {
  const types = arrayContext({ typeOptions: { maxDepth: 2 } }).types;
  const box = types.defineIntrinsic('Host.Box`1', { genericArity: 1 });
  const leaf = types.defineIntrinsic('Host.Leaf');
  const result = await types.instantiate(box, [leaf]);
  assert.equal(result.genericArguments[0], leaf);
  await assert.rejects(types.instantiate(box, [result]), fails(LoadErrorCode.LimitExceeded));
});

test('CLR bounded weak proof admission never turns cache exhaustion into acceptance or failure caching', async () => {
  const types = arrayContext().types;
  const good = types.defineIntrinsic('Host.Good');
  const other = types.defineIntrinsic('Host.Other');
  const invalid = types.defineIntrinsic('Host.Invalid');
  const counts = new Map();
  // Immutable identity-only templates exercise the same service seam as metadata templates.
  const service = new InstantiationClosures(type => {
    counts.set(type, (counts.get(type) ?? 0) + 1);
    return { baseType: type === invalid ? invalid : null, interfaces: [] };
  }, { maxEntries: 1, maxDepth: 16 });
  const prove = async type => {
    const work = new GenericResolutionContext(1000, undefined, () => { throw new Error('Noncollectible types need no monitor'); });
    try {
      await work.closure(service).require(type, {});
      work.complete();
      work.publishClosure();
    } finally { work.dispose(); }
  };
  await prove(good);
  await prove(good);
  assert.equal(counts.get(good), 1);
  for (let attempt = 0; attempt < 2; attempt++) {
    await prove(other);
    await assert.rejects(prove(invalid), fails(LoadErrorCode.TypeLoad));
  }
  assert.equal(counts.get(other), 2, 'A full optional proof cache rechecks an unadmitted successful key');
  assert.equal(counts.get(invalid), 2, 'Failures never become weak success admissions');
});

test('CLR finite-closure operation work remains linear for shared nested argument DAGs', async () => {
  const types = arrayContext().types;
  const pair = types.defineIntrinsic('Host.Pair`2', { genericArity: 2 });
  const subject = types.defineIntrinsic('Host.Subject`1', { genericArity: 1 });
  let nested = subject.genericParameters[0];
  // This internal graph fixture isolates closure work from the independent diagnostic-name length bound.
  // Each tuple is unique and created through the same TypeDesc factory as the canonical construction cache.
  for (let depth = 0; depth < 96; depth++) {
    nested = createTypeDesc({ kind: TypeKind.Instantiation, context: pair.loadContext, module: null, token: 0,
      fullName: `Shared${depth}`, genericDefinition: pair, genericArguments: Object.freeze([nested, nested]) });
  }
  const service = new InstantiationClosures(type => ({ baseType: type === subject ? nested : null, interfaces: [] }),
    { maxEntries: 100, maxDepth: 256 });
  let visits = 0;
  const work = {
    visit(count = 1) { visits += count; assert.ok(visits <= 8000, 'Shared DAGs must not expand into occurrence trees'); },
    observe() {},
  };
  const operation = service.operation(work);
  try { await operation.require(subject, {}); }
  finally { operation.dispose(); }
  assert.ok(visits > 96);
});

test('CLR reentrant proof reads consume the first completed template without waiting on a pending self-promise', async () => {
  const types = arrayContext().types;
  const target = types.defineIntrinsic('Host.Target');
  const good = types.defineIntrinsic('Host.Good');
  const discarded = types.defineIntrinsic('Host.Discarded', { baseType: target });
  let nested = false;
  let targetReads = 0;
  let discardedReads = 0;
  let operation;
  const service = new InstantiationClosures(async type => {
    if (type === discarded) discardedReads++;
    if (type !== target) return { baseType: type.baseType, interfaces: type.interfaces };
    targetReads++;
    if (nested) return { baseType: good, interfaces: [] };
    nested = true;
    await operation.require(target, {});
    return { baseType: discarded, interfaces: [] };
  }, { maxEntries: 100, maxDepth: 16 });
  const work = new GenericResolutionContext(2000, undefined, () => { throw new Error('Unexpected collectible monitor'); });
  operation = work.closure(service);
  try {
    await operation.require(target, {});
    assert.equal(operation.template(target).baseType, good);
    assert.equal(Object.isFrozen(operation.template(target)), true);
    assert.equal(Object.isFrozen(operation.template(target).interfaces), true);
    assert.equal(targetReads, 2);
    assert.equal(discardedReads, 0, 'The alternate result is discarded before discovery or proof admission');
    work.complete();
    work.publishClosure();
  } finally { work.dispose(); }
});
