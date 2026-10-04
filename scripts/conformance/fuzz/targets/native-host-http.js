import { request } from 'node:http';
import { resolve } from 'node:path';
import { nativeHostRequest } from './native-host-input.js';

export const nativeHostLimits = Object.freeze({
  requests: 2, requestBytes: 1024, responseBytes: 4096, responseHeaderBytes: 4096, requestTimeoutMs: 400,
});

function limitFailure(message) {
  const error = new Error(message);
  error.name = 'NativeHostLimitError';
  return error;
}

/** Connect only to the actual owned IPv4 listener, with no redirects, agent pool or caller-controlled transport. */
export function nativeHostClient(host, { maxOutputBytes, signal }) {
  const address = host.server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1'
    || !Number.isInteger(address.port) || address.port < 1 || address.port > 65535
    || host.origin !== `http://127.0.0.1:${address.port}`) throw new Error('Native fixture has no owned loopback listener');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new RangeError('Invalid native response limit');
  const maximum = Math.min(nativeHostLimits.responseBytes, maxOutputBytes);
  const active = new Map();
  let requests = 0;
  let bytes = 0;

  async function read(plan) {
    signal?.throwIfAborted();
    if (++requests > nativeHostLimits.requests) throw limitFailure('Native fixture request count exceeded');
    const specification = nativeHostRequest(plan, host.origin, resolve(host.workspace.root, '..', 'Outside.txt'));
    const requestBytes = Buffer.byteLength(specification.path) + 64
      + Object.entries(specification.headers).reduce((sum, [key, value]) => sum + Buffer.byteLength(key + ': ' + value) + 2, 0);
    if (requestBytes > nativeHostLimits.requestBytes) throw limitFailure('Native fixture request bytes exceeded');
    return new Promise((resolve, reject) => {
      let outgoing, timer, result, failure, failed = false;
      const chunks = [];
      let responseBytes = 0;
      const fail = error => {
        if (!failed) { failure = error; failed = true; }
        outgoing?.destroy();
      };
      const abort = () => fail(signal.reason);
      try {
        outgoing = request({
          hostname: '127.0.0.1', family: 4, port: address.port, method: 'GET', path: specification.path,
          headers: specification.headers, agent: false, maxHeaderSize: nativeHostLimits.responseHeaderBytes,
        }, response => {
          response.on('data', chunk => {
            responseBytes += chunk.length;
            bytes += chunk.length;
            if (bytes > maximum) { fail(limitFailure('Native fixture response bytes exceeded')); return; }
            chunks.push(chunk);
          });
          response.once('error', fail);
          response.once('aborted', () => fail(new Error('Native fixture response was aborted')));
          response.once('end', () => {
            if (!response.complete) { fail(new Error('Native fixture response was incomplete')); return; }
            result = { ...specification, statusCode: response.statusCode, responseBytes,
              body: Buffer.concat(chunks).toString('utf8') };
          });
        });
      } catch (error) { reject(error); return; }
      let closed;
      const completion = new Promise(resolveClose => { closed = resolveClose; });
      active.set(outgoing, completion);
      timer = setTimeout(() => fail(limitFailure('Native fixture request exceeded its deadline')), nativeHostLimits.requestTimeoutMs);
      outgoing.once('error', fail);
      outgoing.once('close', () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        active.delete(outgoing);
        closed();
        if (failed) reject(failure);
        else if (!result) reject(new Error('Native fixture connection closed without a complete response'));
        else resolve(result);
      });
      signal?.addEventListener('abort', abort, { once: true });
      outgoing.end();
      if (signal?.aborted) abort();
    });
  }

  return {
    read,
    get requests() { return requests; },
    get responseBytes() { return bytes; },
    get pending() { return active.size; },
    async dispose() {
      const pending = [...active.values()];
      for (const outgoing of active.keys()) outgoing.destroy();
      await Promise.all(pending);
    },
  };
}
