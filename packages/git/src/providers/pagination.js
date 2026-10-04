import { GitError, checkLimit } from '../errors.js';

/** Parse only rel=next links. The client revalidates origin and repository scope before following. */
export function nextPageUrl(response, currentUrl) {
  const link = response.headers.get('link');
  if (link) {
    checkLimit(link.length, 16384, 'Pagination Link header');
    for (const part of link.split(/,(?=\s*<)/)) {
      const match = /^\s*<([^>]+)>\s*;(.*)$/.exec(part);
      if (match && /\brel\s*=\s*"?next(?:"|\s|;|$)/.test(match[2])) return new URL(match[1], currentUrl).href;
    }
  }
  if (typeof response.data?.next === 'string') return new URL(response.data.next, currentUrl).href;
  const next = response.headers.get('x-next-page');
  if (next) {
    if (!/^\d{1,8}$/.test(next) || Number(next) < 1) throw new GitError('Corrupt', 'Invalid pagination page');
    const url = new URL(currentUrl);
    url.searchParams.set('page', next);
    return url.href;
  }
  const continuation = response.headers.get('x-ms-continuationtoken');
  if (continuation) {
    checkLimit(continuation.length, 4096, 'Pagination cursor');
    const url = new URL(currentUrl);
    url.searchParams.set('continuationToken', continuation);
    return url.href;
  }
  return null;
}

export function pageItems(data) {
  const items = Array.isArray(data) ? data : data?.values ?? data?.value ?? data?.items;
  if (!Array.isArray(items)) throw new GitError('Corrupt', 'Provider returned an invalid collection');
  return items;
}

export function retryDelay(response, { now = Date.now(), attempt = 0, maximumDelayMs = 60000 } = {}) {
  const raw = response.headers.get('retry-after');
  let delay = 1000 * 2 ** attempt;
  if (raw) delay = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  else if (response.headers.get('x-ratelimit-remaining') === '0' && response.headers.has('x-ratelimit-reset')) {
    delay = Number(response.headers.get('x-ratelimit-reset')) * 1000 - now;
  }
  if (!Number.isFinite(delay) || delay > maximumDelayMs) {
    throw new GitError('Network', 'Provider retry interval exceeds the configured wait limit', {
      status: response.status, maximumDelayMs
    });
  }
  return Math.max(0, delay);
}
