import { satisfiesNuGetRange } from './versioning.js';

export function readPackagesLock(text) {
  if (typeof text !== 'string' || text.length > 33554432) throw new Error('Package lock file limit exceeded');
  const document = JSON.parse(text);
  if (![1, 2].includes(document.version) || !document.dependencies || Array.isArray(document.dependencies)) throw new Error('Invalid packages.lock.json');
  return { document, originalText: text, baseline: JSON.stringify(document) };
}
export function writePackagesLock(lock) {
  return JSON.stringify(lock.document) === lock.baseline ? lock.originalText : JSON.stringify(lock.document, null, 2) + '\n';
}
export function detectLockDrift(lock, referencesByFramework) {
  const diagnostics = [];
  for (const [framework, references] of Object.entries(referencesByFramework)) {
    const dependencies = lock.document.dependencies[framework] ?? {};
    const indexed = new Map(Object.entries(dependencies).map(([id, value]) => [id.toLowerCase(), value]));
    for (const reference of references) {
      const entry = indexed.get(reference.id.toLowerCase());
      if (!entry || entry.type !== 'Direct' || !satisfiesNuGetRange(entry.resolved, reference.version)) {
        diagnostics.push({ code: 'NU1004', severity: 'error', framework, packageId: reference.id,
          message: `Locked dependency '${reference.id}' does not satisfy '${reference.version}' for ${framework}` });
      }
    }
    const directIds = new Set(references.map(reference => reference.id.toLowerCase()));
    for (const [id, entry] of Object.entries(dependencies)) if (entry.type === 'Direct' && !directIds.has(id.toLowerCase())) {
      diagnostics.push({ code: 'NU1004', severity: 'error', framework, packageId: id, message: `Locked direct dependency '${id}' was removed` });
    }
  }
  return diagnostics;
}
export function lockedRestoreRequest(request, { locked = true } = {}) {
  return { ...request, action: 'restore', properties: { ...request.properties,
    RestorePackagesWithLockFile: 'true', RestoreLockedMode: String(locked) } };
}
