import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, AssemblyUsageAnalysis, codedIndex, encodeSignature } from '@sharpforge/cil';
import { createAssemblyMethodRelations, LoadErrorCode } from '@sharpforge/clr';
import { baseContext } from './clr-methods-base-fixtures.js';
import { declarationFixture, declarationTokens as t } from './fixtures/declaration-relations/input.mjs';

const code = expected => error => error.code === expected;
async function load(options) {
  const bytes = declarationFixture(options);
  const context = baseContext();
  const module = (await context.loadFromStream(bytes)).manifestModule;
  return { bytes, context, module };
}

test('A13 canonical class relations include each overridden ancestor and exclude newslot hiders', async () => {
  const { bytes, module } = await load();
  const snapshot = await createAssemblyMethodRelations(module);
  const graph = new AssemblyUsageAnalysis(new AssemblyInspector(bytes), { methodRelations: snapshot });
  assert.deepEqual(graph.query('overridden-by', t.rootM).entries.map(entry => entry.sourceToken), [t.middleM, t.leafM]);
  assert.deepEqual(graph.query('overridden-by', t.middleM).entries.map(entry => entry.sourceToken), [t.leafM]);
  assert.equal(graph.query('overridden-by', t.hiddenM).total, 0);
  assert.equal(graph.query('overridden-by', t.rootM).complete, true);
  assert.equal(module.methodBodyReadCount, 0);
  assert.deepEqual(snapshot.diagnostics, []);
});

test('A13 interface maps distinguish inherited virtual slots, explicit implementations and reimplementation', async () => {
  const { module, bytes } = await load();
  const snapshot = await createAssemblyMethodRelations(module);
  const graph = new AssemblyUsageAnalysis(new AssemblyInspector(bytes), { methodRelations: snapshot });
  const observations = token => graph.query('implemented-by', token).entries
    .map(entry => [entry.implementingTypeToken, entry.sourceToken, entry.implementationKind]);
  assert.deepEqual(observations(t.contractM), [
    [t.root, t.rootM, 'implicit'], [t.middle, t.middleM, 'implicit'], [t.hidden, t.middleM, 'inherited'],
    [t.leaf, t.leafM, 'inherited'], [t.reimplemented, t.reimplementedM, 'implicit'],
  ]);
  assert.deepEqual(observations(t.contractOther), [
    [t.root, t.rootOther, 'implicit'], [t.middle, t.explicitOther, 'explicit'], [t.hidden, t.explicitOther, 'inherited'],
    [t.leaf, t.explicitOther, 'inherited'], [t.reimplemented, t.rootOther, 'implicit'],
  ]);
  assert.equal(graph.query('implemented-by', t.contractM).complete, true);
  assert.equal(module.methodBodyReadCount, 0);
});

test('A13 explicit declarations resolve Module-scoped TypeRef aliases to canonical MethodDefs', async () => {
  const { module } = await load({ memberRef: true });
  const snapshot = await createAssemblyMethodRelations(module);
  assert.deepEqual(snapshot.diagnostics, []);
  assert.ok(snapshot.entries.some(entry => entry.relation === 'implemented-by' && entry.sourceToken === t.explicitOther &&
    entry.targetToken === t.contractOther && entry.implementingTypeToken === t.middle));
  assert.ok(snapshot.entries.every(entry => entry.sourceToken >>> 24 === 6 && entry.targetToken >>> 24 === 6));
});

test('A13 MemberRef implementation bodies resolve exactly while unsupported class-root classification stays explicit', async () => {
  const { module } = await load({ memberRef: true, memberRefBody: true });
  const snapshot = await createAssemblyMethodRelations(module);
  assert.ok(snapshot.entries.some(entry => entry.relation === 'implemented-by' && entry.sourceToken === t.explicitOther &&
    entry.targetToken === t.contractOther && entry.implementingTypeToken === t.middle));
  assert.ok(snapshot.diagnostics.some(entry => entry.relation === 'overridden-by' && entry.code === LoadErrorCode.TypeLoad));
});

test('A13 invalid MethodImpl bodies, canonical duplicate aliases and signature mismatches reject', async () => {
  const cases = [
    ({ md }) => { md.rows[25][0][1] = codedIndex('MethodDefOrRef', t.rootOther); },
    ({ md }) => { md.rows[25].push([...md.rows[25][0]]); },
    ({ md }) => { md.rows[6][3][4] = 0xffff; },
    ({ md, signature }) => {
      const alias = md.add(10, [codedIndex('MemberRefParent', t.contract), md.string('Other'), signature]);
      md.add(25, [3, codedIndex('MethodDefOrRef', t.explicitOther), codedIndex('MethodDefOrRef', alias)]);
    },
    ({ md }) => {
      md.rows[6][3][4] = md.blob(encodeSignature({ kind: 'method', hasThis: true,
        returnType: { kind: 'primitive', name: 'int' }, parameters: [] }));
    },
  ];
  for (const decorate of cases) {
    const { module } = await load({ decorate });
    await assert.rejects(createAssemblyMethodRelations(module), code(LoadErrorCode.InvalidImage));
  }
});

