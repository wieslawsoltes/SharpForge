import path from 'node:path';

const interactivePackage = 'Microsoft.WindowsAppSDK.InteractiveExperiences';
const interactiveIdentities = Object.freeze(['microsoft.foundation.winmd', 'microsoft.graphics.winmd', 'microsoft.ui.winmd']);

function targetVersion(framework) {
  const match = /^net\d+\.\d+-windows(\d+\.\d+\.\d+(?:\.\d+)?)$/.exec(framework);
  if (!match) throw new Error('WinUI metadata requires an explicit locked Windows target framework: ' + framework);
  const components = match[1].split('.').map(Number);
  if (components.length === 3) components.push(0);
  if (components.some(value => !Number.isSafeInteger(value) || value > 65_535)) {
    throw new RangeError('Locked Windows target version is outside the supported version range');
  }
  return components;
}

function atLeast(actual, expected) {
  for (let index = 0; index < expected.length; index++) {
    if (actual[index] !== expected[index]) return actual[index] > expected[index];
  }
  return true;
}

/** Selects the target-specific WinMD variant using the locked framework and the package's MSBuild rule. */
export function lockedMetadataSelection(lock) {
  const frameworks = Object.entries(lock.dependencies ?? {}).filter(([framework, dependencies]) =>
    !framework.includes('/') && dependencies?.['Microsoft.WindowsAppSDK']);
  if (frameworks.length !== 1) throw new Error('Expected exactly one locked WinUI target framework');
  const [framework, dependencies] = frameworks[0];
  const components = targetVersion(framework);
  // Microsoft.InteractiveExperiences.Common.targets uses 17763 below 18362, and 18362 at or above it.
  const interactiveVersion = atLeast(components, [10, 0, 18_362, 0]) ? '10.0.18362.0' : '10.0.17763.0';
  return { framework, dependencies, targetPlatformVersion: components.join('.'), interactiveVersion };
}

/** Retains licenses and only the applicable metadata variant; malformed or incomplete variant sets fail explicitly. */
export function selectPackageMetadataFiles(name, files, { directory, selection }) {
  if (name !== interactivePackage) return [...files];
  const selected = [];
  const identities = new Set();
  for (const file of files) {
    const relative = path.relative(directory, file).split(path.sep).join('/');
    if (!relative.toLowerCase().endsWith('.winmd')) {
      selected.push(file);
      continue;
    }
    const match = /^metadata\/(10\.0\.(?:17763|18362)\.0)\/([^/]+\.winmd)$/i.exec(relative);
    if (!match) throw new Error('Unexpected locked InteractiveExperiences metadata layout: ' + relative);
    if (match[1] !== selection.interactiveVersion) continue;
    selected.push(file);
    identities.add(match[2].toLowerCase());
  }
  for (const identity of interactiveIdentities) {
    if (!identities.has(identity)) throw new Error('Missing selected InteractiveExperiences metadata: ' + identity);
  }
  return selected;
}

/** Names the source rule retained in imported provenance for the target-specific package. */
export function metadataSelectionProvenance(name, selection) {
  if (name !== interactivePackage) return null;
  return { targetPlatformVersion: selection.targetPlatformVersion,
    directory: 'metadata/' + selection.interactiveVersion,
    ruleFile: 'build/Microsoft.InteractiveExperiences.Common.targets' };
}
