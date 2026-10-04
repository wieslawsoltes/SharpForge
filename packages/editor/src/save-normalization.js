const MAX_CHUNK_CHARACTERS = 64 * 1024;

/** False means saving can return the current snapshot without reading any source characters. */
export function hasSaveNormalization(options = {}) {
  return !!(options.trimTrailingWhitespace || options.insertFinalNewline || options.normalizeLineEndings !== false);
}

function controlsFor(options = {}) {
  const {chunkSize = MAX_CHUNK_CHARACTERS, batchSize = 128, maxEdits = 100000} = options;
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_CHARACTERS) {
    throw new RangeError('Save preparation chunks must contain between 1 and 65,536 UTF-16 code units');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 256) throw new RangeError('Invalid save preparation batch size');
  if (!Number.isInteger(maxEdits) || maxEdits < 1) throw new RangeError('Invalid save preparation edit limit');
  if (options.onProgress !== undefined && typeof options.onProgress !== 'function') throw new TypeError('Invalid save progress callback');
  return {...options, chunkSize, batchSize, maxEdits};
}

function checkPreparation(controls) {
  if (controls.signal?.aborted) throw new DOMException('Save preparation cancelled', 'AbortError');
  controls.check?.();
}

function* trailingStart(source, start, end, controls) {
  if (start === end) return end;
  const last = source.getText(end - 1, end);
  if (last !== ' ' && last !== '\t') return end;
  let result = end;
  while (result > start) {
    const from = Math.max(start, result - controls.chunkSize);
    const text = source.getText(from, result);
    let index = text.length;
    while (index && (text.charCodeAt(index - 1) === 9 || text.charCodeAt(index - 1) === 32)) index--;
    result = from + index;
    if (index) return result;
    if (result > start) yield {progress: {phase: 'scan-whitespace', completed: end - result, total: end - start}};
  }
  return result;
}

function hasDifferentEndings(counts, ending) {
  if (!counts) return true;
  if (ending === '\n') return counts.cr > 0 || counts.crlf > 0;
  if (ending === '\r') return counts.lf > 0 || counts.crlf > 0;
  return counts.cr > 0 || counts.lf > 0;
}

function* saveEditSteps(source, options, controls) {
  const ending = options.endOfLine ?? '\n';
  if (!['\n', '\r\n', '\r'].includes(ending)) throw new RangeError('Invalid save line ending');
  const normalize = options.normalizeLineEndings !== false && hasDifferentEndings(source.eolCounts, ending);
  const lineCount = source.lineCount;
  if (options.trimTrailingWhitespace || normalize) {
    for (let line = 0; line < lineCount; line++) {
      const start = source.lineStart(line);
      const contentEnd = source.lineEnd(line);
      const next = line + 1 < lineCount ? source.lineStart(line + 1) : contentEnd;
      const trimmed = options.trimTrailingWhitespace ? yield* trailingStart(source, start, contentEnd, controls) : contentEnd;
      const previousEnding = source.getText(contentEnd, next);
      const replacementEnding = next > contentEnd && normalize ? ending : previousEnding;
      if (trimmed < contentEnd) yield {edit: {start: trimmed, end: contentEnd, text: ''}};
      if (replacementEnding !== previousEnding) yield {edit: {start: contentEnd, end: next, text: replacementEnding}};
      if ((line + 1) % controls.batchSize === 0) yield {progress: {phase: 'scan-lines', completed: line + 1, total: lineCount}};
    }
  }
  if (options.insertFinalNewline && source.length) {
    const last = source.getText(source.length - 1, source.length);
    if (last !== '\r' && last !== '\n') yield {edit: {start: source.length, end: source.length, text: ending}};
  }
}

function appendEdit(edits, step, maximum) {
  if (!step.edit) return;
  if (edits.length === maximum) throw new RangeError(`Save normalization exceeds the ${maximum} edit limit`);
  edits.push(step.edit);
}

/** Synchronous compatibility for bounded callers; each read is bounded even when an individual logical line is huge. */
export function saveTextEdits(model, options = {}, settings = {}) {
  if (!hasSaveNormalization(options)) return [];
  const controls = controlsFor(settings);
  checkPreparation(controls);
  const source = model.snapshot?.() ?? model;
  const edits = [];
  for (const step of saveEditSteps(source, options, controls)) {
    checkPreparation(controls);
    appendEdit(edits, step, controls.maxEdits);
  }
  return edits;
}

/** Compute save edits against an immutable snapshot, yielding after bounded reads/line batches and never mutating a model. */
export async function saveTextEditsAsync(model, options = {}, settings = {}) {
  const controls = controlsFor(settings);
  checkPreparation(controls);
  if (!hasSaveNormalization(options)) return [];
  const source = model.snapshot?.() ?? model;
  const edits = [];
  for (const step of saveEditSteps(source, options, controls)) {
    checkPreparation(controls);
    appendEdit(edits, step, controls.maxEdits);
    if (step.progress) {
      controls.onProgress?.(step.progress);
      checkPreparation(controls);
      await new Promise(resolve => setTimeout(resolve, 0));
      checkPreparation(controls);
    }
  }
  checkPreparation(controls);
  return edits;
}
