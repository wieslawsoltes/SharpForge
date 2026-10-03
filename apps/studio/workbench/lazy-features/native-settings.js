/** Mutable settings belong to one native workspace and can be configured before its tool is activated. */
export function createNativeBuildSettings() {
  return { project: '', configuration: 'Debug', platform: '', framework: '', runtime: '', properties: '', targets: '',
    resultTargets: '', arguments: '', verbosity: 'minimal', maxNodes: '1', restore: true, binaryLog: false,
    graphBuild: false, trusted: false, save: true };
}

/** Only token-bearing local-host entry URLs justify activating native integration during startup. */
export function hasLocalHostCapability(location = globalThis.location) {
  return Boolean(new URLSearchParams(location?.hash?.slice(1) ?? '').get('sharpforge-token'));
}
