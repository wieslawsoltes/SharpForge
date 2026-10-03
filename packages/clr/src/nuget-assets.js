import { checkCancellation, loadError, LoadErrorCode } from './load-errors.js';
import { relativeAssetPath, runtimeFallbacks } from './probing-paths.js';

function framework(tfm) {
  const match = /^(netstandard|netcoreapp|net)(\d+)\.(\d+)(?:-([a-z]+)([\d.]*))?$/i.exec(tfm);
  if (!match || (match[1].toLowerCase() === 'net' && Number(match[2]) < 5)) {
    throw loadError(LoadErrorCode.UnsupportedFramework, `Unsupported target framework: ${tfm}`);
  }
  return { text: tfm, family: match[1].toLowerCase(), major: Number(match[2]), minor: Number(match[3]),
    platform: match[4]?.toLowerCase() ?? null, platformVersion: match[5]?.split('.').map(Number) ?? [] };
}

function compareVersion(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function compatibility(target, candidate) {
  if (candidate.platform && candidate.platform !== target.platform) return null;
  if (candidate.platform && compareVersion(candidate.platformVersion, target.platformVersion) > 0) return null;
  const version = [candidate.major, candidate.minor];
  const current = [target.major, target.minor];
  let rank;
  if (candidate.family === target.family) {
    if (compareVersion(version, current) > 0) return null;
    rank = 3;
  } else if (target.family === 'net' && candidate.family === 'netcoreapp') {
    if (compareVersion(version, [3, 1]) > 0) return null;
    rank = 2;
  } else if (candidate.family === 'netstandard' && target.family !== 'netstandard') {
    const maximum = target.family === 'net' || target.major >= 3 ? [2, 1] : [2, 0];
    if (compareVersion(version, maximum) > 0) return null;
    rank = 1;
  } else return null;
  return [rank, candidate.major, candidate.minor, candidate.platform ? 1 : 0, ...candidate.platformVersion];
}

/** Select NuGet's nearest supported netstandard/netcoreapp/net5+ TFM. Unsupported families fail explicitly. */
export function nearestTargetFramework(target, candidates) {
  const requested = framework(target);
  if (!Array.isArray(candidates) || candidates.length > 1024) throw loadError(LoadErrorCode.LimitExceeded, 'Too many frameworks');
  let result = null;
  let score = null;
  for (const tfm of [...new Set(candidates)].sort()) {
    const candidate = framework(tfm);
    const candidateScore = compatibility(requested, candidate);
    if (candidateScore && (score === null || compareVersion(candidateScore, score) > 0)) {
      result = tfm;
      score = candidateScore;
    }
  }
  return result;
}

function assetGroups(files, prefix) {
  const groups = new Map();
  for (const path of files) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const separator = rest.indexOf('/');
    if (separator < 0) continue;
    const tfm = rest.slice(0, separator);
    if (!groups.has(tfm)) groups.set(tfm, []);
    groups.get(tfm).push(path);
  }
  return groups;
}

function selectGroup(groups, target) {
  const tfm = nearestTargetFramework(target, [...groups.keys()]);
  return tfm === null ? null : { framework: tfm, paths: groups.get(tfm).filter(path => /\.(dll|exe)$/i.test(path)).sort() };
}

/** Choose assets from a host-extracted in-memory package file list; never restore or download a package. */
export function selectNugetAssets(files, { targetFramework, rid = null, runtimeGraph = {}, kind = 'runtime', signal } = {}) {
  checkCancellation(signal);
  framework(targetFramework);
  if (!['runtime', 'compile'].includes(kind)) throw new TypeError('Asset kind must be runtime or compile');
  if (!Array.isArray(files) || files.length > 50000) throw loadError(LoadErrorCode.LimitExceeded, 'Package file limit exceeded');
  for (const path of files) relativeAssetPath(path);
  const fallbacks = runtimeFallbacks(rid, runtimeGraph);
  if (kind === 'runtime') {
    for (const fallback of fallbacks) {
      const group = selectGroup(assetGroups(files, `runtimes/${fallback}/lib/`), targetFramework);
      if (group) return Object.freeze({ ...group, paths: Object.freeze(group.paths), rid: fallback, kind });
    }
  }
  if (kind === 'compile') {
    const group = selectGroup(assetGroups(files, 'ref/'), targetFramework);
    if (group) return Object.freeze({ ...group, paths: Object.freeze(group.paths), rid: null, kind });
  }
  const group = selectGroup(assetGroups(files, 'lib/'), targetFramework);
  return Object.freeze({ framework: group?.framework ?? null, paths: Object.freeze(group?.paths ?? []), rid: null, kind });
}

/** Read an already-restored project.assets target. Restore's exact choices take precedence over reprojection. */
export function assetsFromProject(project, { targetFramework, rid = null, kind = 'runtime', signal } = {}) {
  checkCancellation(signal);
  framework(targetFramework);
  if (!['runtime', 'compile'].includes(kind)) throw new TypeError('Asset kind must be runtime or compile');
  const key = rid ? `${targetFramework}/${rid}` : targetFramework;
  const target = project?.targets?.[key];
  if (!target) throw loadError(LoadErrorCode.InvalidConfiguration, `Missing restored target: ${key}`);
  const packages = Object.entries(target);
  if (packages.length > 10000) throw loadError(LoadErrorCode.LimitExceeded, 'Restored package limit exceeded');
  return Object.freeze(packages.sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => {
    checkCancellation(signal);
    const paths = Object.keys(value[kind] ?? {}).filter(path => !path.endsWith('/_._')).sort();
    for (const path of paths) relativeAssetPath(path);
    return Object.freeze({ name, paths: Object.freeze(paths) });
  }));
}
