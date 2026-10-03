import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ComputePool } from '../../../packages/compute/src/index.js';
import {
  HttpTransport,
  WebSocketClient,
} from '../../../packages/network/src/index.js';
import { isMain } from '../repro/common.js';

/** Owned loopback endpoint for actual network traffic; fixed, small echo messages only. */
export async function endpoint() {
  const sockets = new Set(),
    requests = [];
  const server = createServer((request, response) => {
    requests.push({
      path: request.url,
      cookiePresent: !!request.headers.cookie,
    });
    const respond = () => {
      if (!response.destroyed) response.end('release15');
    };
    if (request.url === '/slow') {
      const timer = setTimeout(respond, 1000);
      response.once('close', () => clearTimeout(timer));
    } else respond();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  });
  server.on('upgrade', (request, socket) => {
    const key = request.headers['sec-websocket-key'];
    if (request.url !== '/echo' || typeof key !== 'string')
      return socket.destroy();
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
        accept +
        '\r\n\r\n',
    );
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 512) return socket.destroy();
      if (buffer.length < 6) return;
      const size = buffer[1] & 127,
        opcode = buffer[0] & 15;
      if (
        !(buffer[0] & 128) ||
        !(buffer[1] & 128) ||
        size > 120 ||
        ![1, 8].includes(opcode)
      )
        return socket.destroy();
      if (buffer.length < 6 + size) return;
      const bytes = Buffer.from(buffer.subarray(6, 6 + size));
      for (let index = 0; index < bytes.length; index++)
        bytes[index] ^= buffer[2 + (index % 4)];
      buffer = buffer.subarray(6 + size);
      socket.write(Buffer.concat([Buffer.from([128 | opcode, size]), bytes]));
      if (opcode === 8) socket.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: 'http://127.0.0.1:' + server.address().port,
    requests,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  };
}

/** Component concurrency/cancellation evidence, deliberately not cross-app fairness. */
export async function localIO() {
  const host = await endpoint(),
    wsOrigin = host.origin.replace('http:', 'ws:');
  const pool = new ComputePool({ workers: 2, backend: 'auto' });
  const http = new HttpTransport({ allowedOrigins: [host.origin] });
  const socket = new WebSocketClient({ allowedOrigins: [wsOrigin] });
  const events = [],
    start = performance.now();
  const observed = async (name, promise) => {
    events.push({
      name,
      event: 'submitted',
      milliseconds: performance.now() - start,
    });
    const value = await promise;
    events.push({
      name,
      event: 'completed',
      milliseconds: performance.now() - start,
    });
    return value;
  };
  try {
    await pool.init();
    await socket.connect(wsOrigin + '/echo');
    socket.send('release15');
    const [large, small, response, echo] = await Promise.all([
      observed(
        'large',
        pool.execute('sum', new Float64Array(400000).fill(0.5)),
      ),
      observed('small', pool.execute('sum', new Float64Array([42]))),
      observed('http', http.request(host.origin + '/data')),
      observed('websocket', socket.receive()),
    ]);
    assert.equal(large, 200000);
    assert.equal(small, 42);
    assert.equal(response.text, 'release15');
    assert.equal(echo, 'release15');
    const abort = new AbortController();
    const pending = http.request(host.origin + '/slow', {
      signal: abort.signal,
    });
    const rejection = assert.rejects(
      pending,
      (error) => error.name === 'AbortError',
    );
    const deadline = Date.now() + 5000;
    while (!host.requests.some((row) => row.path === '/slow')) {
      if (Date.now() > deadline)
        throw new Error(
          'HTTP cancellation request never reached the actual endpoint',
        );
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    abort.abort();
    await rejection;
    const receiveAbort = new AbortController();
    const receive = assert.rejects(
      socket.receive({ signal: receiveAbort.signal }),
      (error) => error.name === 'AbortError',
    );
    receiveAbort.abort();
    await receive;
    const computeAbort = new AbortController();
    computeAbort.abort();
    await assert.rejects(
      pool.execute('sum', new Float64Array([1]), null, {
        signal: computeAbort.signal,
      }),
      /cancel|abort/i,
    );
    assert.equal(await pool.execute('sum', new Float64Array([7])), 7);
    assert.equal(
      (await http.request(host.origin + '/after-cancel')).text,
      'release15',
    );
    socket.send('still-live');
    assert.equal(await socket.receive(), 'still-live');
    http.dispose();
    await assert.rejects(
      http.request(host.origin + '/disposed'),
      (error) => error.code === 'DISPOSED',
    );
    await assert.rejects(
      new HttpTransport().request(host.origin + '/denied'),
      (error) => error.code === 'DENIED',
    );
    assert(host.requests.every((row) => !row.cookiePresent));
    return {
      scope:
        'Actual Node workers and local sockets, no Studio session isolation claim',
      events,
      compute: await pool.capabilities(),
      http: http.stats,
      requests: host.requests,
      cancellation: {
        http: true,
        websocketReceive: true,
        preAbortedCompute: true,
      },
      sessionFairness: 'blocked: SF-R015-T02',
      sessionRevocation: 'blocked: SF-A12-T10',
    };
  } finally {
    pool.dispose();
    http.dispose();
    socket.close();
    await host.close();
  }
}
if (isMain(import.meta.url)) console.log(JSON.stringify(await localIO()));
