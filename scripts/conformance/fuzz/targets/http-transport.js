import { HttpTransport, NetworkError } from '@sharpforge/network';
import { httpTransportPlan } from './http-transport-input.js';
import { startHttpTransportFixture } from './http-transport-server.js';

function invariant(condition, message) {
  if (!condition) throw new Error('HttpTransport invariant: ' + message);
}

/** Expected errors are local to the selected negative case; every other error remains a finding candidate. */
export function inspectHttpTransportError(error, check, cancellation) {
  if (check === 'cancel' && cancellation instanceof DOMException && cancellation.name === 'AbortError' && error === cancellation) {
    return { code: 'ABORT', identityPreserved: true };
  }
  const expected = {
    'announced-limit': ['LIMIT', 'Response exceeds the configured byte limit'],
    'stream-limit': ['LIMIT', 'Response exceeds the configured byte limit'],
    'request-limit': ['LIMIT', 'Request body exceeds the configured byte limit'],
    timeout: ['TIMEOUT', 'HTTP request deadline exceeded'],
  }[check];
  if (expected && error instanceof NetworkError && error.code === expected[0] && error.message === expected[1]) {
    return { code: error.code };
  }
  throw error;
}

function inspectResponse(response, body, status, expectedUrl) {
  invariant(response.status === status && response.ok === (status >= 200 && status < 300), 'HTTP status was not preserved');
  invariant(response.url === expectedUrl, 'the response URL escaped its fixed route');
  invariant(response.bytes instanceof Uint8Array && Buffer.from(response.bytes).equals(body), 'response bytes did not round-trip');
  invariant(response.text === new TextDecoder().decode(body), 'streamed UTF-8 text did not round-trip');
  invariant(response.headers['x-sharpforge-fixture'] === 'bounded-http', 'the fixed response header was not parsed');
  invariant(!Object.keys(response.headers).some(key => key.toLowerCase() === 'set-cookie'), 'Set-Cookie escaped header filtering');
  return { statusCode: response.status, ok: response.ok, bytes: response.bytes.byteLength };
}

/** Exercise the real public transport and native fetch with one exact origin grant; input never selects a destination. */
export async function runHttpTransport(plan, context) {
  const selected = httpTransportPlan({ operation: 'http-transport', ...plan });
  context.signal?.throwIfAborted();
  const controller = new AbortController();
  const cancellation = new DOMException('Owned HTTP fixture request canceled after arrival', 'AbortError');
  const outerAbort = () => controller.abort(context.signal.reason);
  context.signal?.addEventListener('abort', outerAbort, { once: true });
  if (context.signal?.aborted) outerAbort();
  let fixture, transport, failure, control, challenge, failed = false, calls = 0, delayedRequestObserved = false;
  try {
    fixture = await startHttpTransportFixture(selected, context, () => {
      delayedRequestObserved = true;
      if (selected.check === 'cancel') controller.abort(cancellation);
    });
    context.signal?.throwIfAborted();
    const { limits, data, origin } = fixture;
    transport = new HttpTransport({
      allowedOrigins: [origin], maxRequestBytes: limits.requestBytes, maxResponseBytes: limits.responseBytes,
      timeoutMs: limits.requestTimeoutMs, maxConcurrent: 1, maxQueue: 1,
    });
    invariant(transport.policy.origins.size === 1 && transport.policy.origins.has(origin), 'the exact origin grant was not retained');
    invariant(transport.policy.maxRequestBytes === limits.requestBytes && transport.policy.maxResponseBytes === limits.responseBytes,
      'the configured byte limits were not retained');
    const call = (route, options) => {
      invariant(++calls <= limits.requests, 'request call budget exceeded');
      invariant(['/control', data.route].includes(route), 'request route was not selected by the fixture');
      return transport.request(origin + route, options);
    };
    control = inspectResponse(await call('/control', { signal: context.signal }), data.control, 200, origin + '/control');
    context.signal?.throwIfAborted();
    let observedError, rejected = false, response;
    try {
      response = await call(data.route, {
        method: data.method, body: data.method === 'POST' ? data.request : null,
        headers: { Accept: 'text/plain', 'X-SharpForge-Request': 'bounded-http' },
        signal: selected.check === 'cancel' ? controller.signal : context.signal,
        timeoutMs: selected.check === 'timeout' ? limits.selectedTimeoutMs : limits.requestTimeoutMs,
      });
    } catch (error) { rejected = true; observedError = error; }
    context.signal?.throwIfAborted();
    const negative = ['announced-limit', 'stream-limit', 'request-limit', 'cancel', 'timeout'].includes(selected.check);
    if (negative) {
      invariant(rejected, selected.check + ' unexpectedly completed');
      challenge = { ...inspectHttpTransportError(observedError, selected.check, cancellation), returnedBody: false };
      invariant(transport.stats.receivedBytes === control.bytes, 'a refused response was counted as retained response bytes');
      if (selected.check === 'cancel' || selected.check === 'timeout') {
        invariant(delayedRequestObserved, 'cancellation or timeout occurred before the real request reached the fixture');
      }
    } else {
      if (rejected) throw observedError;
      challenge = inspectResponse(response, data.response, data.statusCode, origin + data.route);
    }
    fixture.assertHealthy();
    invariant(fixture.snapshot().requests === (selected.check === 'request-limit' ? 1 : 2), 'unexpected server request count');
    if (selected.check === 'announced-limit') {
      const state = fixture.snapshot();
      invariant(state.records[1].bodyBytesWritten === 0 && !state.forcedHeaderClose,
        'announced oversized response was not refused before the server supplied any body');
    }
    invariant(transport.active.size === 0 && transport.queue.length === 0, 'transport retained active or queued jobs');
  } catch (error) { failed = true; failure = error; }

  const cleanupErrors = [];
  try { transport?.dispose(); } catch (error) { cleanupErrors.push(error); }
  try { await fixture?.close(); } catch (error) { cleanupErrors.push(error); }
  context.signal?.removeEventListener('abort', outerAbort);
  if (cleanupErrors.length) throw new AggregateError(failed ? [failure, ...cleanupErrors] : cleanupErrors, 'HTTP transport teardown failed');
  if (failed) throw failure;
  context.signal?.throwIfAborted();
  fixture.assertHealthy();
  invariant(transport.closed && transport.active.size === 0 && transport.queue.length === 0, 'transport did not dispose completely');
  const state = fixture.snapshot();
  const proof = {
    profile: 'actual-loopback-http-transport', address: '127.0.0.1', exactOriginGrants: transport.policy.origins.size,
    check: selected.check, variant: selected.variant, calls, control, challenge,
    limits: fixture.limits, ...state, stats: { ...transport.stats }, delayedRequestObserved,
    transportClosed: true, activeJobs: 0, queuedJobs: 0,
  };
  const detail = JSON.stringify(proof);
  invariant(Buffer.byteLength(detail) <= Math.min(context.maxOutputBytes, 2048), 'proof exceeded the output byte budget');
  return { status: 'accepted', code: 'NETWORK_HTTP_TRANSPORT', detail };
}
