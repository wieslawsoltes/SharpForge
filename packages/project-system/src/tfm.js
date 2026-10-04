/** Parse a NuGet target framework moniker; unknown frameworks remain explicitly unsupported. */
export function parseTargetFramework(value) {
  const original = String(value ?? '').trim();
  const match = /^(netstandard|netcoreapp|net)(\d+(?:\.\d+){0,3})(?:-([a-z]+)(\d+(?:\.\d+){0,3})?)?$/i.exec(original);
  const invalid = !match || original.length > 256 || [match?.[2], match?.[4]].filter(Boolean)
    .some(value => value.split('.').some(part => !Number.isSafeInteger(Number(part)) || Number(part) > 2147483647));
  if (invalid) return { original, supported: false, identifier: '', version: '', platform: '', platformVersion: '' };
  let version = match[2];
  const family = match[1].toLowerCase();
  const compact = family === 'net' && !version.includes('.');
  if (compact) version = version.split('').join('.');
  if (!version.includes('.')) version += '.0';
  const identifier = family === 'netstandard' ? '.NETStandard'
    : family === 'netcoreapp' || (!compact && Number(version.split('.')[0]) >= 5) ? '.NETCoreApp' : '.NETFramework';
  return {
    original, supported: true, identifier, version,
    platform: match[3]?.toLowerCase() ?? '', platformVersion: match[4] || '',
  };
}

export function compareFrameworkVersions(left, right) {
  const first = String(left).replace(/^v/i, '').split('.').map(Number);
  const second = String(right).replace(/^v/i, '').split('.').map(Number);
  for (let index = 0; index < Math.max(first.length, second.length); index++) {
    const difference = (first[index] ?? 0) - (second[index] ?? 0);
    if (difference) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/** Whether a target may reference an asset framework, including .NET Standard compatibility. */
export function isTargetFrameworkCompatible(target, candidate) {
  const host = typeof target === 'string' ? parseTargetFramework(target) : target;
  const asset = typeof candidate === 'string' ? parseTargetFramework(candidate) : candidate;
  if (!host?.supported || !asset?.supported) return false;
  if (asset.platform && (host.platform !== asset.platform || compareFrameworkVersions(host.platformVersion, asset.platformVersion) < 0)) {
    return false;
  }
  if (host.identifier === asset.identifier) return compareFrameworkVersions(host.version, asset.version) >= 0;
  if (asset.identifier !== '.NETStandard') return false;
  let maximum = '';
  if (host.identifier === '.NETCoreApp') maximum = compareFrameworkVersions(host.version, '3.0') >= 0 ? '2.1'
    : compareFrameworkVersions(host.version, '2.0') >= 0 ? '2.0' : '1.6';
  if (host.identifier === '.NETFramework') {
    if (compareFrameworkVersions(host.version, '4.6.1') >= 0) maximum = '2.0';
    else if (compareFrameworkVersions(host.version, '4.6') >= 0) maximum = '1.3';
    else if (compareFrameworkVersions(host.version, '4.5.1') >= 0) maximum = '1.2';
    else if (compareFrameworkVersions(host.version, '4.5') >= 0) maximum = '1.1';
  }
  return Boolean(maximum) && compareFrameworkVersions(maximum, asset.version) >= 0;
}

/** Choose the nearest compatible asset, preferring the same family/platform and highest version. */
export function nearestTargetFramework(target, candidates) {
  const host = parseTargetFramework(target);
  const compatible = candidates.map(value => ({ value, framework: parseTargetFramework(value) }))
    .filter(entry => isTargetFrameworkCompatible(host, entry.framework));
  compatible.sort((first, second) => {
    return Number(second.framework.identifier === host.identifier) - Number(first.framework.identifier === host.identifier)
      || compareFrameworkVersions(second.framework.version, first.framework.version)
      || Number(Boolean(second.framework.platform)) - Number(Boolean(first.framework.platform))
      || compareFrameworkVersions(second.framework.platformVersion, first.framework.platformVersion);
  });
  return compatible[0]?.value ?? null;
}

/** Deterministic SDK framework symbols; reject versions that could cause unbounded symbol generation. */
export function targetFrameworkDefines(value) {
  const framework = typeof value === 'string' ? parseTargetFramework(value) : value;
  if (!framework?.supported) return [];
  const version = framework.version.replaceAll('.', '_');
  if (framework.identifier === '.NETFramework') return ['NETFRAMEWORK', 'NET' + framework.version.replaceAll('.', '')];
  const major = Number(framework.version.split('.')[0]);
  if (major > 100) throw new RangeError('Framework define count limit exceeded.');
  const prefix = framework.identifier === '.NETStandard' ? 'NETSTANDARD' : major >= 5 ? 'NET' : 'NETCOREAPP';
  const constants = [prefix, prefix + version];
  if (prefix === 'NET') constants.push('NETCOREAPP');
  if (framework.platform) constants.push(framework.platform.toUpperCase());
  if (prefix === 'NET') for (let current = 5; current <= major; current++) constants.push(`NET${current}_0_OR_GREATER`);
  if (prefix === 'NET') constants.push('NETCOREAPP1_0_OR_GREATER', 'NETCOREAPP1_1_OR_GREATER', 'NETCOREAPP2_0_OR_GREATER',
    'NETCOREAPP2_1_OR_GREATER', 'NETCOREAPP2_2_OR_GREATER', 'NETCOREAPP3_0_OR_GREATER', 'NETCOREAPP3_1_OR_GREATER');
  return constants;
}
