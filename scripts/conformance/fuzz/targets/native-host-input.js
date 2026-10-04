import { TextTargetRejection, textSeed } from './text-contract.js';

export const nativeHostChecks = Object.freeze(['valid', 'token', 'origin', 'host', 'fetch-site', 'path']);
export const nativeHostToken = 'a'.repeat(64);
export const nativeHostFile = 'Allowed.txt';
export const nativeHostContents = 'SharpForge owned loopback control\n';
export const nativeHostOutside = 'SharpForge outside-root sentinel\n';

const pathVariants = Object.freeze([
  '../Outside.txt', '..\\Outside.txt', null, null,
  'child/../../Outside.txt', '.git/config', 'node_modules/item', '..%2fOutside.txt',
]);

/** The input selects data variations only, never a socket, directory, URL, HTTP verb or endpoint. */
export function nativeHostPlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['operation', 'check', 'variant'].includes(key))
    || input.operation !== 'native-host' || !nativeHostChecks.includes(input.check)) {
    throw new TextTargetRejection('NETWORK_NATIVE_HOST_SCHEMA');
  }
  const variant = input.variant ?? 0;
  if (!Number.isInteger(variant) || variant < 0 || variant > 65535) {
    throw new TextTargetRejection('NETWORK_NATIVE_HOST_VARIANT');
  }
  return Object.freeze({ check: input.check, variant });
}

/** All destinations are derived from the owned server; foreign names occur only as header data. */
export function nativeHostRequest(plan, origin, outsidePath) {
  const { check, variant } = nativeHostPlan({ operation: 'native-host', ...plan });
  const suffix = variant.toString(16).padStart(4, '0');
  const headers = { Authorization: 'Bearer ' + nativeHostToken, Origin: origin, Connection: 'close' };
  let path = nativeHostFile;
  let expectedStatuses = [200];
  if (check === 'token') {
    if (variant % 3 === 0) delete headers.Authorization;
    else headers.Authorization = variant % 3 === 1 ? 'Bearer ' + 'b'.repeat(64) : 'Bearer bad-' + suffix;
    expectedStatuses = [401];
  } else if (check === 'origin') {
    headers.Origin = variant % 2 ? 'null' : 'https://foreign-' + suffix + '.invalid';
    expectedStatuses = [403];
  } else if (check === 'host') {
    headers.Host = 'foreign-' + suffix + '.invalid';
    expectedStatuses = [403];
  } else if (check === 'fetch-site') {
    headers['Sec-Fetch-Site'] = variant % 2 ? 'same-site' : 'cross-site';
    expectedStatuses = [403];
  } else if (check === 'path') {
    const index = variant % pathVariants.length;
    path = index === 2 ? outsidePath : index === 3 ? outsidePath.replaceAll('/', '\\') : pathVariants[index];
    expectedStatuses = [400, 403, 404];
  }
  return { check, variant, path: '/api/msbuild/file?path=' + encodeURIComponent(path), headers, expectedStatuses };
}

export function nativeHostSeeds() {
  const values = nativeHostChecks.map(check => [check, 0]);
  values.push(['token', 1], ['path', 1], ['path', 4]);
  return values.map(([check, variant]) => textSeed(`native-${check}-${variant}`,
    JSON.stringify({ operation: 'native-host', check, variant })));
}
