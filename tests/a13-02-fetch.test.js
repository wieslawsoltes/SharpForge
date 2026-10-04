import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSourceFetcher, SourceStatus, PdbGuids, SymbolError } from '@sharpforge/symbols';

const url = 'https://source.example/source.cs';
const bytes = new TextEncoder().encode('café\r\n');
const documentFor = (content = bytes, name = 'sha256') => ({
  name: '/src/source.cs',
  hashAlgorithm: PdbGuids[name],
  hash: new Uint8Array(createHash(name).update(content).digest()),
});
const document = documentFor();
const client = (options) =>
  createSourceFetcher({
    allowedOrigins: ['https://source.example'],
    requestPermission: async () => true,
    fetch: async () => new Response(bytes),
    ...options,
  });

test('construction and denied permission perform no network request', async () => {
  let requests = 0;
  const service = client({
    requestPermission: () => false,
    fetch: () => {
      requests++;
      throw Error('unexpected');
    },
  });
  assert.equal(requests, 0);
  assert.equal((await service.fetch(document, url)).status, SourceStatus.denied);
  assert.equal(requests, 0);
  const excluded = client({
    allowedOrigins: [],
    requestPermission: () => {
      throw Error('unexpected permission prompt');
    },
  });
  assert.equal((await excluded.fetch(document, url)).status, SourceStatus.denied);
});

for (const algorithm of ['sha1', 'sha256', 'sha384', 'sha512'])
  test('source fetch verifies exact bytes: ' + algorithm, async () => {
    const grants = [];
    const service = client({
      maxBytes: bytes.length,
      requestPermission: (request) => {
        grants.push(request);
        return true;
      },
      fetch: async (address, options) => {
        assert.equal(address, url);
        assert.equal(options.credentials, 'omit');
        assert.equal(options.redirect, 'manual');
        assert.equal(options.referrerPolicy, 'no-referrer');
        assert.equal(options.cache, 'no-store');
        assert.equal(options.headers, undefined);
        return new Response(bytes);
      },
    });
    const result = await service.fetch(documentFor(bytes, algorithm), url);
    assert.equal(result.status, SourceStatus.verified);
    assert.equal(result.verified, true);
    assert.equal(result.text, 'café\r\n');
    assert.deepEqual(result.bytes, bytes);
    assert.equal(result.provenance, 'source-link');
    assert.equal(grants.length, 1);
    assert.equal(grants[0].origin, 'https://source.example');
    assert.equal(grants[0].purpose, 'source-link');
  });

test('mismatched bytes and unsupported hashes are discarded without trusted text', async () => {
  const mismatch = await client({ fetch: async () => new Response('different') }).fetch(document, url);
  assert.equal(mismatch.status, SourceStatus.mismatch);
  assert.equal(mismatch.text, null);
  assert.equal(mismatch.bytes, null);
  let calls = 0;
  const unsupported = await client({
    fetch: () => {
      calls++;
    },
  }).fetch({ ...document, hashAlgorithm: 'unknown' }, url);
  assert.equal(unsupported.status, SourceStatus.unsupportedHash);
  assert.equal(calls, 0);
});

test('verified bytes still require a valid encoding or explicit fallback', async () => {
  const content = new Uint8Array([99, 97, 102, 233]);
  const options = { fetch: async () => new Response(content) };
  assert.equal((await client(options).fetch(documentFor(content), url)).status, SourceStatus.invalidEncoding);
  const result = await client({ ...options, fallbackEncoding: 'windows-1252' }).fetch(documentFor(content), url);
  assert.equal(result.text, 'café');
  assert.equal(result.encoding, 'windows-1252');
});

test('each redirect requires a fresh allowed-origin grant before a request', async () => {
  const requested = [];
  const granted = [];
  const service = client({
    allowedOrigins: ['https://source.example', 'https://cdn.example'],
    requestPermission: (request) => {
      granted.push(request.origin);
      return true;
    },
    fetch: async (address) => {
      requested.push(address);
      return requested.length === 1
        ? new Response(null, { status: 302, headers: { location: 'https://cdn.example/source.cs' } })
        : new Response(bytes);
    },
  });
  const result = await service.fetch(document, url);
  assert.equal(result.status, SourceStatus.verified);
  assert.equal(result.url, 'https://cdn.example/source.cs');
  assert.deepEqual(granted, ['https://source.example', 'https://cdn.example']);
  assert.equal(requested.length, 2);
  let requests = 0;
  const denied = client({
    fetch: async () => {
      requests++;
      return new Response(null, { status: 302, headers: { location: 'https://outside.example/source.cs' } });
    },
  });
  assert.equal((await denied.fetch(document, url)).status, SourceStatus.denied);
  assert.equal(requests, 1);
});

test('redirect loops, hidden redirects, unsafe URLs and HTTP failures are explicit statuses', async () => {
  let requests = 0;
  const loop = client({
    maxRedirects: 1,
    fetch: async () => {
      requests++;
      return new Response(null, { status: 302, headers: { location: '/again' } });
    },
  });
  assert.equal((await loop.fetch(document, url)).status, SourceStatus.denied);
  assert.equal(requests, 2);
  assert.equal(
    (await client({ fetch: async () => ({ redirected: true }) }).fetch(document, url)).status,
    SourceStatus.denied,
  );
  assert.equal(
    (await client({ fetch: async () => ({ type: 'opaqueredirect' }) }).fetch(document, url)).status,
    SourceStatus.denied,
  );
  assert.equal((await client().fetch(document, 'http://source.example/a')).status, SourceStatus.invalidUrl);
  assert.equal(
    (await client().fetch(document, 'https://user:password@source.example/a')).status,
    SourceStatus.invalidUrl,
  );
  assert.equal(
    (await client({ fetch: async () => new Response(null, { status: 404 }) }).fetch(document, url)).status,
    SourceStatus.httpError,
  );
});

