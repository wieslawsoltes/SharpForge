import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkError } from '@sharpforge/network';
import { target } from '../../../scripts/conformance/fuzz/targets/network.js';
import {
  httpTransportChecks, httpTransportData, httpTransportEffectiveLimits, httpTransportSeeds,
} from '../../../scripts/conformance/fuzz/targets/http-transport-input.js';
import { inspectHttpTransportError } from '../../../scripts/conformance/fuzz/targets/http-transport.js';

const limits = { maxInputBytes: 65536, maxOutputBytes: 65536 };
const input = value => new TextEncoder().encode(JSON.stringify(value));
const httpCase = (check, variant = 0, context = limits) => target.run(input({ operation: 'http-transport', check, variant }), context);

function proof(result, check) {
  assert.equal(result.status, 'accepted');
  assert.equal(result.code, 'NETWORK_HTTP_TRANSPORT');
  assert(Buffer.byteLength(result.detail) <= 2048);
  const value = JSON.parse(result.detail);
  assert.equal(value.profile, 'actual-loopback-http-transport');
  assert.equal(value.address, '127.0.0.1');
  assert.equal(value.check, check);
  assert.equal(value.exactOriginGrants, 1);
  assert.equal(value.calls, 2);
  assert.equal(value.requests, check === 'request-limit' ? 1 : 2);
  assert.equal(value.records.length, value.requests);
  assert.deepEqual(value.control, { statusCode: 200, ok: true, bytes: 2 });
  assert.equal(value.records[0].method, 'GET');
  assert.equal(value.records[0].route, '/control');
  assert(value.requestBytes <= value.limits.requestBytes);
  assert(value.bodyBytesWritten <= value.control.bytes + value.limits.responseBytes + 1);
  assert.equal(value.limits.requestBytes, 32);
  assert.equal(value.limits.responseBytes, 32);
  assert.equal(value.limits.requests, 2);
  assert(value.connections > 0 && value.connections <= value.limits.connections);
  assert.equal(value.stats.maxActive, 1);
  assert.equal(value.transportClosed, true);
  assert.equal(value.serverClosed, true);
  assert.equal(value.activeJobs, 0);
  assert.equal(value.queuedJobs, 0);
  assert.equal(value.openSockets, 0);
  assert.equal(value.pendingTimers, 0);
  return value;
}

test('HTTP target rejects caller-provided authority and open-ended request configuration before effects', () => {
  for (const [key, value] of Object.entries({
    url: 'https://example.invalid', host: '127.0.0.1', port: 80, origin: 'https://example.invalid',
    path: '/secret', route: '/redirect', method: 'DELETE', headers: {}, body: 'text', timeoutMs: 1,
    allowedOrigins: ['https://example.invalid'], root: '/', fetch: 'replacement', maxRequests: 999,
  })) {
    assert.deepEqual(target.run(input({ operation: 'http-transport', check: 'request-exact', [key]: value }), limits), {
      status: 'rejected', code: 'NETWORK_HTTP_TRANSPORT_SCHEMA',
    });
  }
  for (const check of [undefined, null, 'redirect', 'provider', '../child.js', {}]) {
    assert.deepEqual(httpCase(check), { status: 'rejected', code: 'NETWORK_HTTP_TRANSPORT_SCHEMA' });
  }
  for (const variant of [null, -1, 0.5, 65536, '0', {}]) {
    assert.deepEqual(httpCase('response-exact', variant), { status: 'rejected', code: 'NETWORK_HTTP_TRANSPORT_VARIANT' });
  }
});

test('HTTP seeds own their small deterministic inputs and only select the closed request profiles', () => {
  const first = httpTransportSeeds(), second = httpTransportSeeds();
  assert.equal(first.length, httpTransportChecks.length);
  assert.deepEqual(first, second);
  assert(first.every(seed => seed.input.byteLength < 128));
  assert.equal(new Set(first.map(seed => seed.name)).size, first.length);
  first[0].input.fill(0);
  assert.notDeepEqual(first[0].input, second[0].input);
});

test('HTTP fixture limits can narrow but cannot exceed its tiny hard ceilings', () => {
  assert.deepEqual(httpTransportEffectiveLimits(limits), httpTransportEffectiveLimits({ maxInputBytes: 1e9, maxOutputBytes: 1e9 }));
  const narrow = httpTransportEffectiveLimits({ maxInputBytes: 8, maxOutputBytes: 3 });
  assert.equal(narrow.requestBytes, 8);
  assert.equal(narrow.responseBytes, 3);
  assert.equal(httpTransportData({ check: 'request-limit', variant: 0 }, narrow).request.byteLength, 9);
  assert.equal(httpTransportData({ check: 'announced-limit', variant: 0 }, narrow).response.byteLength, 4);
  assert.throws(() => httpTransportData({ check: 'request-exact', variant: 0 }, { requestBytes: 1e9, responseBytes: 32 }), RangeError);
  assert.throws(() => httpTransportEffectiveLimits({ maxInputBytes: 1, maxOutputBytes: 0 }), RangeError);
});

test('public HttpTransport preserves the exact response byte boundary and disposes actual owned connections', async () => {
  const originalFetch = globalThis.fetch;
  const value = proof(await httpCase('response-exact', 65535), 'response-exact');
  assert.deepEqual(value.challenge, { statusCode: 200, ok: true, bytes: 32 });
  assert.equal(value.stats.receivedBytes, 34);
  assert.equal(value.stats.completed, 2);
  assert.equal(value.stats.failed, 0);
  assert.equal(globalThis.fetch, originalFetch);
});

