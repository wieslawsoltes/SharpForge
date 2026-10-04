/** NuGet numeric versions include the legacy fourth revision and case-insensitive SemVer prerelease labels. */
export function parseNuGetVersion(text) {
  const match =
    /^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?\s*$/.exec(text ?? '');
  if (!match) throw new Error('Invalid NuGet version: ' + text);
  const numbers = match.slice(1, 5).map(value => Number(value ?? 0));
  if (numbers.some(value => !Number.isSafeInteger(value) || value > 2147483647)) throw new Error('NuGet version component overflow');
  const release = numbers.slice(0, numbers[3] ? 4 : 3).join('.'), prerelease = match[5] ?? null;
  if (prerelease?.split('.').some(label => /^0\d+$/.test(label))) throw new Error('Numeric prerelease labels cannot have leading zeroes');
  return { original: text, major: numbers[0], minor: numbers[1], patch: numbers[2], revision: numbers[3],
    prerelease, metadata: match[6] ?? null, normalized: release + (prerelease ? '-' + prerelease : '') };
}
export function compareNuGetVersions(left, right) {
  const a = typeof left === 'string' ? parseNuGetVersion(left) : left;
  const b = typeof right === 'string' ? parseNuGetVersion(right) : right;
  for (const key of ['major', 'minor', 'patch', 'revision']) if (a[key] !== b[key]) return a[key] - b[key];
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  const partsA = a.prerelease.toLowerCase().split('.'), partsB = b.prerelease.toLowerCase().split('.');
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index++) {
    const x = partsA[index], y = partsB[index];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { const ax = BigInt(x), by = BigInt(y); if (ax !== by) return ax < by ? -1 : 1; continue; }
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function parseNuGetRange(text) {
  if (typeof text !== 'string' || text.length > 1024) throw new Error('Invalid NuGet range');
  const source = text.trim();
  if (!source) throw new Error('NuGet ranges cannot be empty');
  if (source.includes('*')) {
    const match = /^(\*|\d+(?:\.\d+){0,3})(?:\.(\*))?(?:-([0-9A-Za-z.-]*\*))?$/.exec(source);
    if (!match) throw new Error('Invalid floating NuGet range: ' + text);
    const numeric = source.split('-')[0], prefix = numeric === '*' ? [] : numeric.replace(/\.\*$/, '').split('.').map(Number);
    if (!numeric.includes('*') && !match[3]) throw new Error('Invalid floating NuGet range');
    return { original: source, floating: true, prefix, prereleasePrefix: match[3]?.slice(0, -1) ?? null,
      includePrerelease: Boolean(match[3]), minimum: null, maximum: null };
  }
  const interval = /^([\[(])([^,\]\)]*)(?:,([^\]\)]*))?([\])])$/.exec(source);
  if (interval) {
    const exact = interval[3] === undefined;
    if (exact && (interval[1] !== '[' || interval[4] !== ']')) throw new Error('Exact ranges use [version]');
    const minimum = interval[2].trim() ? parseNuGetVersion(interval[2].trim()) : null;
    const maximum = exact ? minimum : interval[3].trim() ? parseNuGetVersion(interval[3].trim()) : null;
    if (!minimum && !maximum || minimum && maximum && compareNuGetVersions(minimum, maximum) > 0) throw new Error('Invalid NuGet bounds');
    return { original: source, minimum, maximum, includeMinimum: interval[1] === '[', includeMaximum: interval[4] === ']' };
  }
  return { original: source, minimum: source ? parseNuGetVersion(source) : null, maximum: null, includeMinimum: true, includeMaximum: false };
}
export function satisfiesNuGetRange(version, range) {
  const value = typeof version === 'string' ? parseNuGetVersion(version) : version;
  const constraint = typeof range === 'string' ? parseNuGetRange(range) : range;
  if (constraint.floating) {
    const numbers = [value.major, value.minor, value.patch, value.revision];
    if (constraint.prefix.some((part, index) => part !== numbers[index])) return false;
    if (!constraint.includePrerelease) return !value.prerelease;
    return !value.prerelease || value.prerelease.toLowerCase().startsWith(constraint.prereleasePrefix.toLowerCase());
  }
  const lower = constraint.minimum ? compareNuGetVersions(value, constraint.minimum) : 1;
  const upper = constraint.maximum ? compareNuGetVersions(value, constraint.maximum) : -1;
  return (lower > 0 || lower === 0 && constraint.includeMinimum) && (upper < 0 || upper === 0 && constraint.includeMaximum);
}
