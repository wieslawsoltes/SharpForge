import { createServer } from 'node:http';
import { httpTransportData, httpTransportEffectiveLimits, httpTransportPlan } from './http-transport-input.js';

function invariant(condition, message) {
  if (!condition) throw new Error('HTTP fixture invariant: ' + message);
}

/** A tiny owned server: two fixed routes per case, no input-derived authority and no native process or filesystem access. */
export async function startHttpTransportFixture(plan, context, onDelayedRequest) {
  const selected = httpTransportPlan({ operation: 'http-transport', ...plan });
  const limits = httpTransportEffectiveLimits(context);
  const data = httpTransportData(selected, limits);
  const sockets = new Set(), timers = new Set(), records = [], failures = [];
  let stopping = false, connections = 0, requestBytes = 0, bodyBytesWritten = 0, forcedHeaderClose = false;
  const remember = error => { if (failures.length === 0) failures.push(error); };
  const disconnectExpected = error => ['cancel', 'timeout', 'announced-limit', 'stream-limit'].includes(data.check)
    && ['ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE'].includes(error?.code);
  const transportError = error => { if (!stopping && !disconnectExpected(error)) remember(error); };
  const later = (delay, action) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (stopping) return;
      try { action(); } catch (error) { remember(error); }
    }, delay);
    timers.add(timer);
  };

  function write(response, record, bytes, end = false) {
    invariant(!stopping && !response.destroyed, 'response was written after its connection closed');
    bodyBytesWritten += bytes.byteLength;
    invariant(bodyBytesWritten <= data.control.byteLength + limits.responseBytes + 1, 'outgoing body budget exceeded');
    record.bodyBytesWritten += bytes.byteLength;
    if (end) response.end(bytes); else response.write(bytes);
  }

  function reply(response, record, control) {
    const body = control ? data.control : data.response;
    const status = control ? 200 : data.statusCode;
    const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'X-SharpForge-Fixture': 'bounded-http',
      'Set-Cookie': 'sharpforge-public-fixture=discard', Connection: 'close' };
    const streaming = !control && ['response-stream', 'stream-limit'].includes(data.check);
    if (!streaming) headers['Content-Length'] = body.byteLength;
    record.statusCode = status;
    response.writeHead(status, headers);
    if (!control && data.check === 'announced-limit') {
      response.flushHeaders();
      later(limits.headerOnlyTimeoutMs, () => {
        if (!response.destroyed) { forcedHeaderClose = true; response.destroy(); }
      });
    } else if (streaming) {
      // The first UTF-8 byte of the positive Unicode fixture is deliberately split from its continuation.
      const split = data.check === 'response-stream' ? 1 : Math.min(16, limits.responseBytes);
      write(response, record, body.subarray(0, split));
      later(limits.streamDelayMs, () => {
        if (!response.destroyed) write(response, record, body.subarray(split), true);
      });
    } else write(response, record, body, true);
  }

  function handle(request, response) {
    if (stopping) { request.destroy(); return; }
    const ordinal = records.length + 1;
    if (ordinal > limits.requests) {
      remember(new Error('HTTP fixture request count exceeded'));
      request.destroy(); response.destroy(); return;
    }
    const control = ordinal === 1;
    const record = { method: request.method, route: request.url, requestBytes: 0, statusCode: null, bodyBytesWritten: 0 };
    records.push(record);
    const fail = error => { remember(error); request.destroy(); response.destroy(); };
    request.on('error', transportError);
    response.on('error', transportError);
    try {
      invariant(request.method === (control ? 'GET' : data.method) && request.url === (control ? '/control' : data.route),
        'a method or route outside the fixed sequence was requested');
      const headerBytes = request.rawHeaders.reduce((total, value) => total + Buffer.byteLength(value) + 2, 0);
      invariant(headerBytes <= limits.requestHeaderBytes, 'request headers exceeded their byte budget');
    } catch (error) { fail(error); return; }
    const chunks = [];
    request.on('data', chunk => {
      requestBytes += chunk.byteLength;
      record.requestBytes += chunk.byteLength;
      if (requestBytes > limits.requestBytes) { fail(new Error('HTTP fixture incoming body budget exceeded')); return; }
      chunks.push(chunk);
    });
    request.once('end', () => {
      try {
        const actual = Buffer.concat(chunks);
        const expected = control || data.method === 'GET' ? Buffer.alloc(0) : data.request;
        invariant(actual.equals(expected), 'the fixed request body did not round-trip');
        if (!control && ['cancel', 'timeout'].includes(data.check)) {
          later(limits.delayedResponseMs, () => { if (!response.destroyed) reply(response, record, false); });
          onDelayedRequest?.();
        } else reply(response, record, control);
      } catch (error) { fail(error); }
    });
  }

  const server = createServer({ maxHeaderSize: limits.requestHeaderBytes }, handle);
  server.on('error', remember);
  server.on('clientError', (error, socket) => { transportError(error); socket.destroy(); });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', transportError);
    if (stopping || ++connections > limits.connections) {
      if (!stopping) remember(new Error('HTTP fixture connection budget exceeded'));
      socket.destroy();
    }
  });
  server.requestTimeout = limits.requestTimeoutMs;
  server.headersTimeout = limits.requestTimeoutMs;
  server.keepAliveTimeout = 1;

  async function close() {
    stopping = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    const socketClosures = [...sockets].map(socket => new Promise(resolve => socket.once('close', resolve)));
    const closed = server.listening ? new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }) : Promise.resolve();
    server.closeAllConnections();
    for (const socket of sockets) socket.destroy();
    await Promise.all([closed, ...socketClosures]);
    invariant(!server.listening && sockets.size === 0 && timers.size === 0, 'owned resources did not close');
  }

  let address;
  try {
    context.signal?.throwIfAborted();
    await new Promise((resolve, reject) => {
      const fail = error => { server.off('listening', ready); reject(error); };
      const ready = () => { server.off('error', fail); resolve(); };
      server.once('error', fail);
      server.once('listening', ready);
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true });
    });
    context.signal?.throwIfAborted();
    address = server.address();
    invariant(address && typeof address !== 'string' && address.address === '127.0.0.1'
      && Number.isInteger(address.port) && address.port > 0 && address.port <= 65535, 'listener is not owned IPv4 loopback');
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'HTTP fixture startup teardown failed'); }
    throw error;
  }

  return {
    origin: `http://127.0.0.1:${address.port}`, limits, data, close,
    assertHealthy() { if (failures.length) throw failures[0]; },
    snapshot() {
      return { requests: records.length, requestBytes, bodyBytesWritten, records: records.map(value => ({ ...value })),
        forcedHeaderClose, connections, serverClosed: !server.listening, openSockets: sockets.size, pendingTimers: timers.size };
    },
  };
}
