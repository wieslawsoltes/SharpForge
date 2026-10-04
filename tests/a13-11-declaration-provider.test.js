import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, AssemblyUsageAnalysis, CilError } from '@sharpforge/cil';
import { usageFixture } from './fixtures/usage-relations/input.mjs';

function fixture(options = {}) {
  const input = usageFixture();
  const inspector = new AssemblyInspector(input.bytes);
  const { tokens } = input;
  // These records exercise the host-data seam. Canonical CLR binding has separate reference tests.
  const methodRelations = { format: 'sharpforge.method-relations', version: 1,
    moduleVersionId: inspector.tokenUri(tokens.run).split('/')[2],
    methodCount: inspector.metadata.rows[6].length, typeCount: inspector.metadata.rows[2].length,
    entries: [
      { relation: 'overridden-by', sourceToken: tokens.run, targetToken: tokens.read,
        implementingTypeToken: tokens.type, implementationKind: 'override' },
      { relation: 'implemented-by', sourceToken: tokens.run, targetToken: tokens.read,
        implementingTypeToken: tokens.type, implementationKind: 'explicit' },
    ], diagnostics: [],
  };
  return { inspector, tokens, methodRelations,
    create: changes => new AssemblyUsageAnalysis(inspector, { methodRelations, ...options, ...changes }) };
}

test('A13 host declaration snapshot extends indexed queries and copies all retained records', () => {
  const { create, tokens, methodRelations, inspector } = fixture();
  const analysis = create();
  const original = analysis.query('overridden-by', tokens.read);
  assert.equal(original.total, 1);
  assert.equal(original.complete, true);
  assert.equal(original.entries[0].source, inspector.tokenUri(tokens.run));
  assert.equal(original.entries[0].target, inspector.tokenUri(tokens.read));
  assert.equal(original.entries[0].implementationKind, 'override');
  assert.equal(analysis.query('implemented-by', tokens.read).entries[0].implementationKind, 'explicit');
  methodRelations.entries[0].sourceToken = tokens.read;
  methodRelations.entries.length = 0;
  original.entries[0].implementationKind = 'changed';
  inspector.pe.bytes.fill(0);
  inspector.metadata.rows.length = 0;
  assert.equal(analysis.query('overridden-by', tokens.read).entries[0].sourceToken, tokens.run);
  assert.equal(analysis.query('overridden-by', tokens.read).entries[0].implementationKind, 'override');
  assert.equal(analysis.storage.declarationRelations, 2);
  assert.equal(analysis.query('overridden-by', tokens.read, { limit: 0 }).nextOffset, null);
  assert.equal(analysis.query('overridden-by', tokens.read, { offset: 1 }).total, 1);
});

test('A13 declaration diagnostics affect only their relation and preserve instruction coverage', () => {
  const { create, tokens, methodRelations, inspector } = fixture();
  methodRelations.diagnostics.push({ relation: 'implemented-by', token: tokens.type,
    code: 'SFCLR012', reason: 'Unresolved interface metadata' });
  const analysis = create();
  assert.equal(analysis.query('overridden-by', tokens.read).complete, true);
  assert.equal(analysis.query('implemented-by', tokens.read).complete, false);
  assert.equal(analysis.query('uses', tokens.run).complete, true);
  analysis.diagnostics[0].reason = 'changed';
  assert.equal(analysis.diagnostics[0].reason, 'Unresolved interface metadata');
  inspector.metadata.rows[6][2][1] = 1;
  const native = create();
  assert.equal(native.query('uses', tokens.run).complete, false);
  assert.equal(native.query('overridden-by', tokens.read).complete, true);
});

test('A13 declaration snapshots reject module mismatches, malformed entries and duplicate relationships', () => {
  const cases = [
    value => { value.format = 'other'; },
    value => { value.version = 2; },
    value => { value.moduleVersionId = '00000000-0000-0000-0000-000000000000'; },
    value => { value.methodCount++; },
    value => { value.typeCount++; },
    value => { value.entries = null; },
    value => { value.diagnostics = null; },
    value => { value.entries[0].relation = 'uses'; },
    value => { value.entries[0].sourceToken = 0x106000001; },
    value => { value.entries[0].targetToken = 0x0600ffff; },
    value => { value.entries[0].implementingTypeToken = 0; },
    value => { value.entries[0].implementationKind = 'implicit'; },
    value => { value.entries.push({ ...value.entries[0] }); },
    value => { value.diagnostics.push({ relation: 'implemented-by', token: 0, code: 'SFCLR012', reason: 'Missing' }); },
  ];
  for (const change of cases) {
    const { create, methodRelations } = fixture();
    change(methodRelations);
    assert.throws(() => create(), CilError);
  }
});

test('A13 declaration snapshot budgets reject before reading records and cancellation remains observable', () => {
  const { create, methodRelations, tokens } = fixture();
  assert.equal(create({ maxDeclarationRelations: 2 }).storage.declarationRelations, 2);
  Object.defineProperty(methodRelations.entries, 0, { get() { throw Error('expanded before preflight'); } });
  assert.throws(() => create({ maxDeclarationRelations: 1 }), /limit exceeded: declaration relations/);
  assert.throws(() => create({ maxDeclarationRelations: -1 }), /Invalid usage analysis/);
  const diagnostics = fixture();
  diagnostics.methodRelations.diagnostics.push({ relation: 'implemented-by', token: tokens.type,
    code: 'SFCLR012', reason: 'Unsupported' });
  assert.throws(() => diagnostics.create({ maxDeclarationDiagnostics: 0 }), /limit exceeded: declaration diagnostics/);
  assert.throws(() => diagnostics.create({ signal: AbortSignal.abort() }), /cancelled/);
});
