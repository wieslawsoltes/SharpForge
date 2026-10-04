/** Language-service folding with deterministic lexical/indentation fallback and stale-result rejection. */
export class FoldingProvider {
  constructor(editor) { this.editor = editor; this.generation = 0; this.disposed = false; }

  async refresh() {
    const generation = ++this.generation;
    const {editor} = this;
    const version = editor.model.version;
    const uri = editor.uri;
    if (editor.largeFile.active) return;
    let ranges;
    try {
      const result = await editor.request('foldingRanges', {uri, version});
      ranges = Array.isArray(result) ? result : result?.ranges;
    } catch (error) {
      editor.reportError?.('SFEDITOR_FOLDING_PROVIDER', error);
    }
    const current = () => !this.disposed && generation === this.generation && version === editor.model.version && uri === editor.uri;
    if (!current()) return;
    ranges ??= await scanFoldingRanges(editor.model.snapshot(), editor.highlightIndex.tokens, current);
    if (ranges && current()) editor.folding.setRanges(ranges, editor.model.lineCount);
  }

  dispose() { this.disposed = true; this.generation++; }
}

export function fallbackFolding(model, highlightIndex = null) {
  const ranges = [];
  const regionStack = [];
  const indentation = [];
  let usingStart = -1;
  const flushUsings = line => {
    if (usingStart >= 0 && line > usingStart + 1) ranges.push({startLine: usingStart, endLine: line - 1, kind: 'imports'});
    usingStart = -1;
  };
  for (let line = 0; line < model.lineCount; line++) {
    const text = model.getLine(line);
    const trimmed = text.trim();
    if (/^#region\b/.test(trimmed)) regionStack.push(line);
    if (/^#endregion\b/.test(trimmed) && regionStack.length) {
      ranges.push({startLine: regionStack.pop(), endLine: line, kind: 'region'});
    }
    if (/^(?:global\s+)?using\s+(?:static\s+)?[\w.]+(?:\s*=.*)?;/.test(trimmed)) {
      if (usingStart < 0) usingStart = line;
    } else flushUsings(line);
    if (!trimmed) continue;
    const indent = text.length - text.trimStart().length;
    while (indentation.length && indentation.at(-1).indent >= indent) {
      const previous = indentation.pop();
      if (line > previous.line + 1) ranges.push({startLine: previous.line, endLine: line - 1, kind: 'indent'});
    }
    indentation.push({line, indent});
  }
  flushUsings(model.lineCount);
  if (highlightIndex?.lexed) {
    const pairs = highlightIndex.pairs;
    for (const [start, end] of pairs) {
      if (start >= end || model.getText(start, start + 1) !== '{') continue;
      const from = model.positionAt(start).line;
      const to = model.positionAt(end).line;
      if (to > from) ranges.push({startLine: from, endLine: to, kind: 'code', header: model.getLine(from).trim()});
    }
    for (const run of highlightIndex.runs) {
      if (run.kind !== 'comment') continue;
      const from = model.positionAt(run.start).line;
      const to = model.positionAt(Math.max(run.start, run.end - 1)).line;
      if (to > from) ranges.push({startLine: from, endLine: to, kind: 'comment'});
    }
  }
  return ranges;
}
import {scanFoldingRanges} from './folding-scan.js';
