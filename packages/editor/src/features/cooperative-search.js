import {findTextMatches} from '@sharpforge/text';
import {workerOptions} from '../worker-options.js';

const word = /[\p{L}\p{N}\p{M}_]/u;

function lengthOf(document) { return document.length ?? document.text.length; }
function readText(document, start, end) { return document.getText?.(start, end) ?? document.text.slice(start, end); }

function boundary(document, start, end) {
  const prefix = Math.max(0, start - 2);
  const text = readText(document, prefix, Math.min(lengthOf(document), end + 2));
  start -= prefix;
  end -= prefix;
  let before = start - 1;
  if (before > 0 && text.charCodeAt(before) >= 0xdc00 && text.charCodeAt(before) <= 0xdfff) before--;
  const left = text.slice(Math.max(0, before), start);
  const right = end < text.length ? String.fromCodePoint(text.codePointAt(end)) : '';
  return !word.test(left) && !word.test(right);
}

function advancePosition(text, from, to, state) {
  for (let cursor = from; cursor < to; cursor++) {
    const code = text.charCodeAt(cursor);
    if (code === 13 && text.charCodeAt(cursor + 1) === 10 && cursor + 1 < to) {
      cursor++;
      state.line++;
      state.character = 0;
    } else if (code === 10 || code === 13 && text.charCodeAt(cursor + 1) !== 10) {
      state.line++;
      state.character = 0;
    } else state.character++;
  }
}

function scheduler() {
  const channel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
  if (!channel) return {yield: () => new Promise(resolve => setTimeout(resolve, 0)), dispose() {}};
  let resume;
  channel.port1.onmessage = () => resume?.();
  return {yield: () => new Promise(resolve => { resume = resolve; channel.port2.postMessage(0); }),
    dispose() { channel.port1.close(); channel.port2.close(); }};
}

/** Searches literal chunks with the shared KMP engine, preserving its nonoverlap semantics across every boundary. */
export async function cooperativeLiteralSearch(documents, query, options = {}) {
  if (typeof query !== 'string' || query.length > 1024) throw new RangeError('Search text must be at most 1024 characters');
  const maxMatches = options.maxMatches ?? 10_000;
  if (!Number.isInteger(maxMatches) || maxMatches < 1 || maxMatches > 10_000) throw new RangeError('Invalid match limit');
  if (!query) return {matches: [], truncated: false, scannedFiles: 0, backend: 'cooperative-kmp'};
  const matches = [];
  let scannedFiles = 0;
  let processed = 0;
  let chunkSize = options.chunkSize ?? 16_384;
  if (!Number.isInteger(chunkSize) || chunkSize < 256 || chunkSize > 262_144) throw new RangeError('Invalid search chunk size');
  const timing = scheduler();
  const total = documents.reduce((sum, document) => sum + lengthOf(document), 0);
  const cooperate = options.yieldControl ?? timing.yield;
  try {
    for (const document of documents) {
      const length = lengthOf(document);
      const position = {line: 0, character: 0};
      let cursor = 0;
      let positionCursor = 0;
      let highWater = 0;
      let lastMatchEnd = 0;
      while (cursor < length) {
        if (options.signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
        let end = Math.min(length, cursor + Math.max(chunkSize, query.length + 2));
        const finalCode = readText(document, end - 1, end).charCodeAt(0);
        if (end < length && finalCode >= 0xd800 && finalCode <= 0xdbff) end++;
        let result;
        try {
          result = findTextMatches([{uri: document.uri, version: document.version, text: readText(document, cursor, end)}], query, {
            matchCase: options.matchCase, maxMatches: 10_000, maxSteps: 2_000_000,
            timeLimitMs: options.sliceTimeMs ?? 10, signal: options.signal
          });
        } catch (error) {
          if (error.code !== 'SEARCH_LIMIT' || chunkSize <= 1024) throw error;
          chunkSize = Math.max(1024, chunkSize >>> 1);
          await cooperate();
          continue;
        }
        const prefix = readText(document, positionCursor, Math.min(length, cursor + 1));
        advancePosition(prefix, 0, cursor - positionCursor, position);
        positionCursor = cursor;
        for (const match of result.matches) {
          const start = cursor + match.start;
          const finish = cursor + match.end;
          if (start < lastMatchEnd) continue;
          lastMatchEnd = finish;
          if (options.wholeWord && !boundary(document, start, finish)) continue;
          if (matches.length === maxMatches) return {matches, truncated: true, scannedFiles: scannedFiles + 1, backend: 'cooperative-kmp'};
          matches.push({...match, start, end: finish, line: position.line + match.line,
            character: match.line === 0 ? position.character + match.character : match.character,
            indices: match.indices?.map(range => range ? {start: cursor + range.start, end: cursor + range.end} : null)});
        }
        const completed = result.truncated ? lastMatchEnd : end;
        processed += Math.max(0, completed - highWater);
        highWater = Math.max(highWater, completed);
        options.onProgress?.({processed, total, matches: matches.length});
        if (end === length && !result.truncated) break;
        const resume = result.truncated ? lastMatchEnd : Math.max(lastMatchEnd, end - query.length + 1);
        cursor = Math.max(cursor + 1, resume);
        const nextCode = readText(document, cursor, Math.min(length, cursor + 1)).charCodeAt(0);
        if (cursor > lastMatchEnd && nextCode >= 0xdc00 && nextCode <= 0xdfff) cursor--;
        await cooperate();
      }
      scannedFiles++;
    }
    return {matches, truncated: false, scannedFiles, backend: 'cooperative-kmp'};
  } finally { timing.dispose(); }
}

/** Large regular expressions run in a terminable worker with hard instruction/time limits. */
export function workerRegexSearch(documents, query, options = {}) {
  const createWorker = options.workerFactory ?? (() => {
    const asset = new URL('./search-worker.js', import.meta.url);
    return new Worker(asset, workerOptions(asset));
  });
  if (!options.workerFactory && typeof Worker !== 'function') throw new Error('Large regular-expression search requires a worker host');
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(new DOMException('Search cancelled', 'AbortError'));
    worker.onmessage = event => {
      if (event.data.error) finish(Object.assign(new Error(event.data.error.message), event.data.error));
      else finish(null, {...event.data.result, backend: 'worker-safe-regex'});
    };
    worker.onerror = event => finish(new Error(event.message ?? 'Search worker failed'));
    options.signal?.addEventListener('abort', abort, {once: true});
    if (options.signal?.aborted) return abort();
    const timing = scheduler();
    (async () => {
      try {
        const total = documents.reduce((sum, document) => sum + lengthOf(document), 0);
        let processed = 0;
        for (const document of documents) {
          if (settled) return;
          worker.postMessage({type: 'document', uri: document.uri, version: document.version});
          for (let start = 0; start < lengthOf(document); start += 65_536) {
            if (settled) return;
            const text = readText(document, start, Math.min(lengthOf(document), start + 65_536));
            worker.postMessage({type: 'chunk', text});
            processed += text.length;
            options.onProgress?.({processed, total, phase: 'transferring'});
            await timing.yield();
          }
        }
        if (!settled) worker.postMessage({type: 'search', query, options: {regex: true, matchCase: options.matchCase,
          wholeWord: options.wholeWord, multiline: options.multiline ?? true, dotAll: options.dotAll,
          maxMatches: options.maxMatches ?? 10_000, maxSteps: options.maxSteps ?? 100_000_000, timeLimitMs: options.timeLimitMs ?? 10_000}});
      } catch (error) { finish(error); }
      finally { timing.dispose(); }
    })();
  });
}
