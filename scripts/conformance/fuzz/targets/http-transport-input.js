import { TextTargetRejection, textSeed } from './text-contract.js';

export const httpTransportChecks = Object.freeze([
  'response-exact', 'response-stream', 'response-status', 'announced-limit', 'stream-limit',
  'request-exact', 'request-limit', 'cancel', 'timeout',
]);

export const httpTransportLimits = Object.freeze({
  requests: 2, requestBytes: 32, responseBytes: 32, requestHeaderBytes: 4096, connections: 4,
  requestTimeoutMs: 250, selectedTimeoutMs: 30, delayedResponseMs: 120, headerOnlyTimeoutMs: 150, streamDelayMs: 5,
});

/** A data selector cannot grant a URL, socket, route, body, header, timeout or filesystem capability. */
export function httpTransportPlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['operation', 'check', 'variant'].includes(key))
    || input.operation !== 'http-transport' || !httpTransportChecks.includes(input.check)) {
    throw new TextTargetRejection('NETWORK_HTTP_TRANSPORT_SCHEMA');
  }
  const variant = input.variant === undefined ? 0 : input.variant;
  if (!Number.isInteger(variant) || variant < 0 || variant > 65535) {
    throw new TextTargetRejection('NETWORK_HTTP_TRANSPORT_VARIANT');
  }
  return Object.freeze({ check: input.check, variant });
}

export function httpTransportEffectiveLimits(limits) {
  for (const key of ['maxInputBytes', 'maxOutputBytes']) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) throw new RangeError('Invalid HTTP fixture ' + key);
  }
  return Object.freeze({
    ...httpTransportLimits,
    requestBytes: Math.min(httpTransportLimits.requestBytes, limits.maxInputBytes),
    responseBytes: Math.min(httpTransportLimits.responseBytes, limits.maxOutputBytes),
  });
}

/** Every byte and route originates here; mutations only choose from bounded, locally authored data. */
export function httpTransportData(plan, limits) {
  const { check, variant } = httpTransportPlan({ operation: 'http-transport', ...plan });
  for (const key of ['requestBytes', 'responseBytes']) {
    if (!Number.isInteger(limits[key]) || limits[key] < 1 || limits[key] > httpTransportLimits[key]) {
      throw new RangeError('Invalid bounded HTTP fixture ' + key);
    }
  }
  const control = Buffer.from('OK').subarray(0, limits.responseBytes);
  const byte = 65 + variant % 26;
  const request = Buffer.alloc(limits.requestBytes + (check === 'request-limit' ? 1 : 0), byte);
  let response = control;
  if (check === 'response-exact') response = Buffer.alloc(limits.responseBytes, byte);
  if (check === 'response-stream') response = Buffer.from(variant % 2 ? 'écho ☕\n' : 'żółw 🐈\n').subarray(0, limits.responseBytes);
  if (check === 'announced-limit' || check === 'stream-limit') response = Buffer.alloc(limits.responseBytes + 1, byte);
  const method = check.startsWith('request-') ? 'POST' : 'GET';
  const route = method === 'POST' ? '/request' : ['cancel', 'timeout'].includes(check) ? '/delay' : '/response';
  const statusCode = check === 'response-status' ? (variant % 2 ? 404 : 201) : 200;
  return { check, variant, control, request, response, method, route, statusCode };
}

export function httpTransportSeeds() {
  return httpTransportChecks.map(check => textSeed('http-' + check,
    JSON.stringify({ operation: 'http-transport', check, variant: 0 })));
}
