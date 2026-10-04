import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector, AssemblyUsageAnalysis, CilError, readMethodHeader } from '@sharpforge/cil';
import { usageFixture } from './fixtures/usage-relations/input.mjs';

function fixture(options) {
  const input = usageFixture(), inspector = new AssemblyInspector(input.bytes);
  return { ...input, inspector, graph: new AssemblyUsageAnalysis(inspector, options) };
}

test('four instruction relations resolve exact local aliases and preserve occurrence order', () => {
  const { graph, tokens: t, inspector } = fixture();
  const uses = graph.query('uses', t.run);
  assert.deepEqual(uses.entries.map(edge => edge.opcode), ['newobj', 'stfld', 'ldfld', 'call', 'stsfld', 'call', 'ldsfld', 'ldtoken', 'newarr']);
  assert.ok(uses.entries.every(edge => edge.source === inspector.tokenUri(t.run)));
  assert.deepEqual(graph.query('used-by', t.read).entries.map(edge => edge.operandToken), [t.readRef, t.read]);
  assert.equal(graph.query('used-by', t.readRef).total, 1);
  assert.deepEqual(graph.query('assigned-by', t.value).entries.map(edge => edge.opcode), ['stfld']);
  assert.deepEqual(graph.query('assigned-by', t.shared).entries.map(edge => edge.opcode), ['stsfld']);
  const constructed = graph.query('instantiated-by', t.type);
  assert.equal(constructed.total, 1); // newarr uses the element type, but does not construct an element instance.
  assert.equal(constructed.entries[0].targetToken, t.constructor);
  assert.equal(constructed.entries[0].instantiatedTypeToken, t.type);
  assert.equal(inspector.cache.size, 0);
});

test('external targets stay explicit instead of binding to guessed display names', () => {
  const { graph, tokens: t } = fixture();
  const edge = graph.query('uses', t.external).entries[0];
  assert.equal(edge.targetToken, t.externalRef);
  assert.equal(edge.status, 'unknown');
  assert.equal(edge.reason, 'unresolved-member-owner');
  assert.equal(graph.query('used-by', t.externalRef).entries[0].sourceToken, t.external);
  assert.throws(() => graph.query('overridden-by', t.read), /unsupported relation/);
  assert.throws(() => graph.query('implemented-by', t.read), /unsupported relation/);
});

test('owned pages and scalar indexes survive destruction of caller PE and metadata', () => {
  const { graph, tokens: t, inspector } = fixture();
  const original = graph.query('uses', t.run);
  assert.equal(graph.query('uses', t.run, { limit: 0 }).nextOffset, null);
  const page = graph.query('uses', t.run, { offset: 1, limit: 2 });
  assert.deepEqual(page.entries, original.entries.slice(1, 3));
  assert.equal(page.nextOffset, 3);
  assert.equal(graph.query('uses', t.run, { offset: 100 }).total, 9);
  page.entries[0].targetToken = 0;
  graph.storage.usages = 0;
  inspector.pe.bytes.fill(0); inspector.metadata.rows.length = 0; inspector.methods.clear();
  assert.deepEqual(graph.query('uses', t.run), original);
  assert.ok(graph.storage.usages > 0);
});

test('aggregate body, instruction and occurrence budgets reject exact excess before expansion', () => {
  const { graph, inspector } = fixture(), storage = graph.storage;
  const limits = { maxMethods: storage.methods, maxCodeBytes: storage.codeBytes,
    maxInstructions: storage.instructions, maxUsages: storage.usages };
  assert.ok(new AssemblyUsageAnalysis(inspector, limits));
  for (const [key, value] of Object.entries(limits))
    assert.throws(() => new AssemblyUsageAnalysis(inspector, { ...limits, [key]: value - 1 }), /limit exceeded/);
  assert.throws(() => new AssemblyUsageAnalysis(inspector, { maxMethodCodeBytes: 0 }), /code bytes/);
  inspector.metadata.string = () => { throw Error('decoded names before byte preflight'); };
  assert.throws(() => new AssemblyUsageAnalysis(inspector, { maxCodeBytes: 0 }), /code bytes/);
  assert.throws(() => new AssemblyUsageAnalysis(inspector, { maxUsages: 0 }), /occurrences/);
});