test('A13 declaration budgets reject exact excess, invalid options and cancellation without reading bodies', async () => {
  const { module } = await load();
  const snapshot = await createAssemblyMethodRelations(module);
  const limits = { maxMetadataRows: snapshot.storage.metadataRows, maxMethods: snapshot.storage.methods,
    maxMetadataBytes: snapshot.storage.metadataBytes, maxWork: snapshot.storage.work, maxRelations: snapshot.entries.length };
  assert.equal((await createAssemblyMethodRelations(module, limits)).entries.length, snapshot.entries.length);
  for (const [key, value] of Object.entries(limits)) {
    await assert.rejects(createAssemblyMethodRelations(module, { ...limits, [key]: value - 1 }), code(LoadErrorCode.LimitExceeded));
  }
  for (const options of [null, [], { maxWork: Infinity }, { maxMethods: -1 }, { maxRelations: 100001 }]) {
    await assert.rejects(createAssemblyMethodRelations(module, options), code(LoadErrorCode.InvalidConfiguration));
  }
  await assert.rejects(createAssemblyMethodRelations(module, { maxDepth: 0 }), code(LoadErrorCode.LimitExceeded));
  await assert.rejects(createAssemblyMethodRelations(module, { signal: AbortSignal.abort() }), code(LoadErrorCode.Cancelled));
  let checks = 0;
  await assert.rejects(createAssemblyMethodRelations(module, { signal: { get aborted() { return ++checks > 50; } } }),
    code(LoadErrorCode.Cancelled));
  assert.equal(module.methodBodyReadCount, 0);
});

test('A13 unsupported generic declaring types are diagnostics, with per-relation incomplete queries', async () => {
  const { module, bytes } = await load({ decorate({ md }) {
    md.add(42, [0, 0, codedIndex('TypeOrMethodDef', t.reimplemented), md.string('T')]);
  } });
  const snapshot = await createAssemblyMethodRelations(module);
  const graph = new AssemblyUsageAnalysis(new AssemblyInspector(bytes), { methodRelations: snapshot });
  assert.ok(snapshot.diagnostics.some(value => value.reason.includes('Generic declaring types')));
  assert.equal(graph.query('overridden-by', t.rootM).complete, false);
  assert.equal(graph.query('implemented-by', t.contractM).complete, false);
  assert.equal(graph.query('uses', t.rootM).complete, true);
  await assert.rejects(createAssemblyMethodRelations(module, { maxDiagnostics: 0 }), code(LoadErrorCode.LimitExceeded));
});

test('A13 same-name methods with different canonical signatures never satisfy an interface declaration', async () => {
  const { module } = await load({ decorate({ md }) {
    md.rows[6][1][4] = md.blob(encodeSignature({ kind: 'method', hasThis: true,
      returnType: { kind: 'primitive', name: 'string' }, parameters: [{ kind: 'primitive', name: 'int' }] }));
  } });
  await assert.rejects(createAssemblyMethodRelations(module), code(LoadErrorCode.InvalidImage));
});

test('A13 default and static virtual interface families stay explicit unsupported diagnostics', async () => {
  const changes = [
    ({ md }) => {
      md.rows[6][1][3] = md.string('Different');
      md.rows[6][8][2] = 0x1c6;
      md.rows[6][8][0] = md.rows[6][1][0];
    },
    ({ md }) => {
      md.rows[6][8][2] |= 0x10;
      md.rows[6][8][4] = md.blob(encodeSignature({ kind: 'method', hasThis: false,
        returnType: { kind: 'primitive', name: 'int' }, parameters: [{ kind: 'primitive', name: 'int' }] }));
    },
  ];
  for (const decorate of changes) {
    const { module } = await load({ decorate });
    const snapshot = await createAssemblyMethodRelations(module);
    assert.ok(snapshot.diagnostics.some(value => value.relation === 'implemented-by' && value.code === LoadErrorCode.TypeLoad));
  }
});

test('A13 unresolved base types cannot create guessed roots and remain retryable diagnostics', async () => {
  const { module } = await load({ decorate({ md }) {
    md.rows[2][1][3] = codedIndex('TypeDefOrRef', md.typeRef('Missing.Base'));
  } });
  const snapshot = await createAssemblyMethodRelations(module);
  assert.ok(snapshot.diagnostics.some(value => value.relation === 'overridden-by'));
  assert.ok(snapshot.diagnostics.some(value => value.relation === 'implemented-by'));
  assert.equal(snapshot.entries.filter(value => value.relation === 'overridden-by').length, 0);
});

test('A13 declaration snapshots are immutable scalar data after the collectible context unloads', async () => {
  const bytes = declarationFixture();
  const context = baseContext({ isCollectible: true });
  const module = (await context.loadFromStream(bytes)).manifestModule;
  const snapshot = await createAssemblyMethodRelations(module);
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.entries) && Object.isFrozen(snapshot.entries[0]));
  const inspector = new AssemblyInspector(bytes);
  const graph = new AssemblyUsageAnalysis(inspector, { methodRelations: snapshot });
  const original = graph.query('implemented-by', t.contractM);
  context.unload();
  inspector.pe.bytes.fill(0);
  inspector.metadata.rows.length = 0;
  assert.deepEqual(graph.query('implemented-by', t.contractM), original);
  assert.throws(() => { snapshot.entries[0].sourceToken = 0; }, TypeError);
});
