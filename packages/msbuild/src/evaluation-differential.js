function indexedProperties(properties) {
  return new Map(Object.entries(properties ?? {}).map(([name, value]) => [name.toLowerCase(), String(value)]));
}

function normalizePathValue(value, root) {
  const normalized = String(value).replaceAll('\\', '/');
  const prefix = String(root ?? '').replaceAll('\\', '/').replace(/\/$/, '');
  return prefix && normalized.startsWith(prefix + '/') ? normalized.slice(prefix.length + 1) : normalized;
}

function itemRows(items, name, fields, root) {
  return (items[name] ?? []).map(item => {
    const row = {identity: normalizePathValue(item.Identity ?? item.identity ?? item.path, root)};
    const metadata = item.metadata ?? item;
    for (const field of fields) {
      row[field] = metadata[field] === undefined ? undefined : /(?:Path|Directory|Filename|Identity)$/i.test(field) ?
        normalizePathValue(metadata[field], root) : String(metadata[field]);
    }
    return row;
  });
}

/** Compare explicitly selected properties and ordered item metadata, preserving missing-vs-empty distinctions. */
export function compareMSBuildEvaluations(portable, native, options = {}) {
  const {propertyNames = [], itemNames = [], metadataNames = {}, workspaceRoot = '', feature = 'unspecified'} = options;
  const differences = [];
  const left = indexedProperties(portable.properties ?? portable.Properties);
  const right = indexedProperties(native.Properties ?? native.properties);
  for (const name of propertyNames) {
    const portableValue = left.get(name.toLowerCase());
    const nativeValue = right.get(name.toLowerCase());
    if (portableValue !== nativeValue) differences.push({feature, kind: 'property', name, portable: portableValue, native: nativeValue});
  }
  for (const name of itemNames) {
    const portableRows = itemRows(portable.evaluatedItems ?? portable.Items ?? {}, name, metadataNames[name] ?? [], workspaceRoot);
    const nativeRows = itemRows(native.Items ?? native.evaluatedItems ?? {}, name, metadataNames[name] ?? [], workspaceRoot);
    const count = Math.max(portableRows.length, nativeRows.length);
    for (let index = 0; index < count; index++) {
      if (JSON.stringify(portableRows[index]) !== JSON.stringify(nativeRows[index])) {
        differences.push({feature, kind: 'item', name, index, portable: portableRows[index], native: nativeRows[index]});
      }
    }
  }
  return {equal: differences.length === 0, differences};
}

/** Produce an auditable native differential report; unsupported fixtures must produce their declared blocking diagnostic. */
export async function qualifyMSBuildCorpus(options) {
  const {corpus, boundary, evaluatePortable, evaluateNative, signal, reference = null} = options;
  if (!Array.isArray(corpus) || corpus.length > 10_000 || typeof evaluatePortable !== 'function') throw new Error('Invalid evaluation corpus');
  const entries = Array.isArray(boundary) ? boundary : Array.isArray(boundary.features) ? boundary.features :
    Object.entries(boundary.features ?? {}).map(([id, feature]) => ({id, ...feature}));
  const features = new Map(entries.map(feature => [feature.id ?? feature.feature, feature]));
  const cases = [];
  let nativeExecutions = 0;
  for (const fixture of corpus) {
    signal?.throwIfAborted();
    const feature = features.get(fixture.feature);
    if (!feature) throw new Error('Corpus feature absent from machine-readable boundary: ' + fixture.feature);
    const portable = await evaluatePortable(fixture, {signal});
    const diagnostics = portable.diagnostics ?? [];
    const nativeOnly = feature.status === 'native-only';
    const expectedCode = feature.diagnostic ?? feature.diagnosticCode ?? feature.code;
    const blocked = diagnostics.some(diagnostic => diagnostic.severity === 'error' && (!expectedCode || diagnostic.code === expectedCode));
    if (nativeOnly) {
      cases.push({id: fixture.id, feature: fixture.feature, status: blocked ? 'boundary-enforced' : 'boundary-violation',
        differences: blocked ? [] : [{kind: 'diagnostic', name: expectedCode, message: 'Native-only input did not produce a blocking diagnostic'}]});
      continue;
    }
    if (!evaluateNative) {
      cases.push({id: fixture.id, feature: fixture.feature, status: 'native-not-run', differences: [], diagnostics});
      continue;
    }
    const native = await evaluateNative(fixture, {signal});
    nativeExecutions++;
    const comparison = compareMSBuildEvaluations(portable.project ?? portable, native.result ?? native,
      {...fixture, feature: fixture.feature, workspaceRoot: native.workspaceRoot});
    const status = blocked ? 'portable-error' : comparison.equal ? 'match' : feature.status === 'supported' ? 'regression' : 'documented-difference';
    cases.push({id: fixture.id, feature: fixture.feature, status, ...comparison, diagnostics,
      native: {command: native.command ?? null, version: native.version ?? reference?.version ?? null}});
  }
  return {schemaVersion: 1, reference, qualification: nativeExecutions ? 'native-executed' : 'native-not-run', cases,
    success: nativeExecutions > 0 &&
      !cases.some(item => ['regression', 'portable-error', 'boundary-violation', 'native-not-run'].includes(item.status)),
    divergenceCount: cases.reduce((sum, item) => sum + item.differences.length, 0)};
}