test('invalid options/tokens, cancellation and metadata budget boundaries remain explicit', () => {
  const { graph, tokens: t, inspector } = fixture();
  for (const options of [null, [], { maxUsages: -1 }, { maxMethods: Infinity }, { metadataLimits: null }])
    assert.throws(() => new AssemblyUsageAnalysis(inspector, options), CilError);
  for (const options of [null, [], { limit: 1001 }, { limit: 0.5 }, { offset: -1 }])
    assert.throws(() => graph.query('uses', t.run, options), CilError);
  for (const token of [0, 0x106000003, 0x0600ffff, t.run + 0.1]) assert.throws(() => graph.query('uses', token), CilError);
  assert.throws(() => new AssemblyUsageAnalysis(inspector, { signal: AbortSignal.abort() }), /cancelled/);
  assert.throws(() => graph.query('uses', t.run, { signal: AbortSignal.abort() }), /cancelled/);
  let checks = 0;
  assert.throws(() => new AssemblyUsageAnalysis(inspector, { signal: { get aborted() { return ++checks > 7; } } }), /cancelled/);
  assert.throws(() => new AssemblyUsageAnalysis(inspector, { metadataLimits: { maxMemberBytes: 0 } }), /limit exceeded/);
});

test('malformed IL or operand kinds reject; native method bodies are explicit incomplete input', () => {
  const { inspector, tokens: t } = fixture();
  const header = readMethodHeader(inspector.pe, t.run);
  inspector.pe.bytes[header.codeOffset] = 0xff;
  assert.throws(() => new AssemblyUsageAnalysis(inspector), /Unsupported CIL opcode/);
  const wrong = fixture();
  const start = readMethodHeader(wrong.inspector.pe, wrong.tokens.run).codeOffset;
  new DataView(wrong.inspector.pe.bytes.buffer, wrong.inspector.pe.bytes.byteOffset).setUint32(start + 1, wrong.tokens.value, true);
  assert.throws(() => new AssemblyUsageAnalysis(wrong.inspector), /metadata token/);
  const native = fixture();
  native.inspector.metadata.rows[6][2][1] = 1;
  const graph = new AssemblyUsageAnalysis(native.inspector);
  assert.deepEqual(graph.diagnostics, [{ token: native.tokens.run, reason: 'non-cil-method' }]);
  graph.diagnostics[0].reason = 'changed';
  assert.equal(graph.query('uses', native.tokens.run).complete, false);
  assert.equal(graph.query('uses', native.tokens.run).total, 0);
  assert.equal(graph.diagnostics[0].reason, 'non-cil-method');
});

test('legacy callGraph keeps exact calls, per-method errors and normal cache behavior', () => {
  const { inspector, tokens: t } = fixture();
  const edges = inspector.callGraph();
  assert.deepEqual(edges.filter(edge => edge.caller === t.run).map(edge => edge.kind), ['newobj', 'call', 'call']);
  assert.ok(inspector.cache.size > 0);
  const bad = fixture();
  bad.inspector.pe.bytes[readMethodHeader(bad.inspector.pe, bad.tokens.run).codeOffset] = 0xff;
  const failed = bad.inspector.callGraph().find(edge => edge.caller === bad.tokens.run);
  assert.match(failed.error, /Unsupported CIL opcode/);
  assert.equal(failed.callee, undefined);
});

test('native reflection IL/token observations agree with all four usage relations', () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/usage-relations/native.json', import.meta.url), 'utf8'));
  const bytes = Buffer.from(reference.image, 'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.imageSha256);
  const inspector = new AssemblyInspector(bytes), graph = new AssemblyUsageAnalysis(inspector);
  for (const method of reference.native.methods) {
    const actual = graph.query('uses', method.token).entries;
    assert.deepEqual(actual.map(edge => [edge.offset, edge.opcode, edge.operandToken]),
      method.uses.map(edge => [edge.offset, edge.opcode, edge.operand]));
    for (const edge of method.uses) {
      const target = edge.local ? edge.definition : edge.operand;
      assert.ok(graph.query('used-by', target).entries.some(item => item.sourceToken === method.token && item.offset === edge.offset));
      if (edge.assigned) assert.ok(graph.query('assigned-by', target).entries
        .some(item => item.sourceToken === method.token && item.offset === edge.offset));
      if (edge.instantiatedType && edge.local)
        assert.ok(graph.query('instantiated-by', edge.instantiatedType).entries.some(item => item.sourceToken === method.token && item.offset === edge.offset));
    }
  }
  assert.equal(inspector.cache.size, 0);
});
