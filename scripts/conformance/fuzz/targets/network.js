import { createBrowserCsp, NetworkError, NetworkPolicy } from '@sharpforge/network';
import { httpTransportPlan, httpTransportSeeds } from './http-transport-input.js';
import { runHttpTransport } from './http-transport.js';
import { nativeHostPlan, nativeHostSeeds } from './native-host-input.js';
import { runNativeHost } from './native-host.js';
import {
  checkTextOutput, decodeText, parseTextJson, runTextTarget, textSeed, TextTargetRejection,
} from './text-contract.js';

const unsupportedProfiles = new Map([
  ['host-token', 'NETWORK_HOST_TOKEN_UNSUPPORTED'],
  ['host-origin', 'NETWORK_HOST_ORIGIN_UNSUPPORTED'],
  ['host-path', 'NETWORK_HOST_PATH_UNSUPPORTED'],
]);

function createSeeds() {
  const seed = (name, value) => textSeed(name, JSON.stringify(value));
  return [
    seed('allowed-origin', { operation: 'origin', allowedOrigins: ['https://example.test'], url: 'https://example.test/item' }),
    seed('relative-url', { operation: 'origin', allowedOrigins: ['https://example.test'], url: 'item', base: 'https://example.test/' }),
    seed('denied-origin', { operation: 'origin', allowedOrigins: ['https://example.test'], url: 'https://other.test/' }),
    seed('non-origin-grant', { operation: 'origin', allowedOrigins: ['https://example.test/path'], url: 'https://example.test/' }),
    seed('allowed-headers', { operation: 'headers', headers: { Accept: 'application/json' } }),
    seed('denied-header', { operation: 'headers', headers: { Origin: 'https://example.test' } }),
    seed('browser-csp', { operation: 'csp', allowedOrigins: ['https://example.test'] }),
    ...nativeHostSeeds(),
    ...httpTransportSeeds(),
  ];
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireInput(condition) {
  if (!condition) throw new TextTargetRejection('NETWORK_INPUT_SCHEMA');
}

function headersFromData(input) {
  requireInput(record(input));
  requireInput(Object.values(input).every(value => typeof value === 'string'));
  // Native Headers syntax validation is isolated from the product policy call.
  try {
    return new Headers(input);
  } catch (error) {
    if (error instanceof TypeError) throw new TextTargetRejection('NETWORK_HEADER_SYNTAX');
    throw error;
  }
}

function classifyNetworkError(error) {
  if (error instanceof NetworkError && ['URL', 'DENIED', 'HEADER'].includes(error.code)) {
    return { status: 'rejected', code: 'NETWORK_' + error.code };
  }
  if (error?.constructor === TypeError && (error.code === 'ERR_INVALID_URL'
    || error.message === 'Grants must be exact HTTP(S)/WS(S) origins')) {
    return { status: 'rejected', code: 'NETWORK_GRANT' };
  }
  return null;
}

const operations = {
  origin(input, policy, limits) {
    requireInput(typeof input.url === 'string' && (input.base === undefined || typeof input.base === 'string'));
    checkTextOutput(policy.check(input.url, input.base).href, limits);
  },
  headers(input, policy, limits) {
    const headers = policy.headers(headersFromData(input.headers));
    checkTextOutput(JSON.stringify([...headers]), limits);
  },
  csp(input, policy, limits) {
    checkTextOutput(createBrowserCsp([...policy.origins]), limits);
  },
};

function parse(input, limits) {
  const data = parseTextJson(decodeText(input));
  requireInput(record(data) && typeof data.operation === 'string');
  if (data.operation === 'native-host') return runNativeHost(nativeHostPlan(data), limits);
  if (data.operation === 'http-transport') return runHttpTransport(httpTransportPlan(data), limits);
  if (unsupportedProfiles.has(data.operation)) {
    return { status: 'unsupported', code: unsupportedProfiles.get(data.operation) };
  }
  if (!Object.hasOwn(operations, data.operation)) return { status: 'unsupported', code: 'NETWORK_OPERATION_UNSUPPORTED' };
  const allowedOrigins = data.allowedOrigins ?? [];
  requireInput(Array.isArray(allowedOrigins) && allowedOrigins.length <= 100);
  requireInput(allowedOrigins.every(value => typeof value === 'string'));
  const policy = new NetworkPolicy({
    allowedOrigins,
    maxRequestBytes: limits.maxInputBytes,
    maxResponseBytes: limits.maxOutputBytes,
  });
  operations[data.operation](data, policy, limits);
}

/** Pure policy plus fixed native-host and public HttpTransport cases on disposable owned loopback servers. */
export const target = {
  id: 'network',
  createSeeds,
  run(input, context) {
    return runTextTarget(input, context, parse, classifyNetworkError);
  },
};
