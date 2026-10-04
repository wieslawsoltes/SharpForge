/** Parse both workload table output and the documented machine-readable installed workload records. */
export function parseWorkloadList(text) {
  const trimmed = String(text).trim();
  if (trimmed.startsWith('{')) {
    const value = JSON.parse(trimmed);
    return (value.installed ?? value.installedWorkloads ?? []).map(item => typeof item === 'string' ? { id: item } :
      ({ id: item.id ?? item.workloadId, manifestVersion: item.manifestVersion ?? null, installationSource: item.installationSource ?? null }));
  }
  const workloads = [];
  let table = false;
  for (const line of trimmed.split(/\r?\n/)) {
    if (/^-{3,}/.test(line.trim())) { table = true; continue; }
    if (!table || !line.trim()) continue;
    const match = /^\s*([a-z][a-z0-9-]+)\s+(\S+)\s+(.+)$/i.exec(line);
    if (match) workloads.push({ id: match[1], manifestVersion: match[2], installationSource: match[3].trim() });
  }
  return workloads;
}

const platformWorkloads = Object.freeze({ android: 'android', ios: 'ios', maccatalyst: 'maccatalyst', tvos: 'tvos', tizen: 'tizen' });
export function explainTargetAvailability(targetFramework, { workloads = [], sdkVersion = null, platform = null } = {}) {
  const match = /^net(\d+)\.(\d+)(?:-([a-z]+)[\d.]*)?$/.exec(targetFramework);
  if (!match) return { available: null, code: 'SFMSB_TFM_UNKNOWN', message: 'Target requires authoritative SDK evaluation: ' + targetFramework };
  const targetPlatform = match[3], installed = new Set(workloads.map(item => typeof item === 'string' ? item : item.id));
  if (sdkVersion && +sdkVersion.split('.')[0] < +match[1]) return { available: false, code: 'NETSDK1045',
    message: `Target ${targetFramework} needs .NET SDK ${match[1]}.0 or newer`, installCommand: null };
  const workload = platformWorkloads[targetPlatform];
  if (workload && !installed.has(workload) && !installed.has('maui') && !installed.has('maui-' + targetPlatform)) {
    return { available: false, code: 'NETSDK1147', workload, message: `Install workload '${workload}' for ${targetFramework}`,
      installCommand: 'dotnet workload install ' + workload };
  }
  if (targetPlatform === 'windows' && platform && platform !== 'win32') return { available: null, code: 'NETSDK1100',
    message: 'Windows targeting on this host requires EnableWindowsTargeting=true; execution still requires Windows', property: 'EnableWindowsTargeting' };
  return { available: true, message: 'SDK/workload inventory contains this target; build qualification remains separate' };
}