test('public HttpTransport reconstructs streamed text across an actual split UTF-8 scalar', async () => {
  for (const variant of [0, 1]) {
    const value = proof(await httpCase('response-stream', variant), 'response-stream');
    const expected = Buffer.byteLength(variant ? 'écho ☕\n' : 'żółw 🐈\n');
    assert.equal(value.challenge.bytes, expected);
    assert.equal(value.records[1].bodyBytesWritten, expected);
    assert.equal(value.stats.receivedBytes, 2 + expected);
    assert.equal(value.challenge.statusCode, 200);
  }
});

test('public HttpTransport retains success and failure HTTP status while filtering the fixture Set-Cookie header', async () => {
  for (const variant of [0, 1]) {
    const value = proof(await httpCase('response-status', variant), 'response-status');
    assert.equal(value.challenge.statusCode, variant ? 404 : 201);
    assert.equal(value.challenge.ok, variant === 0);
    assert.equal(value.records[1].statusCode, value.challenge.statusCode);
  }
});

test('announced overflow is refused after headers before the fixture writes or returns any body bytes', async () => {
  const value = proof(await httpCase('announced-limit'), 'announced-limit');
  assert.deepEqual(value.challenge, { code: 'LIMIT', returnedBody: false });
  assert.equal(value.records[1].statusCode, 200);
  assert.equal(value.records[1].bodyBytesWritten, 0);
  assert.equal(value.forcedHeaderClose, false);
  assert.equal(value.bodyBytesWritten, 2);
  assert.equal(value.stats.receivedBytes, 2);
  assert.equal(value.stats.failed, 1);
});

test('chunked overflow crosses a tiny response boundary without returning a partial result', async () => {
  const value = proof(await httpCase('stream-limit'), 'stream-limit');
  assert.deepEqual(value.challenge, { code: 'LIMIT', returnedBody: false });
  assert.equal(value.records[1].bodyBytesWritten, 33);
  assert.equal(value.stats.receivedBytes, 2);
  assert.equal(value.stats.failed, 1);
});

test('exact request bytes arrive unchanged and one extra byte is refused before any challenge request is sent', async () => {
  const exact = proof(await httpCase('request-exact', 65535), 'request-exact');
  assert.equal(exact.records[1].method, 'POST');
  assert.equal(exact.records[1].route, '/request');
  assert.equal(exact.records[1].requestBytes, 32);
  assert.equal(exact.requestBytes, 32);
  assert.equal(exact.stats.requests, 2);
  const over = proof(await httpCase('request-limit', 65535), 'request-limit');
  assert.deepEqual(over.challenge, { code: 'LIMIT', returnedBody: false });
  assert.equal(over.requestBytes, 0);
  assert.equal(over.stats.requests, 1);
  assert.equal(over.stats.receivedBytes, 2);
});

test('real in-flight HTTP cancellation retains its exact reason and disposes sockets and response timers', async () => {
  const value = proof(await httpCase('cancel'), 'cancel');
  assert.deepEqual(value.challenge, { code: 'ABORT', identityPreserved: true, returnedBody: false });
  assert.equal(value.delayedRequestObserved, true);
  assert.equal(value.records[1].route, '/delay');
  assert.equal(value.records[1].statusCode, null);
  assert.equal(value.records[1].bodyBytesWritten, 0);
  assert.equal(value.stats.canceled, 1);
  assert.equal(value.stats.failed, 0);
});

test('real HTTP deadline remains distinct from cancellation and closes the delayed fixture response', async () => {
  const value = proof(await httpCase('timeout'), 'timeout');
  assert.deepEqual(value.challenge, { code: 'TIMEOUT', returnedBody: false });
  assert.equal(value.delayedRequestObserved, true);
  assert.equal(value.records[1].statusCode, null);
  assert.equal(value.stats.canceled, 0);
  assert.equal(value.stats.failed, 1);
});

test('outer cancellation is never counted as the fixture cancellation or a permitted parser error', async () => {
  const reason = new Error('Stop the enclosing HTTP case');
  const preCanceled = new AbortController();
  preCanceled.abort(reason);
  assert.throws(() => httpCase('cancel', 0, { ...limits, signal: preCanceled.signal }), error => error === reason);
  const active = new AbortController();
  const pending = httpCase('timeout', 0, { ...limits, signal: active.signal });
  active.abort(reason);
  await assert.rejects(pending, error => error === reason);
});

test('the expected-error boundary preserves unknown, wrong-profile and programmer failures as findings', () => {
  const cancellation = new DOMException('Owned cancellation', 'AbortError');
  for (const error of [new Error('unknown'), new TypeError('bad receiver'), new RangeError('bad length'),
    new NetworkError('different response failure', 'LIMIT'), new NetworkError('HTTP request deadline exceeded', 'DENIED')]) {
    assert.throws(() => inspectHttpTransportError(error, 'announced-limit', cancellation), observed => observed === error);
  }
  const limit = new NetworkError('Response exceeds the configured byte limit', 'LIMIT');
  assert.throws(() => inspectHttpTransportError(limit, 'response-exact', cancellation), error => error === limit);
  const otherCancellation = new DOMException('Other cancellation', 'AbortError');
  assert.throws(() => inspectHttpTransportError(otherCancellation, 'cancel', cancellation), error => error === otherCancellation);
  assert.deepEqual(inspectHttpTransportError(cancellation, 'cancel', cancellation), { code: 'ABORT', identityPreserved: true });
});
