import {encodedWorkspaceSourceChunks, encodeWorkspaceFile, isSourceSnapshot, writeWorkspaceSource} from '@sharpforge/project-system';

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

function cancelled() {
  return new DOMException('Source save cancelled', 'AbortError');
}

function checkCancellation(signal) {
  if (signal?.aborted) throw cancelled();
}

function saveError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function captureSource(snapshot, maxBytes) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('A captured source record is required');
  // A legacy string data property is safe; evaluating a lazy text getter would flatten the source.
  const source = isSourceSnapshot(snapshot) ? snapshot : snapshot.source ?? Object.getOwnPropertyDescriptor(snapshot, 'text')?.value;
  if (typeof source !== 'string' && !isSourceSnapshot(source)) {
    throw new TypeError('Save As requires an immutable source snapshot or a captured text string');
  }
  const uri = snapshot.uri ?? snapshot.path ?? source.uri ?? 'Program.cs';
  const version = snapshot.version ?? source.version;
  const encoding = snapshot.encoding ?? 'utf-8';
  const bom = snapshot.bom ?? false;
  if (typeof uri !== 'string' || !uri || typeof bom !== 'boolean') throw new TypeError('Invalid source save metadata');
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 0)) throw new TypeError('Invalid captured source version');
  if (typeof source !== 'string' && (source.uri !== undefined && source.uri !== uri
    || source.version !== undefined && source.version !== version)) {
    throw new TypeError('Captured source metadata does not match its immutable snapshot');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || source.length > maxBytes) {
    throw new RangeError('Source output byte limit exceeded');
  }
  // Validate encoding and its BOM using the same encoder, without reading any source characters.
  if (encodeWorkspaceFile({path: uri, text: '', encoding, bom}).byteLength > maxBytes) {
    throw new RangeError('Source output byte limit exceeded');
  }
  return Object.freeze({uri, version, source, encoding, bom});
}

function sourceName(uri) {
  let path = uri.replaceAll('\\', '/');
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) path = decodeURIComponent(new URL(path).pathname);
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[ .]+$/g, '');
  return name || 'Program.cs';
}

function resultFor(captured, result) {
  return {...captured, ...result};
}

function streamCancellation(stream, signal) {
  let pending;
  const abort = reason => {
    // Observe rejection immediately, including when a pending write has not settled yet.
    pending ??= Promise.resolve().then(() => stream.abort(reason)).then(
      () => ({ok: true}), error => ({ok: false, error}));
    return pending;
  };
  const onAbort = () => { void abort(cancelled()); };
  signal?.addEventListener('abort', onAbort, {once: true});
  return {abort, detach: () => signal?.removeEventListener('abort', onAbort)};
}

async function writeCapturedSource(stream, captured, options) {
  if (!stream || ['write', 'close', 'abort'].some(method => typeof stream[method] !== 'function')) {
    const error = saveError('SFSTUDIO_SAVE_STREAM', 'The selected file did not provide a writable, abortable stream');
    if (typeof stream?.abort === 'function') {
      try { await stream.abort(error); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'The invalid source output stream could not be aborted'); }
    }
    throw error;
  }
  const cancellation = streamCancellation(stream, options.signal);
  let bytesWritten = 0;
  try {
    checkCancellation(options.signal);
    await writeWorkspaceSource({async write(bytes) {
      checkCancellation(options.signal);
      await stream.write(bytes);
      bytesWritten += bytes.byteLength;
      await options.onProgress?.({phase: 'write', bytesWritten, maxBytes: options.maxBytes});
    }}, captured.source, {...options, path: captured.uri, encoding: captured.encoding, bom: captured.bom});
    checkCancellation(options.signal);
    // Close is the commit boundary: after it starts, completion wins over a late cancellation.
    cancellation.detach();
    await stream.close();
    return bytesWritten;
  } catch (error) {
    const cleanup = await cancellation.abort(error);
    if (!cleanup.ok) throw new AggregateError([error, cleanup.error], 'Source save failed and its output stream could not be aborted');
    throw error;
  } finally {
    cancellation.detach();
  }
}

