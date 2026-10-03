import { compareMembers } from './bcl-api-diff.js';
import { pin } from './common.js';

export function winuiApiDiff(reference, options = {}) {
  const inventory = compareMembers(reference, {
    domain: 'WINUI', specRevision: `windows-app-sdk-${pin.windowsAppSDK}`,
    area: name => /\.Media\.|\.Shapes\.|\.Composition\./.test(name) ? 'A17' : /\.Controls\.|\.Input\.|\.Automation\./.test(name) ? 'A16' : 'A15', ...options,
  });
  const controls = new Map();
  for (const row of inventory.rows) {
    const summary = controls.get(row.owner) ?? { type: row.owner, denominator: 0, implementedSignatures: 0, missingSignatures: 0, behavioralParity: 'unknown' };
    summary.denominator++; summary[row.status === 'implemented' ? 'implementedSignatures' : 'missingSignatures']++;
    controls.set(row.owner, summary);
  }
  return { ...inventory, windowsAppSDK: pin.windowsAppSDK, controls: [...controls.values()].sort((a, b) => a.type.localeCompare(b.type, 'en')) };
}
