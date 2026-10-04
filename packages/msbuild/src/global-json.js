import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseConfigurationJson } from '@sharpforge/project-system';

const policies = new Set(['disable', 'patch', 'feature', 'minor', 'major', 'latestPatch', 'latestFeature', 'latestMinor', 'latestMajor']);
function sdkVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value ?? '');
  if (!match) throw new Error('SDK version requires major.minor.patch with optional prerelease');
  return { text: value, major: +match[1], minor: +match[2], patch: +match[3], band: Math.floor(+match[3] / 100), preview: match[4] ?? null };
}
function compare(left, right) {
  for (const key of ['major', 'minor', 'patch']) if (left[key] !== right[key]) return left[key] - right[key];
  if (left.preview === right.preview) return 0;
  if (!left.preview) return 1;
  if (!right.preview) return -1;
  const a = left.preview.split('.'), b = right.preview.split('.');
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] === b[index]) continue;
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (/^\d+$/.test(a[index]) && /^\d+$/.test(b[index])) return Number(a[index]) - Number(b[index]);
    return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

/** Resolve the documented CLI SDK roll-forward policies against an explicit installed inventory. */
export function resolveSdk(globalJson, installed, { allowPrerelease = true } = {}) {
  const configuration = globalJson?.sdk ?? {}, policy = configuration.rollForward ?? 'patch';
  if (!policies.has(policy)) throw new Error('Unknown SDK rollForward policy: ' + policy);
  const allowPreview = configuration.allowPrerelease ?? allowPrerelease;
  if (typeof allowPreview !== 'boolean') throw new Error('sdk.allowPrerelease must be boolean');
  const candidates = installed.map(item => ({ ...(typeof item === 'string' ? { version: item } : item),
    parsed: sdkVersion(typeof item === 'string' ? item : item.version) }))
    .filter(item => allowPreview || !item.parsed.preview).sort((a, b) => compare(a.parsed, b.parsed));
  const requested = configuration.version ? sdkVersion(configuration.version) : null;
  if (!requested) {
    const selected = candidates.at(-1) ?? null;
    return { selected: selected ? { ...selected, version: selected.parsed.text } : null, policy,
      reason: selected ? 'Highest eligible installed SDK; no version pin' : 'No eligible SDK installed', msbuildSdks: globalJson?.['msbuild-sdks'] ?? {} };
  }
  let eligible = candidates.filter(item => compare(item.parsed, requested) >= 0);
  if (policy === 'disable') eligible = candidates.filter(item => compare(item.parsed, requested) === 0);
  else if (policy === 'patch' || policy === 'latestPatch') eligible = eligible.filter(item =>
    item.parsed.major === requested.major && item.parsed.minor === requested.minor && item.parsed.band === requested.band);
  else if (policy === 'feature' || policy === 'latestFeature') eligible = eligible.filter(item =>
    item.parsed.major === requested.major && item.parsed.minor === requested.minor);
  else if (policy === 'minor' || policy === 'latestMinor') eligible = eligible.filter(item => item.parsed.major === requested.major);
  let selected = null;
  if (policy === 'disable') selected = eligible[0];
  else if (policy === 'patch') selected = eligible.find(item => compare(item.parsed, requested) === 0) ?? eligible.at(-1);
  else if (policy.startsWith('latest')) selected = eligible.at(-1);
  else {
    const first = eligible[0]?.parsed;
    selected = eligible.filter(item => item.parsed.major === first?.major && item.parsed.minor === first?.minor && item.parsed.band === first?.band).at(-1);
  }
  return { selected: selected ? { ...selected, version: selected.parsed.text } : null, requested: requested.text, policy,
    reason: selected ? `Selected ${selected.parsed.text} under ${policy}` : `No installed SDK satisfies ${requested.text} with ${policy}`,
    msbuildSdks: globalJson?.['msbuild-sdks'] ?? {} };
}

export async function findGlobalJson(startDirectory) {
  let directory = resolve(startDirectory);
  for (let depth = 0; depth < 128; depth++) {
    const path = join(directory, 'global.json');
    try {
      const text = await readFile(path, 'utf8');
      if (text.length > 1048576) throw new Error('global.json size limit exceeded');
      return { path, text, value: parseConfigurationJson(text, { allowTrailingCommas: false }) };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
  throw new Error('global.json search depth exceeded');
}
