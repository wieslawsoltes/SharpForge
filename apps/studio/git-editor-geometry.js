/** Detect the editor's explicit virtual-view API while retaining the legacy textarea adapter. */
export function gitEditorView(editor) {
  const view = editor.view;
  return view?.viewport && typeof view.coordsAt === 'function' && typeof view.layout?.rows === 'function' ? view : null;
}

/** Observe completed native layout and logical cursor changes without replacing editor callbacks. */
export function subscribeGitEditorView(editor, contribution) {
  return gitEditorView(editor) && typeof editor.registerContribution === 'function'
    ? editor.registerContribution(contribution) : null;
}

/** Visible logical lines and their coordinates relative to the editor, capped at the native view's row budget. */
export function gitEditorVisibleLines(editor, total = Infinity) {
  const view = gitEditorView(editor);
  const height = editor.lineHeight;
  if (view) {
    const viewport = view.viewport.getBoundingClientRect();
    const outer = editor.element.getBoundingClientRect();
    const extent = view.viewport.clientHeight || editor.element.clientHeight;
    const result = [];
    const seen = new Set();
    for (const row of view.layout.rows(view.scrollTop, extent, { overscan: 0, limit: 160 })) {
      const top = row.top - view.scrollTop;
      if (row.line >= total || top + height <= 0 || top >= extent || seen.has(row.line)) continue;
      seen.add(row.line);
      result.push({ index: row.line, top: viewport.top - outer.top + top, height });
    }
    return result;
  }
  const first = Math.max(0, Math.floor((editor.input.scrollTop - editor.padding) / height));
  const last = Math.min(total, first + Math.min(160, Math.ceil(editor.element.clientHeight / height) + 3));
  const result = [];
  for (let index = first; index < last; index++) {
    result.push({ index, top: editor.padding + index * height - editor.input.scrollTop, height });
  }
  return result;
}

/** Native caret and selection geometry in a non-scrolling overlay clipped to the actual source viewport. */
export function gitEditorCursorGeometry(editor) {
  const view = gitEditorView(editor);
  if (!view) return null;
  const viewport = view.viewport.getBoundingClientRect();
  const outer = editor.element.getBoundingClientRect();
  const left = viewport.left - outer.left;
  const top = viewport.top - outer.top;
  const height = view.viewport.clientHeight;
  const rows = view.layout.rows(view.scrollTop, height, { overscan: 0, limit: 160 });
  const boundedOffset = offset => Math.max(0, Math.min(editor.model.length, offset));
  return {
    left, top, width: view.viewport.clientWidth, height,
    caret(offset) {
      offset = boundedOffset(offset);
      if (editor.folding.hidden(editor.model.positionAt(offset).line)) return null;
      const point = view.coordsAt(offset);
      return { x: point.left - left, y: point.top - top, height: point.height };
    },
    selections(anchor, focus, maximum = 2048) {
      const start = boundedOffset(Math.min(anchor, focus));
      const end = boundedOffset(Math.max(anchor, focus));
      const result = [];
      for (const row of rows) {
        if (result.length >= maximum) return result;
        const base = row.record.start + row.record.sliceStart;
        const from = Math.max(start, base + row.segment.start);
        const to = Math.min(end, base + row.segment.end);
        if (to <= from) continue;
        const element = view.lines.elementFor(row.line, row.continuation);
        if (!element) continue;
        // The editor's DOM-range geometry preserves shaped text, syntax spans, tabs and wrapped fragments.
        for (const rect of view.bidi.rectangles(element, from - base - row.segment.start, to - base - row.segment.start)) {
          if (result.length >= maximum) return result;
          if (rect.top + rect.height <= viewport.top || rect.top >= viewport.bottom) continue;
          result.push({ x: rect.left - viewport.left, y: rect.top - viewport.top, width: rect.width, height: rect.height });
        }
      }
      return result;
    }
  };
}
