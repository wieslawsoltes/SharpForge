import { SymbolError } from './contracts.js';

export const SourceStatus = Object.freeze({
  verified: 'verified',
  missing: 'missing',
  denied: 'denied',
  mismatch: 'checksum-mismatch',
  unsupportedHash: 'unsupported-hash',
  invalidEncoding: 'invalid-encoding',
  invalidUrl: 'invalid-url',
  tooLarge: 'too-large',
  timeout: 'timeout',
  cancelled: 'cancelled',
  disposed: 'disposed',
  busy: 'busy',
  networkError: 'network-error',
  httpError: 'http-error',
  invalidIdentity: 'invalid-identity',
});

export function sourceFailure(status, message) {
  const error = new SymbolError(message, { code: 'SF_SYMBOL_SOURCE_' + status.toUpperCase().replaceAll('-', '_') });
  error.sourceStatus = status;
  return error;
}

export function sourceResult(status, detail = {}) {
  return { status, verified: status === SourceStatus.verified, bytes: null, text: null, ...detail };
}

export function httpsUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw sourceFailure(SourceStatus.invalidUrl, 'Invalid source URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw sourceFailure(SourceStatus.invalidUrl, 'Source URLs must use credential-free HTTPS');
  }
  return url;
}
