import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveSources, createSourceFetcher, PdbGuids, SourceStatus, SymbolError } from '@sharpforge/symbols';

const bytes = new TextEncoder().encode('A\n');
const wrong = new TextEncoder().encode('B\n');
function document(name = '/src/Test.cs', content = bytes, algorithm = 'sha256') {
  return {
    name,
    hash: new Uint8Array(createHash(algorithm).update(content).digest()),
    hashAlgorithm: PdbGuids[algorithm],
  };
}
function symbols(documents = [document()]) {
  return {
    documents,
    scopes: [],
    sourceLink: { documents: { '/src/*': 'https://source.example/*' } },
    methods: [
      {
        token: 0x06000001,
        points: documents.map((_, index) => ({
          document: index + 1,
          startLine: 1,
          endLine: 1,
          startColumn: 1,
          endColumn: 2,
          offset: index,
        })),
      },
    ],
  };
}
function assertUnbound(result, expectedStatus) {
  assert.equal(result.documents[0].status, expectedStatus);
  assert.equal(result.documents[0].verified, false);
  assert.equal(result.documents[0].text, null);
  assert.equal(result.documents[0].bytes, null);
  assert.equal(result.documents[0].provenance, null);
  assert.deepEqual(result.sequencePoints, []);
  assert.deepEqual(result.sources, []);
}

test('verified workspace source wins and lazy embedded data or network are never touched', async () => {
  const doc = document();
  Object.defineProperty(doc, 'embedded', {
    get() {
      assert.fail('embedded source should stay lazy');
    },
  });
  const result = await resolveSources(symbols([doc]), {
    sources: new Map([[doc.name, bytes]]),
    fetcher: {
      fetch() {
        assert.fail('unexpected network');
      },
    },
  });
  assert.equal(result.documents[0].provenance, 'workspace');
  assert.equal(result.documents[0].status, SourceStatus.verified);
  assert.equal(result.documents[0].attempts.length, 1);
  assert.deepEqual(result.sources, [{ uri: doc.name, text: 'A\n', version: 1 }]);
  assert.equal(result.sequencePoints[0].start, 0);
  assert.equal(result.sequencePoints[0].end, 1);
});

test('embedded source is used when workspace source is missing or mismatched', async () => {
  for (const sources of [{}, { '/src/Test.cs': wrong }]) {
    const result = await resolveSources(symbols([{ ...document(), embedded: bytes }]), {
      sources,
      fetcher: {
        fetch() {
          assert.fail('unexpected network');
        },
      },
    });
    assert.equal(result.documents[0].provenance, 'embedded');
    assert(result.sequencePoints[0].sourceVerified);
    if (Object.keys(sources).length) assert.equal(result.documents[0].attempts[0].status, SourceStatus.mismatch);
  }
});

test('SourceLink is explicit, follows both local attempts, and retains permission-gated verified provenance', async () => {
  let requests = 0;
  const client = createSourceFetcher({
    allowedOrigins: ['https://source.example'],
    requestPermission: () => true,
    fetch: async (url) => {
      requests++;
      assert.equal(url, 'https://source.example/Test.cs');
      return new Response(bytes);
    },
  });
  const result = await resolveSources(symbols([{ ...document(), embedded: wrong }]), {
    sources: { '/src/Test.cs': wrong },
    fetcher: client,
  });
  assert.equal(requests, 1);
  assert.equal(result.documents[0].provenance, 'source-link');
  assert.deepEqual(
    result.documents[0].attempts.map((attempt) => attempt.status),
    [SourceStatus.mismatch, SourceStatus.mismatch, SourceStatus.verified],
  );
  assert.equal(result.sequencePoints.length, 1);
  client.dispose();
});

for (const provenance of ['workspace', 'embedded', 'source-link']) {
  test('unverified ' + provenance + ' text never receives sequence points', async () => {
    const doc = document();
    const options = {};
    if (provenance === 'workspace') options.sources = { [doc.name]: wrong };
    if (provenance === 'embedded') doc.embedded = wrong;
    if (provenance === 'source-link')
      options.fetcher = {
        async fetch() {
          return { verified: true, bytes: wrong, text: 'forged source text', status: SourceStatus.verified };
        },
      };
    const result = await resolveSources(symbols([doc]), options);
    assertUnbound(result, SourceStatus.mismatch);
    assert.equal(result.documents[0].attempts.at(-1).provenance, provenance);
  });
}