function browserDownload(window) {
  const document = window?.document;
  const parent = document?.body ?? document?.documentElement;
  const urls = window?.URL;
  if (!parent?.appendChild || !document?.createElement || !urls?.createObjectURL || !urls?.revokeObjectURL) {
    throw saveError('SFSTUDIO_SAVE_UNAVAILABLE', 'This environment has neither a writable file picker nor a file download provider');
  }
  return (name, blob) => {
    const link = document.createElement('a');
    const url = urls.createObjectURL(blob);
    link.href = url;
    link.download = name;
    link.hidden = true;
    try {
      parent.appendChild(link);
      link.click();
    } finally {
      link.remove();
      // The browser must consume the link before the backing Blob URL is released.
      (window.setTimeout?.bind(window) ?? setTimeout)(() => urls.revokeObjectURL(url), 1000);
    }
  };
}

async function exportCapturedSource(captured, name, options) {
  const BlobType = options.window?.Blob ?? globalThis.Blob;
  if (typeof BlobType !== 'function') throw saveError('SFSTUDIO_SAVE_UNAVAILABLE', 'Binary file downloads are unavailable');
  const download = options.download ?? browserDownload(options.window);
  const pieces = [];
  let bytesWritten = 0;
  for await (const bytes of encodedWorkspaceSourceChunks(captured.source,
    {...options, path: captured.uri, encoding: captured.encoding, bom: captured.bom})) {
    pieces.push(bytes);
    bytesWritten += bytes.byteLength;
    await options.onProgress?.({phase: 'export', bytesWritten, maxBytes: options.maxBytes});
  }
  checkCancellation(options.signal);
  const type = `text/plain;charset=${captured.encoding}`;
  const blob = new BlobType(pieces, {type});
  checkCancellation(options.signal);
  const accepted = await download(name, blob, type);
  return resultFor(captured, {ok: false, exported: accepted !== false, name, byteLength: bytesWritten});
}

async function prepareCapturedSource(captured, options) {
  if (!options.prepare) return captured;
  checkCancellation(options.signal);
  const replacement = await options.prepare({signal: options.signal});
  checkCancellation(options.signal);
  const prepared = captureSource(replacement, options.maxBytes);
  if (prepared.uri !== captured.uri || captured.version !== undefined
    && (prepared.version === undefined || prepared.version < captured.version)) {
    throw saveError('SFSTUDIO_SAVE_STALE', 'The prepared save belongs to another document or an older source revision');
  }
  return prepared;
}

/**
 * Save one captured source, preserving encoding/BOM and never reading its lazy whole-text getter.
 * The picker runs before the first await or optional prepare({signal}) callback. Preparation
 * returns an exact replacement capture for the same URI, before a writable stream is opened.
 * Native success requires close(); downloads return
 * {ok:false, exported:true}, since initiating a download cannot confirm that the user saved it.
 * Cancellation is honored before close/download begins. Other failures reject; an acquired
 * stream is aborted on failure. maxBytes bounds encoded output (default 256 MiB).
 */
export async function saveStudioSourceAs(snapshot, {window = globalThis.window, download, signal,
  maxBytes = DEFAULT_MAX_BYTES, onProgress, prepare} = {}) {
  if (download !== undefined && typeof download !== 'function') throw new TypeError('The download provider must be a function');
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('The progress callback must be a function');
  if (prepare !== undefined && typeof prepare !== 'function') throw new TypeError('The source preparation callback must be a function');
  if (signal != null && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function'
    || typeof signal.removeEventListener !== 'function')) throw new TypeError('The cancellation signal must be an AbortSignal');
  let captured = captureSource(snapshot, maxBytes);
  const name = sourceName(captured.uri);
  const options = {window, download, signal, maxBytes, onProgress, prepare};
  try {
    checkCancellation(signal);
    if (typeof window?.showSaveFilePicker === 'function') {
      const handle = await window.showSaveFilePicker({suggestedName: name});
      checkCancellation(signal);
      if (!handle) throw saveError('SFSTUDIO_SAVE_HANDLE', 'The file picker did not return a file handle');
      captured = await prepareCapturedSource(captured, options);
      if (typeof handle.createWritable === 'function') {
        let stream;
        try { stream = await handle.createWritable(); }
        catch (error) {
          if (error?.name !== 'NotSupportedError') throw error;
          return await exportCapturedSource(captured, name, options);
        }
        const byteLength = await writeCapturedSource(stream, captured, options);
        return resultFor(captured, {ok: true, handle, name: handle.name ?? name, byteLength});
      }
    }
    if (typeof window?.showSaveFilePicker !== 'function') captured = await prepareCapturedSource(captured, options);
    return await exportCapturedSource(captured, name, options);
  } catch (error) {
    if (error?.name === 'AbortError') return resultFor(captured, {ok: false, cancelled: true, name});
    throw error;
  }
}
