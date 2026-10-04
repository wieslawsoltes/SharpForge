import assert from 'node:assert/strict';
import {
  planDesignSourceUpdate,
} from '@sharpforge/designer';
import {
  apiContract, corpusManifest, corpusFixtures, loadFixture, analyzeFixture, assertExpectedAnalysis,
  analysisGolden, rejectedGolden, scalarEdit, changedTokenCount,
} from './corpus.js';
import {executeDesign, unavailableTargets} from './runtime.js';

/** Executes the checked public path; unsupported input gets a diagnostic and never a substitute source file. */
export function qualifyFixture(fixture) {
  const sources = loadFixture(fixture);
  const originals = structuredClone(sources);
  let analysis;
  try {
    analysis = analyzeFixture(fixture, sources);
  } catch (error) {
    assert.equal(fixture.expected.accepted, false, fixture.id + ': ' + error.message);
    assert.equal(error.code, fixture.expected.code, fixture.id);
    assert.deepEqual(sources, originals, fixture.id + ': rejected input changed');
    return {
      golden: rejectedGolden(fixture, error, sources),
      noChurn: {status: 'rejected-without-write', changedFiles: 0},
      targets: {
        source: {status: 'unsupported', reason: 'Source analysis rejected this fixture: ' + error.code},
        cil: {status: 'unsupported', reason: 'Source analysis rejected this fixture: ' + error.code},
        ...unavailableTargets,
      },
    };
  }
  assert.equal(fixture.expected.accepted, true, fixture.id + ': input unexpectedly accepted');
  assertExpectedAnalysis(fixture, analysis);
  const noChange = planDesignSourceUpdate(analysis, analysis.document, sources);
  assert.equal(noChange.changes.length, 0, fixture.id);
  assert.deepEqual(noChange.sources, sources, fixture.id);
  assert.equal(noChange.text, sources.find(source => source.uri === analysis.uri).text, fixture.id);
  let propertyDiff = null;
  if (fixture.edit?.rejected) {
    assert.throws(() => scalarEdit(fixture, analysis), error => error.code === fixture.edit.rejected, fixture.id);
    propertyDiff = {status: 'rejected-without-write', code: fixture.edit.rejected};
  } else if (fixture.edit) {
    const plan = scalarEdit(fixture, analysis);
    propertyDiff = {
      status: 'passed', changedFiles: plan.changes.length,
      changedTokens: changedTokenCount(analysis.text, plan.text), budget: fixture.edit.tokenBudget,
    };
  }
  const exclusion = fixture.runtimeExclusion ?? 'Protected or incomplete source profile; no equivalent design/runtime graph is claimed.';
  const targets = fixture.execute ? executeDesign(sources, analysis.document) : {
    source: {status: 'unsupported', reason: exclusion},
    cil: {status: 'unsupported', reason: exclusion},
  };
  assert.deepEqual(sources, originals, fixture.id + ': source input mutated');
  return {
    golden: analysisGolden(fixture, analysis, sources),
    noChurn: {status: 'passed', changedFiles: 0}, propertyDiff,
    targets: {...targets, ...unavailableTargets},
  };
}

/** Source/runtime handles are recorded as observations, while semantic golden snapshots are independently reviewed. */
export function buildIdentityReport() {
  const fixtures = corpusFixtures.map(fixture => qualifyFixture(fixture));
  return {
    schemaVersion: 1,
    contract: 'SF-A18-T12 source/design/runtime identity qualification',
    apiContract,
    reference: {
      specification: corpusManifest.specification,
      baselineSourceCommit: corpusManifest.baselineSourceCommit,
      nativeReference: 'Unavailable; all executed engines are the actual JavaScript VMs in this repository.',
    },
    summary: {
      fixtures: fixtures.length,
      accepted: fixtures.filter(fixture => fixture.golden.accepted).length,
      rejectedWithoutWrite: fixtures.filter(fixture => !fixture.golden.accepted).length,
      sourceExecuted: fixtures.filter(fixture => fixture.targets.source.status === 'passed').length,
      cilExecuted: fixtures.filter(fixture => fixture.targets.cil.status === 'passed').length,
    },
    fixtures,
  };
}
