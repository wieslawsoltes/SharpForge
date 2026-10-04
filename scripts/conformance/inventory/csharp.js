import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compile } from '../../../packages/compiler/src/index.js';
import { root, probeRoot, sha256, readJSON, counts } from './common.js';
import { referenceProbeContext } from './reference-language.js';

export function compileProbe(source, langVersion, compiler = compile, outputKind = 'library') {
  try {
    const result = compiler(source, { langVersion, outputKind, allowUnsafe: true });
    return { accepted: result.success, diagnostics: result.diagnostics.map(d => ({ code: d.code, severity: d.severity, message: d.message })) };
  } catch (error) { return { accepted: false, error: error.message }; }
}
export function compileFeatureProbes(source, feature, boundaryVersion, compiler = compile) {
  const probe = (text, version) => compileProbe(text, version, compiler, feature.outputKind);
  return { positive: probe(source, feature.langVersion),
    malformed: probe(source + '\nclass __Invalid { void M( }', feature.langVersion),
    boundary: boundaryVersion ? probe(source, boundaryVersion) : null };
}

export function assertReferenceProbe(feature, native, sourceSHA256) {
  const context = referenceProbeContext(feature);
  if (!native || native.sourceSHA256 !== sourceSHA256 || native.langVersion !== context.langVersion ||
      native.target !== context.target || JSON.stringify(native.features) !== JSON.stringify(context.features)) {
    throw new Error(`Stale native probe validity or compilation context: ${feature.id}`);
  }
}

export async function csharpInventory({ reference } = {}) {
  if (!reference?.rows?.length) throw new Error('Pinned Roslyn probe validity results are required');
  const nativeRows = new Map(reference.rows.map(row=>[row.id,row]));
  const catalog = await readJSON(path.join(probeRoot, 'csharp.json'));
  const rows = [];
  for (const feature of catalog.features) {
    const bytes = await readFile(path.join(root, feature.probe));
    const source = bytes.toString('utf8');
    const native = nativeRows.get(feature.id);
    assertReferenceProbe(feature, native, sha256(bytes));
    if (!native.accepted && feature.langVersion !== 'preview') throw new Error(`Invalid native language probe ${feature.id}: ${native.diagnostics.join('; ')}`);
    const major = Number.parseInt(feature.version), boundaryVersion = major > 1 ? String(major - 1) : null;
    const { positive, malformed, boundary } = compileFeatureProbes(source, feature, boundaryVersion);
    rows.push({ key: `csharp:${feature.id}`, domain: 'CSHARP', name: feature.title, area: 'A01', specRevision: major === 15 ? 'csharp-15-preview-2026-10-03' : `csharp-${major}`,
      ...feature, probeSHA256: sha256(bytes), status: !native.accepted ? 'unknown' : positive.accepted && !malformed.accepted ? 'implemented' : 'missing',
      referenceValidity: native,
      statusScope: feature.probeScope, observations: { positive, malformed, boundary: boundary && { langVersion: boundaryVersion, ...boundary } },
      qualification: 'unknown', reason: native.accepted ? 'Compile smoke and version-boundary observations do not qualify full feature semantics.' : 'Pinned released Roslyn does not support this frozen C# 15 preview proposal; its SharpForge probe outcome is retained without reference qualification.' });
  }
  return { schemaVersion: 1, rows, totals: counts(rows) };
}
