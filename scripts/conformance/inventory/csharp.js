import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compile } from '../../../packages/compiler/src/index.js';
import { root, probeRoot, sha256, counts } from './common.js';
import { referenceProbeContext, languageBoundary, malformedProbeSource, assertNativeDecision } from './reference-language.js';

export function compileProbe(source, langVersion, compiler = compile, outputKind = 'library') {
  try {
    const result = compiler(source, { langVersion, outputKind, allowUnsafe: true });
    return { accepted: result.success, diagnostics: result.diagnostics.map(d => ({ code: d.code, severity: d.severity, message: d.message })) };
  } catch (error) { return { accepted: false, error: error.message }; }
}
export function compileFeatureProbes(source, feature, boundaryVersion, compiler = compile) {
  const probe = (text, version) => compileProbe(text, version, compiler, feature.outputKind);
  return { positive: probe(source, feature.langVersion),
    malformed: probe(malformedProbeSource(source), feature.langVersion),
    boundary: boundaryVersion ? probe(source, boundaryVersion) : null };
}

export function assertReferenceProbe(feature, native, sourceSHA256, langVersion = feature.langVersion) {
  const context = referenceProbeContext(feature, langVersion);
  if (!native || native.sourceSHA256 !== sourceSHA256 || native.langVersion !== context.langVersion ||
      native.target !== context.target || JSON.stringify(native.features) !== JSON.stringify(context.features)) {
    throw new Error(`Stale native probe validity or compilation context: ${feature.id}`);
  }
  assertNativeDecision(native, feature.id);
}

export function assessFeatureProbes(feature, observations, native) {
  const plan = languageBoundary(feature);
  const matches = (actual, expected) => !!actual && !Object.hasOwn(actual, 'error') && actual.accepted === expected &&
    Array.isArray(actual.diagnostics) && actual.diagnostics.some(diagnostic => diagnostic.severity === 'error') === !expected;
  const boundary = { ...plan, expectation: plan.langVersion ? (native.boundary.accepted ? 'accept' : 'reject') : null,
    expectationSource: plan.langVersion ? 'pinned Roslyn compilation of the same source and target' : null,
    status: !plan.langVersion ? 'not-applicable' : matches(observations.boundary, native.boundary.accepted) ? 'pass' : 'fail',
    referenceVersionGate: plan.kind === 'adjacent-release' ? (native.accepted && !native.boundary.accepted ? 'observed' : 'not-demonstrated') : 'not-applicable' };
  const status = !native.accepted ? 'unknown' : matches(observations.positive, true) &&
    matches(observations.malformed, false) && !native.malformed.accepted && boundary.status !== 'fail' ? 'implemented' : 'missing';
  return { status, boundary };
}

export async function csharpInventory({ reference } = {}) {
  if (!reference?.rows?.length) throw new Error('Pinned Roslyn probe validity results are required');
  const nativeRows = new Map(reference.rows.map(row=>[row.id,row]));
  const catalogBytes = await readFile(path.join(probeRoot, 'csharp.json'));
  if (reference.catalogSHA256 !== sha256(catalogBytes)) throw new Error('Stale native language probe catalog');
  const catalog = JSON.parse(catalogBytes);
  const rows = [];
  for (const feature of catalog.features) {
    const bytes = await readFile(path.join(root, feature.probe));
    const source = bytes.toString('utf8');
    const native = nativeRows.get(feature.id);
    assertReferenceProbe(feature, native, sha256(bytes));
    assertReferenceProbe(feature, native.malformed, sha256(malformedProbeSource(source)));
    if (native.malformed.accepted) throw new Error(`Native malformed probe was accepted: ${feature.id}`);
    if (!native.accepted && feature.langVersion !== 'preview') throw new Error(`Invalid native language probe ${feature.id}: ${native.diagnostics.join('; ')}`);
    const major = Number.parseInt(feature.version), boundaryVersion = languageBoundary(feature).langVersion;
    if (boundaryVersion) assertReferenceProbe(feature, native.boundary, sha256(bytes), boundaryVersion);
    else if (native.boundary !== null) throw new Error(`Unexpected native boundary: ${feature.id}`);
    const observations = compileFeatureProbes(source, feature, boundaryVersion);
    const assessment = assessFeatureProbes(feature, observations, native);
    const { positive, malformed, boundary } = observations;
    rows.push({ key: `csharp:${feature.id}`, domain: 'CSHARP', name: feature.title, area: 'A01', specRevision: major === 15 ? 'csharp-15-preview-2026-10-03' : `csharp-${major}`,
      ...feature, probeSHA256: sha256(bytes), status: assessment.status,
      referenceValidity: native,
      statusScope: 'positive compilation, malformed rejection and reference boundary acceptance only; execution and full feature semantics remain unqualified',
      observations: { positive, malformed, boundary: boundary && { langVersion: boundaryVersion, ...boundary } }, boundaryAssessment: assessment.boundary,
      qualification: 'unknown', reason: native.accepted ? 'Matching a native compile boundary is required for implemented status; prior-version acceptance is not evidence of feature exclusivity or historical runtime behavior.' : 'Pinned released Roslyn does not support this frozen C# 15 preview proposal; its SharpForge probe outcome is retained without reference qualification.' });
  }
  return { schemaVersion: 1, reference: { compiler: reference.compiler, referenceAssemblies: reference.referenceAssemblies,
    catalogSHA256: reference.catalogSHA256 }, rows, totals: counts(rows) };
}
