import { utf8 } from '@sharpforge/cil';
import { fail, PdbGuids } from './contracts.js';
import { verifySourceAsync } from './source-binding.js';
import { sourceLinkUrl } from './source-link.js';
import { decodeSource } from './source-encoding.js';
import { projectSources } from './source-projection.js';
import { sourceRequest } from './source-request.js';
import { SourceStatus, sourceResult } from './source-status.js';

const hashes = new Map([
  [PdbGuids.sha1, 20],
  [PdbGuids.sha256, 32],
  [PdbGuids.sha384, 48],
  [PdbGuids.sha512, 64],
]);
const statuses = new Set(Object.values(SourceStatus));

function settings(options) {
  if (!options || typeof options !== 'object') fail('Invalid source resolution options');
  const values = {
    maxDocuments: options.maxDocuments ?? 10000,
    maxTotalBytes: options.maxTotalBytes ?? 64 * 1024 * 1024,
    maxBytes: options.maxBytes ?? 16 * 1024 * 1024,
    timeoutMs: options.timeoutMs ?? 30000,
  };
  for (const [key, limit] of [
    ['maxDocuments', 100000],
    ['maxTotalBytes', 256 * 1024 * 1024],
    ['maxBytes', 64 * 1024 * 1024],
    ['timeoutMs', 300000],
  ]) {
    if (!Number.isSafeInteger(values[key]) || values[key] < (key === 'timeoutMs' ? 1 : 0) || values[key] > limit) {
      fail('Invalid source resolution limit: ' + key);
    }
  }
  if (options.fetcher != null && typeof options.fetcher.fetch !== 'function') fail('Invalid source fetcher');
  if (
    options.signal != null &&
    (typeof options.signal.aborted !== 'boolean' ||
      typeof options.signal.addEventListener !== 'function' ||
      typeof options.signal.removeEventListener !== 'function')
  ) {
    fail('Invalid source resolution AbortSignal');
  }
  return values;
}

function supportedHash(document) {
  const size = hashes.get(document.hashAlgorithm);
  return (
    size &&
    document.hash instanceof Uint8Array &&
    document.hash.length === size &&
    (size < 48 || globalThis.crypto?.subtle)
  );
}

function snapshotDocument(document) {
  const snapshot = {};
  for (const key of Object.keys(document)) if (key !== 'embedded') snapshot[key] = document[key];
  if (snapshot.hash instanceof Uint8Array) snapshot.hash = new Uint8Array(snapshot.hash);
  // Keep embedded content lazy until its turn in the resolution order; result records carry verified bytes separately.
  Object.defineProperty(snapshot, 'embedded', { get: () => document.embedded });
  return snapshot;
}

async function checkedSource(document, raw, context) {
  context.operation.check();
  if (!supportedHash(document)) {
    return sourceResult(SourceStatus.unsupportedHash, {
      reason: 'Source checksum algorithm or backend is unsupported',
    });
  }
  if (typeof raw === 'string') {
    if (raw.length > context.limits.maxBytes)
      return sourceResult(SourceStatus.tooLarge, { reason: 'Source exceeds byte limit' });
    raw = utf8(raw);
  }
  if (!(raw instanceof Uint8Array)) fail('Source must be text or bytes');
  if (raw.length > context.limits.maxBytes || raw.length > context.remaining) {
    return sourceResult(SourceStatus.tooLarge, { reason: 'Source resolution byte budget exceeded' });
  }
  context.remaining -= raw.length;
  const bytes = new Uint8Array(raw);
  const expected = { hashAlgorithm: document.hashAlgorithm, hash: new Uint8Array(document.hash) };
  if (!(await context.operation.wait(() => verifySourceAsync(expected, bytes)))) {
    return sourceResult(SourceStatus.mismatch, { reason: 'Source checksum mismatch' });
  }
  let decoded;
  try {
    decoded = decodeSource(bytes, context.decoding);
  } catch (error) {
    return sourceResult(SourceStatus.invalidEncoding, { reason: error.message });
  }
  context.operation.check();
  return sourceResult(SourceStatus.verified, { bytes, ...decoded, reason: 'Checksum verified' });
}

async function linkedSource(symbols, document, context) {
  let url;
  try {
    url = sourceLinkUrl(symbols, document.name, context.options.mapping);
  } catch (error) {
    return sourceResult(SourceStatus.invalidUrl, { reason: error.message });
  }
  if (!url || !context.options.fetcher) return null;
  const fetched = await context.operation.wait(() =>
    context.options.fetcher.fetch(document, url, { signal: context.operation.signal }),
  );
  if (fetched?.verified && fetched.bytes instanceof Uint8Array) {
    const result = await checkedSource(document, fetched.bytes, context);
    return { ...result, url: fetched.url ?? url };
  }
  return sourceResult(
    statuses.has(fetched?.status) && fetched.status !== SourceStatus.verified
      ? fetched.status
      : SourceStatus.networkError,
    { reason: fetched?.reason ?? 'Source fetch did not return verified bytes' },
  );
}

async function resolveDocument(symbols, document, context) {
  const attempts = [];
  let result = sourceResult(SourceStatus.missing, { reason: 'Source not supplied' });
  let provenance = null;
  try {
    if (!supportedHash(document)) {
      return {
        ...document,
        ...sourceResult(SourceStatus.unsupportedHash),
        reason: 'Unsupported source checksum',
        provenance,
        attempts,
        encoding: null,
      };
    }
    for (const origin of ['workspace', 'embedded', 'source-link']) {
      context.operation.check();
      const raw =
        origin === 'workspace' ? context.sources.get(document.name) : origin === 'embedded' ? document.embedded : null;
      const candidate =
        origin === 'source-link'
          ? await linkedSource(symbols, document, context)
          : raw == null
            ? null
            : await checkedSource(document, raw, context);
      if (!candidate) continue;
      result = candidate;
      attempts.push({ provenance: origin, status: result.status, reason: result.reason });
      if (result.verified) {
        provenance = origin;
        break;
      }
    }
  } catch (error) {
    result = sourceResult(error?.sourceStatus ?? SourceStatus.networkError, {
      reason: String(error?.message ?? error),
    });
  }
  return { ...document, ...result, provenance, attempts, encoding: result.encoding ?? null };
}

/** Resolve sources in order: workspace, embedded, explicit Source Link client. Only verified text receives spans. */
export async function resolveSources(symbols, options = {}) {
  const limits = settings(options);
  if (!Array.isArray(symbols?.documents) || symbols.documents.length > limits.maxDocuments)
    fail('Source document limit exceeded');
  const sources = options.sources instanceof Map ? options.sources : new Map(Object.entries(options.sources ?? {}));
  const decoding = { maxBytes: limits.maxBytes, fallbackEncoding: options.fallbackEncoding ?? null };
  decodeSource(new Uint8Array(), decoding);
  const cleanupErrors = [];
  const operation = sourceRequest(options.signal, limits.timeoutMs, (error) => cleanupErrors.push(String(error)));
  const context = { options, limits, sources, decoding, operation, remaining: limits.maxTotalBytes };
  try {
    const documents = [];
    for (const document of symbols.documents) {
      documents.push(await resolveDocument(symbols, snapshotDocument(document), context));
    }
    return { ...projectSources(symbols, documents), cleanupErrors };
  } finally {
    operation.close();
  }
}
