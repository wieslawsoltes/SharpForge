import { fail } from './contracts.js';
import { SourceStatus, sourceFailure, sourceResult, httpsUrl } from './source-status.js';
import { sourceRequest, sourceResponseBytes } from './source-request.js';

function integer(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail('Invalid source ' + name);
  return value;
}

function settingsFor(options) {
  if (!options || typeof options !== 'object') fail('Invalid source fetch options');
  if (typeof options.fetch !== 'function' || typeof options.requestPermission !== 'function') {
    fail('Source fetch requires injected fetch and requestPermission functions');
  }
  if (!Array.isArray(options.allowedOrigins)) fail('Source fetch requires an origin allowlist');
  const origins = new Set(
    options.allowedOrigins.map((value) => {
      const url = httpsUrl(value);
      if (url.pathname !== '/' || url.search || url.hash) fail('Origin allowlist entries must be origins');
      return url.origin;
    }),
  );
  return {
    origins,
    fetch: options.fetch,
    requestPermission: options.requestPermission,
    maxBytes: integer(options.maxBytes ?? 16 * 1024 * 1024, 'byte limit', 0, 64 * 1024 * 1024),
    timeoutMs: integer(options.timeoutMs ?? 15000, 'timeout', 1, 300000),
    maxRedirects: integer(options.maxRedirects ?? 3, 'redirect limit', 0, 8),
    maxConcurrent: integer(options.maxConcurrent ?? 4, 'concurrency limit', 1, 16),
  };
}

async function requestResponse(settings, input, operation, purpose) {
  let url = httpsUrl(input);
  for (let redirects = 0; ; redirects++) {
    operation.check();
    if (!settings.origins.has(url.origin)) throw sourceFailure(SourceStatus.denied, 'Source origin is not allowed');
    const granted = await operation.wait(() =>
      settings.requestPermission({
        origin: url.origin,
        url: url.href,
        purpose,
        signal: operation.signal,
      }),
    );
    if (granted !== true) throw sourceFailure(SourceStatus.denied, 'Source origin permission denied');
    operation.check();
    const response = await operation.wait(
      () =>
        settings.fetch(url.href, {
          method: 'GET',
          credentials: 'omit',
          redirect: 'manual',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          mode: 'cors',
          signal: operation.signal,
        }),
      (lateResponse) => operation.cancelBody(lateResponse?.body),
    );
    if (response.redirected || response.type === 'opaqueredirect') {
      operation.cancelBody(response.body);
      throw sourceFailure(SourceStatus.denied, 'Transport hid or followed an unapproved redirect');
    }
    if (response.status >= 300 && response.status < 400) {
      operation.cancelBody(response.body);
      if (redirects >= settings.maxRedirects)
        throw sourceFailure(SourceStatus.denied, 'Source redirect limit exceeded');
      const location = response.headers.get('location');
      if (!location) throw sourceFailure(SourceStatus.invalidUrl, 'Source redirect lacks a Location');
      url = httpsUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      operation.cancelBody(response.body);
      throw sourceFailure(SourceStatus.httpError, 'Source server returned HTTP ' + response.status);
    }
    return { response, url: url.href };
  }
}

/** Private shared transport: every request and redirect needs an explicit origin grant. */
export function createPermissionedFetcher(options) {
  const settings = settingsFor(options);
  const active = new Set();
  const cleanupErrors = [];
  const reportCleanupError = (error) => {
    cleanupErrors.push(String(error?.message ?? error).slice(0, 256));
    if (cleanupErrors.length > 16) cleanupErrors.shift();
  };
  let disposed = false;
  return {
    async read(url, { signal, purpose, validate }) {
      if (
        signal != null &&
        (typeof signal.aborted !== 'boolean' ||
          typeof signal.addEventListener !== 'function' ||
          typeof signal.removeEventListener !== 'function')
      )
        fail('Invalid source abort signal');
      if (disposed) return sourceResult(SourceStatus.disposed, { reason: 'Source client disposed' });
      if (active.size >= settings.maxConcurrent)
        return sourceResult(SourceStatus.busy, { reason: 'Source concurrency limit reached' });
      const operation = sourceRequest(signal, settings.timeoutMs, reportCleanupError);
      active.add(operation);
      try {
        const final = await requestResponse(settings, url, operation, purpose);
        const bytes = await sourceResponseBytes(final.response, operation, settings.maxBytes);
        const value = await operation.wait(() => validate(bytes));
        operation.check();
        return sourceResult(SourceStatus.verified, { ...value, bytes, url: final.url });
      } catch (error) {
        return sourceResult(error?.sourceStatus ?? SourceStatus.networkError, {
          reason: String(error?.message ?? error),
        });
      } finally {
        operation.close();
        active.delete(operation);
      }
    },
    dispose() {
      disposed = true;
      for (const operation of active) operation.abort();
    },
    get cleanupErrors() {
      return [...cleanupErrors];
    },
  };
}
