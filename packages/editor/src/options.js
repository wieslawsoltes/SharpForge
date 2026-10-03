export const defaultEditorOptions = Object.freeze({
  fontFamily: 'Consolas, Menlo, monospace', fontSize: 14, lineHeight: 22, tabSize: 4, indentSize: 4,
  insertSpaces: true, wordWrap: false, renderWhitespace: false, zoom: 100, zoomScope: 'view',
  scrollPastEnd: true, stickyScroll: true, stickyScrollMaxLines: 3, structureGuides: true,
  overviewRuler: true, mapMode: 'off', bracketColors: true, bracketMatchStyle: 'rectangle',
  virtualSpace: false, columnGuides: [80, 120], largeFileThreshold: 20 * 1024 * 1024,
  maxRenderedLineCharacters: 16384, endOfLine: '\n', trimTrailingWhitespace: false, insertFinalNewline: false,
  screenReaderWindowLines: 3, language: 'csharp'
});

/** Validate options before altering the view. Invalid values never partially apply. */
export function editorOptions(overrides = {}, base = defaultEditorOptions) {
  const result = {...base, ...overrides};
  for (const [name, minimum, maximum] of [
    ['fontSize', 4, 100], ['lineHeight', 4, 200], ['tabSize', 1, 32], ['indentSize', 1, 32],
    ['zoom', 20, 400], ['stickyScrollMaxLines', 0, 10], ['maxRenderedLineCharacters', 256, 1000000]
  ]) {
    if (!Number.isFinite(result[name]) || result[name] < minimum || result[name] > maximum) throw new RangeError(`Invalid editor option ${name}`);
  }
  for (const name of ['tabSize', 'indentSize', 'stickyScrollMaxLines', 'maxRenderedLineCharacters', 'screenReaderWindowLines']) {
    if (!Number.isInteger(result[name]) || result[name] < 0) throw new RangeError(`Editor option ${name} must be an integer`);
  }
  if (!Number.isSafeInteger(result.largeFileThreshold) || result.largeFileThreshold < 1) throw new RangeError('Invalid large file threshold');
  if (!['view', 'global'].includes(result.zoomScope)) throw new RangeError('Invalid editor zoom scope');
  if (!['off', 'narrow', 'medium', 'wide'].includes(result.mapMode)) throw new RangeError('Invalid scrollbar map mode');
  if (!['\n', '\r\n', '\r'].includes(result.endOfLine)) throw new RangeError('Invalid editor line ending');
  if (!Array.isArray(result.columnGuides) || result.columnGuides.some(column => !Number.isInteger(column) || column < 1 || column > 1000)) {
    throw new RangeError('Column guides must be integers between 1 and 1000');
  }
  result.columnGuides = [...new Set(result.columnGuides)].sort((left, right) => left - right);
  return result;
}

export class EditorOptionScope {
  constructor(options = {}) { this.options = editorOptions(options); this.listeners = new Set(); }
  set(options) {
    this.options = editorOptions(options, this.options);
    for (const listener of this.listeners) listener(this.options);
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
