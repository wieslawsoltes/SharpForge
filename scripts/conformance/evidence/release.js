import { destination, digest, LIMITS } from './inventory.js';

const DOWNLOAD_HOSTS = new Set([
  'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com',
]);
const TOTAL_DOWNLOAD_LIMIT = 96 * 1024 * 1024;
const METADATA_LIMIT = 1024 * 1024;

async function boundedBody(response, limit, signal) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel();
    throw new Error('Response size limit exceeded');
  }
  if (!response.body) throw new Error('Missing response body');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Response size limit exceeded');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

async function request(url, options, limit, download = false) {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    const target = new URL(url);
    const allowed = download ? DOWNLOAD_HOSTS.has(target.hostname) : target.hostname === 'api.github.com';
    if (target.protocol !== 'https:' || target.username || target.password || target.port || !allowed) {
      throw new Error('Untrusted evidence download URL');
    }
    const response = await options.fetch(url, {
      signal, redirect: 'manual', headers: { Accept: download ? 'application/octet-stream' : 'application/vnd.github+json' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!download || !location) throw new Error('Unexpected API redirect');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Evidence download failed with HTTP ${response.status}`);
    }
    return boundedBody(response, limit, signal);
  }
  throw new Error('Evidence redirect limit exceeded');
}

async function tagCommit(api, tag, options) {
  const reference = JSON.parse(await request(`${api}/git/ref/tags/${tag}`, options, METADATA_LIMIT));
  let object = reference.object;
  for (let depth = 0; depth < 4 && object?.type === 'tag'; depth++) {
    if (!/^[a-f0-9]{40}$/.test(object.sha)) throw new Error('Invalid annotated tag');
    object = JSON.parse(await request(`${api}/git/tags/${object.sha}`, options, METADATA_LIMIT)).object;
  }
  if (object?.type !== 'commit' || !/^[a-f0-9]{40}$/.test(object.sha)) throw new Error('Tag does not resolve to a commit');
  return object.sha;
}

async function assetInventory(api, releaseId, expected, options) {
  const assets = [];
  for (let page = 1; page <= Math.ceil((LIMITS.maxEntries + 2) / 100) + 1; page++) {
    const url = `${api}/releases/${releaseId}/assets?per_page=100&page=${page}`;
    const batch = JSON.parse(await request(url, options, METADATA_LIMIT));
    if (!Array.isArray(batch) || batch.length > 100) throw new Error('Invalid release asset inventory');
    assets.push(...batch);
    if (assets.length > expected) throw new Error('Release asset inventory differs');
    if (batch.length < 100) {
      if (assets.length !== expected) throw new Error('Release asset inventory differs');
      return assets;
    }
  }
  throw new Error('Release asset page limit exceeded');
}

/** Verify a public prerelease, pinned tag, and every uploaded byte. Never mutates remote releases or assets. */
export async function verifyPublished(stage, supplied = {}) {
  const options = {
    fetch: supplied.fetch ?? globalThis.fetch,
    signal: AbortSignal.any([supplied.signal ?? new AbortController().signal, AbortSignal.timeout(600000)]),
    timeoutMs: supplied.timeoutMs ?? 30000,
  };
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30000) {
    throw new Error('Invalid request timeout');
  }
  const { manifest, payloads } = stage;
  const download = destination(manifest.repository, manifest.tag);
  const api = `https://api.github.com/repos/${manifest.repository}`;
  const release = JSON.parse(await request(`${api}/releases/tags/${manifest.tag}`, options, METADATA_LIMIT));
  if (release.tag_name !== manifest.tag || release.draft !== false || release.prerelease !== true ||
      !Number.isSafeInteger(release.id)) {
    throw new Error('Expected a published archival prerelease with the exact asset inventory');
  }
  if (await tagCommit(api, manifest.tag, options) !== manifest.snapshotCommit) throw new Error('Archival tag source commit differs');
  const assets = await assetInventory(api, release.id, payloads.size, options);
  const byName = new Map(assets.map(asset => [asset.name, asset]));
  if (byName.size !== assets.length) throw new Error('Duplicate release asset names');
  let total = 0;
  const verified = [];
  for (const [name, bytes] of payloads) {
    const asset = byName.get(name);
    const url = `${download}/${name}`;
    if (!asset || asset.state !== 'uploaded' || asset.size !== bytes.length ||
        !Number.isSafeInteger(asset.id) || asset.browser_download_url !== url) throw new Error(`Release asset metadata differs: ${name}`);
    if ((total += bytes.length) > TOTAL_DOWNLOAD_LIMIT) throw new Error('Total download size limit exceeded');
    const expected = digest(bytes);
    if (asset.digest && asset.digest !== `sha256:${expected}`) throw new Error(`Release asset digest differs: ${name}`);
    const actual = await request(url, options, bytes.length, true);
    if (actual.length !== bytes.length || digest(actual) !== expected) throw new Error(`Downloaded asset differs: ${name}`);
    verified.push({ name, id: asset.id, bytes: actual.length, sha256: expected, url });
  }
  return {
    schemaVersion: 1, kind: 'historical-evidence-download-verification',
    snapshotCommit: manifest.snapshotCommit, repository: manifest.repository, tag: manifest.tag,
    releaseId: release.id, verifiedAt: new Date().toISOString(), assets: verified,
  };
}
