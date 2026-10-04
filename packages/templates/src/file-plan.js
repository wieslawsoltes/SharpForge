import { portablePath } from '@sharpforge/archive';
import { directoryName } from './common.js';

/** Validate every planned path and parent against the complete destination namespace, without writes. */
export function validateFilePlan(plan, existing = []) {
  const all = [...existing.map(file => typeof file === 'string' ? { path: file } : file), ...plan.records,
    ...(plan.folders ?? []).map(path => ({ path, directory: true }))];
  const seen = new Map();
  const identities = new Map();
  for (const file of all) {
    const path = portablePath(file.path);
    const key = path.normalize('NFC').toLowerCase();
    let parent = path;
    while (parent) {
      const identity = parent.normalize('NFC').toLowerCase();
      const old = identities.get(identity);
      if (old && old !== parent) throw new Error('Case-colliding destination parent: ' + parent);
      identities.set(identity, parent);
      parent = directoryName(parent);
    }
    if (seen.has(key)) {
      if (file.directory && seen.get(key).directory) continue;
      throw new Error('Destination already exists or collides by case: ' + path);
    }
    seen.set(key, file);
  }
  for (const [key, file] of seen) {
    for (let parent = directoryName(key); parent; parent = directoryName(parent)) {
      if (seen.has(parent) && !seen.get(parent).directory) throw new Error('Destination parent is a file: ' + file.path);
    }
  }
  return plan;
}
