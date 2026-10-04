import {workbenchError} from './state-events.js';

const text = (value, limit = 4096) => typeof value === 'string' ? value.slice(0, limit) : '';
const coordinate = value => Number.isFinite(value) && value >= 0 ? value : null;

function safeUrl(value) {
  const raw = text(value);
  if (raw.startsWith('blob:')) return 'blob:' + safeUrl(raw.slice(5));
  try {
    const url = new URL(raw.startsWith('//') ? 'https:' + raw : raw);
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return raw.startsWith('//') ? url.href.slice(6) : url.href;
  } catch { return raw.split(/[?#]/, 1)[0]; }
}

function safeText(value, limit = 4096) {
  return text(value, limit).replace(/(?:blob:)?(?:https?|file):\/\/[^\s'"<>)}\]]+/g, safeUrl);
}

/** Preserve native errors; an opaque load error is attributed without inventing a browser cause. */
export function workerFailure(event, {url, settings, generation, kind}, documentUrl = globalThis.location?.href) {
  const originalMessage = safeText(event?.message);
  const error = workbenchError('WORKER_FAILED', originalMessage || 'Worker failed to initialize', event?.error);
  error.worker = Object.freeze({
    url: safeUrl(String(url)), type: settings.type, name: safeText(settings.name), kind: text(kind), generation,
    documentUrl: safeUrl(documentUrl), originalMessage,
    filename: safeUrl(event?.filename), line: coordinate(event?.lineno), column: coordinate(event?.colno),
    causeName: text(event?.error?.name), causeStack: safeText(event?.error?.stack, 16_384)
  });
  return error;
}