test('missing sources and denied source fetches do not create debugger spans', async () => {
  assertUnbound(await resolveSources(symbols()), SourceStatus.missing);
  const result = await resolveSources(symbols(), {
    fetcher: {
      async fetch() {
        return { status: SourceStatus.denied, verified: false, text: 'must be discarded', bytes };
      },
    },
  });
  assertUnbound(result, SourceStatus.denied);
});

test('raw BOM checksums and explicit fallback encodings precede source projection', async () => {
  for (const [raw, options] of [
    [new Uint8Array([255, 254, 65, 0]), {}],
    [new Uint8Array([233]), { fallbackEncoding: 'windows-1252' }],
  ]) {
    const doc = { ...document('/src/Test.cs', raw), embedded: raw };
    const result = await resolveSources(symbols([doc]), options);
    assert.equal(result.documents[0].verified, true);
    assert.equal(result.documents[0].provenance, 'embedded');
    assert.equal(result.sequencePoints[0].end, 1);
  }
  const raw = new Uint8Array([233]);
  assertUnbound(
    await resolveSources(symbols([{ ...document('/src/Test.cs', raw), embedded: raw }])),
    SourceStatus.invalidEncoding,
  );
});

test('all supported raw checksum algorithms resolve locally; unknown hashes never request source', async () => {
  for (const algorithm of ['sha1', 'sha256', 'sha384', 'sha512']) {
    const result = await resolveSources(symbols([{ ...document('/src/Test.cs', bytes, algorithm), embedded: bytes }]));
    assert.equal(result.documents[0].verified, true, algorithm);
  }
  const doc = { ...document(), hashAlgorithm: 'unknown' };
  assertUnbound(
    await resolveSources(symbols([doc]), {
      fetcher: {
        fetch() {
          assert.fail('unsupported hash request');
        },
      },
    }),
    SourceStatus.unsupportedHash,
  );
});

test('byte and document limits accept exact boundaries and reject excess deterministically', async () => {
  const first = { ...document('/src/First.cs'), embedded: bytes };
  const second = { ...document('/src/Second.cs'), embedded: bytes };
  const result = await resolveSources(symbols([first, second]), {
    maxTotalBytes: bytes.length,
    maxBytes: bytes.length,
  });
  assert.equal(result.documents[0].verified, true);
  assert.equal(result.documents[1].status, SourceStatus.tooLarge);
  assert.equal(result.sequencePoints.length, 1);
  assertUnbound(await resolveSources(symbols([first]), { maxBytes: bytes.length - 1 }), SourceStatus.tooLarge);
  await assert.rejects(resolveSources(symbols(), { maxDocuments: 0 }), SymbolError);
  assert.deepEqual((await resolveSources(symbols([]), { maxDocuments: 0, maxTotalBytes: 0 })).documents, []);
});

test('cancellation and deadlines settle an uncooperative host fetch', async () => {
  const controller = new AbortController();
  const promise = resolveSources(symbols(), {
    signal: controller.signal,
    fetcher: {
      fetch() {
        controller.abort();
        return new Promise(() => {});
      },
    },
  });
  assertUnbound(await promise, SourceStatus.cancelled);
  assertUnbound(
    await resolveSources(symbols(), { timeoutMs: 10, fetcher: { fetch: () => new Promise(() => {}) } }),
    SourceStatus.timeout,
  );
  const aborted = new AbortController();
  aborted.abort();
  assertUnbound(
    await resolveSources(symbols(), {
      signal: aborted.signal,
      fetcher: {
        fetch() {
          assert.fail('cancelled');
        },
      },
    }),
    SourceStatus.cancelled,
  );
});

test('invalid options and malformed SourceLink maps fail explicitly without source attachment', async () => {
  for (const options of [
    null,
    { maxBytes: -1 },
    { timeoutMs: 0 },
    { maxTotalBytes: Infinity },
    { fetcher: {} },
    { signal: {} },
    { fallbackEncoding: 'nonexistent' },
  ]) {
    await assert.rejects(resolveSources(symbols(), options), SymbolError);
  }
  const value = symbols();
  value.sourceLink.documents = { '/src/*': 'http://insecure.example/*' };
  assertUnbound(
    await resolveSources(value, {
      fetcher: {
        fetch() {
          assert.fail('unsafe URL request');
        },
      },
    }),
    SourceStatus.invalidUrl,
  );
});
