import { AssemblyInspector, AssemblyUsageAnalysis, CilError } from '@sharpforge/cil';
import { createAssemblyMethodRelations, LoadErrorCode } from '@sharpforge/clr';
import { baseContext } from '../../clr-methods-base-fixtures.js';
import { declarationFixture, declarationTokens as tokens } from './input.mjs';

const assert = (condition, message) => { if (!condition) throw Error(message); };
const tuple = entry => [entry.relation, entry.sourceToken, entry.targetToken, entry.implementingTypeToken].join(':');
const equal = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected), message);
const hex = bytes => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');

async function rejects(action, expected) {
  try { await action(); }
  catch (error) {
    assert(error.code === expected, `Unexpected error ${error.code}: ${error.message}`);
    return;
  }
  throw Error(`Missing rejection ${expected}`);
}

function rejectsCil(action, pattern) {
  try { action(); }
  catch (error) {
    assert(error instanceof CilError && pattern.test(error.message), `Unexpected error: ${error.message}`);
    return;
  }
  throw Error(`Missing rejection ${pattern}`);
}

/** Browser JavaScript metadata API qualification; the native result is replayed as captured reference data. */
export async function run() {
  const report = { passed: false, checks: [] };
  try {
    const bytes = declarationFixture({ memberRef: true });
    const context = baseContext({ isCollectible: true });
    const module = (await context.loadFromStream(bytes)).manifestModule;
    const snapshot = await createAssemblyMethodRelations(module);
    equal(snapshot.diagnostics, [], 'Canonical declaration diagnostics');
    const graph = new AssemblyUsageAnalysis(new AssemblyInspector(bytes), { methodRelations: snapshot });
    equal(graph.query('overridden-by', tokens.rootM).entries.map(entry => entry.sourceToken),
      [tokens.middleM, tokens.leafM], 'Overrides exclude newslot hiders');
    equal(graph.query('overridden-by', tokens.middleM).entries.map(entry => entry.sourceToken),
      [tokens.leafM], 'Intermediate overridden ancestor');
    equal(graph.query('implemented-by', tokens.contractM).entries.map(entry => entry.sourceToken),
      [tokens.rootM, tokens.middleM, tokens.middleM, tokens.leafM, tokens.reimplementedM], 'Inherited slots and reimplementation');
    equal(graph.query('implemented-by', tokens.contractOther).entries.map(entry => entry.sourceToken),
      [tokens.rootOther, tokens.explicitOther, tokens.explicitOther, tokens.explicitOther, tokens.rootOther], 'Explicit aliases and inheritance');
    assert(module.methodBodyReadCount === 0, 'CLR provider does not read method bodies');
    report.checks.push('Canonical override/interface sets, explicit aliases, hiding, inherited slots and reimplementation');

    await rejects(() => createAssemblyMethodRelations(module, { maxRelations: snapshot.entries.length - 1 }), LoadErrorCode.LimitExceeded);
    await rejects(() => createAssemblyMethodRelations(module, { maxRelations: -1 }), LoadErrorCode.InvalidConfiguration);
    await rejects(() => createAssemblyMethodRelations(module, { signal: AbortSignal.abort() }), LoadErrorCode.Cancelled);
    rejectsCil(() => graph.query('overridden-by', 0x106000001), /metadata token/);
    rejectsCil(() => graph.query('implemented-by', tokens.contractM, { signal: AbortSignal.abort() }), /cancelled/);
    const original = graph.query('implemented-by', tokens.contractM);
    const page = graph.query('implemented-by', tokens.contractM, { offset: 1, limit: 2 });
    equal(page.entries, original.entries.slice(1, 3), 'Indexed page');
    assert(page.total === 5 && page.nextOffset === 3, 'Page continuation');
    page.entries[0].sourceToken = 0;
    const supplied = structuredClone(snapshot);
    const inspector = new AssemblyInspector(bytes);
    const copied = new AssemblyUsageAnalysis(inspector, { methodRelations: supplied });
    supplied.entries[0].sourceToken = 0;
    supplied.entries.length = 0;
    inspector.pe.bytes.fill(0);
    inspector.metadata.rows.length = 0;
    context.unload();
    equal(copied.query('implemented-by', tokens.contractM), original, 'Owned snapshot after source destruction and unload');
    assert(Object.isFrozen(snapshot.entries) && Object.isFrozen(snapshot.entries[0]), 'Immutable canonical snapshot');
    report.checks.push('Budgets, cancellation, invalid tokens, paging, snapshot ownership and context unload');

    const response = await fetch('/tests/fixtures/declaration-relations/native.json');
    assert(response.ok, 'Native reference fetch');
    const reference = await response.json();
    const image = Uint8Array.from(atob(reference.image), character => character.charCodeAt(0));
    assert(hex(await crypto.subtle.digest('SHA-256', image)) === reference.imageSha256, 'Native image hash');
    const nativeModule = (await baseContext().loadFromStream(image)).manifestModule;
    const nativeSnapshot = await createAssemblyMethodRelations(nativeModule);
    equal(nativeSnapshot.diagnostics, [], 'Native snapshot diagnostics');
    equal(nativeSnapshot.entries.map(tuple).sort(), reference.native.entries.map(tuple).sort(), 'Native exact relation sets');
    const native = new AssemblyUsageAnalysis(new AssemblyInspector(image), { methodRelations: nativeSnapshot });
    for (const relation of ['overridden-by', 'implemented-by']) {
      const targets = new Set(reference.native.entries.filter(entry => entry.relation === relation).map(entry => entry.targetToken));
      for (const target of targets) {
        const expected = reference.native.entries.filter(entry => entry.relation === relation && entry.targetToken === target);
        const actual = native.query(relation, target);
        assert(actual.complete, 'Complete supported relation');
        equal(actual.entries.map(tuple).sort(), expected.map(tuple).sort(), 'Native indexed relation query');
      }
    }
    assert(nativeModule.methodBodyReadCount === 0, 'Native reference metadata requires no method bodies');
    report.reference = { toolchain: reference.toolchain, imageSha256: reference.imageSha256 };
    report.checks.push('Independent CoreCLR GetBaseDefinition/GetInterfaceMap reference replay, including generic methods');
    report.passed = true;
  } catch (error) { report.error = { name: error.name, code: error.code, message: error.message }; }
  return report;
}