test('declared and streamed byte limits reject limit+1 and cancel response bodies', async () => {
  let cancelled = 0;
  const stream = () =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
      },
      cancel() {
        cancelled++;
      },
    });
  const declared = client({
    maxBytes: bytes.length - 1,
    fetch: async () => new Response(stream(), { headers: { 'content-length': String(bytes.length) } }),
  });
  assert.equal((await declared.fetch(document, url)).status, SourceStatus.tooLarge);
  const streamed = client({ maxBytes: bytes.length - 1, fetch: async () => new Response(stream()) });
  assert.equal((await streamed.fetch(document, url)).status, SourceStatus.tooLarge);
  assert.equal(cancelled, 2);
  assert.equal(
    (await client({ maxBytes: 0, fetch: async () => new Response(null) }).fetch(documentFor(new Uint8Array()), url))
      .status,
    SourceStatus.verified,
  );
});

test('cancellation and disposal interrupt even transports that ignore AbortSignal', async () => {
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const service = client({
    fetch: () => {
      entered();
      return new Promise(() => {});
    },
  });
  const controller = new AbortController();
  const pending = service.fetch(document, url, { signal: controller.signal });
  await started;
  controller.abort();
  assert.equal((await pending).status, SourceStatus.cancelled);
  const disposing = client({ requestPermission: () => new Promise(() => {}) });
  const active = disposing.fetch(document, url);
  disposing.dispose();
  assert.equal((await active).status, SourceStatus.disposed);
  assert.equal((await disposing.fetch(document, url)).status, SourceStatus.disposed);
});

test('timeout includes permission waits and stream reads', async () => {
  const permission = client({ timeoutMs: 10, requestPermission: () => new Promise(() => {}) });
  assert.equal((await permission.fetch(document, url)).status, SourceStatus.timeout);
  const body = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
  });
  const streaming = client({ timeoutMs: 10, fetch: async () => new Response(body) });
  assert.equal((await streaming.fetch(document, url)).status, SourceStatus.timeout);
});

test('a response arriving after cancellation has its body cancelled', async () => {
  let entered;
  let complete;
  let cancelled = 0;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const service = client({
    fetch() {
      entered();
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
  });
  const controller = new AbortController();
  const pending = service.fetch(document, url, { signal: controller.signal });
  await started;
  controller.abort();
  assert.equal((await pending).status, SourceStatus.cancelled);
  complete(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1);
});

test('concurrency is bounded and cleanup failures remain observable', async () => {
  let release;
  const permission = new Promise((resolve) => {
    release = resolve;
  });
  const service = client({ maxConcurrent: 1, requestPermission: () => permission });
  const first = service.fetch(document, url);
  assert.equal((await service.fetch(document, url)).status, SourceStatus.busy);
  release(true);
  assert.equal((await first).status, SourceStatus.verified);
  const cleanup = client({
    maxBytes: 0,
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
          },
          cancel() {
            throw Error('cleanup failed');
          },
        }),
      ),
  });
  assert.equal((await cleanup.fetch(document, url)).status, SourceStatus.tooLarge);
  await Promise.resolve();
  assert.deepEqual(cleanup.cleanupErrors, ['cleanup failed']);
});

test('invalid transport options fail before source requests', () => {
  for (const options of [
    {},
    { fetch: () => {}, requestPermission: () => true },
    { fetch: () => {}, requestPermission: () => true, allowedOrigins: ['https://source.example/path'] },
  ]) {
    assert.throws(() => createSourceFetcher(options), SymbolError);
  }
  for (const options of [{ maxBytes: -1 }, { timeoutMs: 0 }, { maxConcurrent: 0 }, { maxRedirects: 9 }]) {
    assert.throws(() => client(options), SymbolError);
  }
});

test('already cancelled requests never ask permission or fetch', async () => {
  const signal = AbortSignal.abort();
  const service = client({
    requestPermission: () => {
      throw Error('must not ask');
    },
    fetch: () => {
      throw Error('must not fetch');
    },
  });
  assert.equal((await service.fetch(document, url, { signal })).status, SourceStatus.cancelled);
});

test('empty stream chunks have an independent work limit', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array());
    },
    cancel() {
      cancelled = true;
    },
  });
  const service = client({ timeoutMs: 30000, maxBytes: 0, fetch: async () => new Response(body) });
  const result = await service.fetch(documentFor(new Uint8Array()), url);
  assert.equal(result.status, SourceStatus.tooLarge);
  assert.match(result.reason, /chunk limit/);
  assert(cancelled);
});

test('hosts without WebCrypto use portable SHA-1/256 and reject SHA-384/512 before I/O', async () => {
  const cryptoProperty = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try {
    for (const algorithm of ['sha1', 'sha256']) {
      assert.equal((await client().fetch(documentFor(bytes, algorithm), url)).status, SourceStatus.verified);
    }
    for (const algorithm of ['sha384', 'sha512']) {
      const service = client({
        fetch() {
          assert.fail('unsupported backend should not fetch');
        },
      });
      assert.equal((await service.fetch(documentFor(bytes, algorithm), url)).status, SourceStatus.unsupportedHash);
    }
  } finally {
    if (cryptoProperty) Object.defineProperty(globalThis, 'crypto', cryptoProperty);
    else delete globalThis.crypto;
  }
});
