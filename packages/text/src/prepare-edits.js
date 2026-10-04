import {normalizeEdit, checkEditOrder, createChange, appendInverse} from './buffer-edits.js';
import {normalizeEol} from './eol.js';

const MAX_CHUNK_CHARACTERS = 64 * 1024;

function preparationControls(options, check) {
  const {chunkSize = MAX_CHUNK_CHARACTERS, batchSize = 128, signal, onProgress} = options;
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_CHARACTERS) {
    throw new RangeError('Prepared edit chunks must contain between 1 and 65,536 UTF-16 code units');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 256) throw new RangeError('Invalid prepared edit batch size');
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('Invalid prepared edit progress callback');
  const current = () => {
    if (signal?.aborted) throw new DOMException('Text preparation cancelled', 'AbortError');
    check();
  };
  return {chunkSize, batchSize, current, async yield(progress) {
    current();
    onProgress?.(progress);
    current();
    await new Promise(resolve => setTimeout(resolve, 0));
    current();
  }};
}

async function insertionText(text, eol, controls) {
  if (!eol) return text;
  let result = '';
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + controls.chunkSize);
    if (end < text.length && text.charCodeAt(end - 1) === 13 && text.charCodeAt(end) === 10) end++;
    result += normalizeEol(text.slice(start, end), eol);
    start = end;
    if (text.length > controls.chunkSize) await controls.yield({phase: 'normalize-insert', completed: start, total: text.length});
  }
  return result;
}

async function prepareOneEdit(after, before, edit, delta, controls) {
  let inverseText = '';
  for (let start = edit.start; start < edit.end; start += controls.chunkSize) {
    const end = Math.min(edit.end, start + controls.chunkSize);
    inverseText += before.getText(start, end);
    if (edit.end - edit.start > controls.chunkSize) {
      await controls.yield({phase: 'prepare-inverse', completed: end - edit.start, total: edit.end - edit.start});
    }
  }
  const offset = edit.start + delta;
  if (edit.end > edit.start) after = after.withChange(offset, edit.end - edit.start, '');
  for (let start = 0; start < edit.text.length; start += controls.chunkSize) {
    const part = edit.text.slice(start, Math.min(edit.text.length, start + controls.chunkSize));
    after = after.withChange(offset + start, 0, part);
    if (edit.text.length > controls.chunkSize) {
      await controls.yield({phase: 'prepare-insert', completed: start + part.length, total: edit.text.length});
    }
  }
  return {after, inverseText};
}

/** Prepare ordered original-coordinate edits privately; every source read/insertion and work batch is explicitly bounded. */
export async function prepareOrderedEdits(buffer, before, edits, options, check) {
  if (!edits || typeof edits[Symbol.iterator] !== 'function' && typeof edits[Symbol.asyncIterator] !== 'function') {
    throw new TypeError('Cooperative preparation requires ordered iterable edits');
  }
  const controls = preparationControls(options, check);
  controls.current();
  const pending = [];
  let after = before;
  let delta = 0;
  let count = 0;
  let previous;
  for await (const input of edits) {
    controls.current();
    if (++count > buffer.maxEdits) throw new RangeError(`Expected at most ${buffer.maxEdits} text edits`);
    const edit = normalizeEdit(before, input);
    checkEditOrder(previous, edit);
    previous = edit;
    if (edit.start === edit.end && !edit.text) continue;
    edit.text = await insertionText(edit.text, options.normalizeLineEndings ? buffer.preferredEol : null, controls);
    const prepared = await prepareOneEdit(after, before, edit, delta, controls);
    after = prepared.after;
    pending.push({edit, inverseText: prepared.inverseText});
    delta += edit.text.length - (edit.end - edit.start);
    if (count % controls.batchSize === 0) await controls.yield({phase: 'prepare-edits', completed: count});
  }
  if (pending.length) after = after.withMetadata({uri: buffer.uri, version: before.version + 1});
  const changes = [];
  const inverseEdits = [];
  delta = 0;
  for (const {edit, inverseText} of pending) {
    const next = createChange(before, after, edit, delta, inverseText);
    changes.push(next.change);
    appendInverse(inverseEdits, next.inverse);
    delta += edit.text.length - (edit.end - edit.start);
    if (changes.length % controls.batchSize === 0) await controls.yield({phase: 'prepare-ranges', completed: changes.length});
  }
  controls.current();
  return Object.freeze({owner: buffer, before, after, oldVersion: before.version, version: after.version,
    source: options.source ?? 'edit', changes: Object.freeze(changes), inverseEdits: Object.freeze(inverseEdits)});
}
