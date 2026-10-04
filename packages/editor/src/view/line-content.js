/** Retain a virtual row when its bounded visible source, syntax, decorations and markers are unchanged. */
export class LineContent {
  constructor(view) { this.view = view; this.rows = new WeakMap(); }

  render(element, runs, row) {
    const {editor, document} = this.view;
    const spans = visibleSpans(runs, editor);
    const markers = markerKey(row, this.view);
    const previous = this.rows.get(element);
    if (previous?.markers === markers && sameSpans(previous.spans, spans)) {
      for (let index = 0; index < spans.length; index++) {
        const node = previous.nodes[index];
        if (node.title !== spans[index].hover) node.title = spans[index].hover;
      }
      previous.spans = spans;
      return false;
    }
    const fragment = document.createDocumentFragment();
    const nodes = [];
    for (const value of spans) {
      const node = document.createElement('span');
      node.className = value.className;
      node.textContent = value.text;
      node.dataset.offset = String(value.start);
      if (value.bracket) node.dataset.bracket = String(value.start);
      if (value.hover) node.title = value.hover;
      fragment.append(node);
      nodes.push(node);
    }
    element.replaceChildren(fragment);
    this.rows.set(element, {spans, markers, nodes});
    return true;
  }

  dispose() { this.rows = new WeakMap(); }
}

function sameSpans(before, after) {
  return before.length === after.length && before.every((value, index) => {
    const next = after[index];
    return value.start === next.start && value.text === next.text && value.bracket === next.bracket && value.className === next.className;
  });
}

function visibleSpans(runs, editor) {
  const result = [];
  for (const run of runs) {
    const decorations = editor.decorationsInRange(run.start, run.end);
    const cuts = new Set([run.start, run.end]);
    for (const decoration of decorations) {
      cuts.add(Math.max(run.start, decoration.start));
      cuts.add(Math.min(run.end, decoration.end));
    }
    const positions = [...cuts].sort((left, right) => left - right);
    for (let index = 0; index < positions.length - 1; index++) {
      const start = positions[index];
      const end = positions[index + 1];
      const classes = new Set(run.kind ? [`tok-${run.kind}`] : []);
      let hover = '';
      for (const decoration of decorations) {
        if (decoration.start >= end || decoration.end <= start) continue;
        for (const name of decoration.className?.split(/\s+/).filter(Boolean) ?? []) classes.add(name);
        if (decoration.hover) hover = decoration.hover;
      }
      result.push({start, text: editor.model.getText(start, end), bracket: run.bracket, className: [...classes].join(' '), hover});
    }
  }
  return result;
}

function markerKey(row, view) {
  const {record, segment} = row;
  const folded = view.editor.folding.at(row.line);
  const collapsed = folded?.collapsed && view.editor.folding.enabled && row.continuation === record.segments.length - 1;
  return JSON.stringify([record.text, record.eol, segment.start, segment.end, segment.x, row.continuation,
    record.segments.length, view.metrics.revision, view.editor.options.renderWhitespace,
    collapsed ? [folded.startLine, folded.endLine, view.foldingMargin.hintText(folded)] : null]);
}
