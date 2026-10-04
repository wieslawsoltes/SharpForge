/** Validated, nested logical line ranges. The first line remains visible when collapsed. */
export class FoldingModel {
  constructor() {
    this.regions = [];
    this.enabled = true;
    this.revision = 0;
    this.listeners = new Set();
    this.preparedChanges = new WeakSet();
  }

  onDidChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  setRanges(ranges, lineCount) {
    const old = new Map(this.regions.map(region => [`${region.startLine}:${region.endLine}`, region.collapsed]));
    const sorted = ranges.map(range => ({...range})).sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
    const accepted = [];
    const stack = [];
    for (const region of sorted) {
      if (!Number.isInteger(region.startLine) || !Number.isInteger(region.endLine)) continue;
      if (region.startLine < 0 || region.endLine >= lineCount || region.endLine <= region.startLine) continue;
      while (stack.length && region.startLine > stack.at(-1).endLine) stack.pop();
      if (stack.length && (region.endLine > stack.at(-1).endLine || region.startLine === stack.at(-1).startLine)) continue;
      region.collapsed = region.collapsed ?? old.get(`${region.startLine}:${region.endLine}`) ?? false;
      region.depth = stack.length;
      region.kind ??= 'region';
      accepted.push(region);
      stack.push(region);
    }
    this.regions = accepted;
    this.changed();
  }

  at(line) { return this.regions.find(region => region.startLine === line); }
  containing(line) { return this.regions.filter(region => region.startLine <= line && line <= region.endLine); }
  hidden(line) { return this.enabled && this.regions.some(region => region.collapsed && region.startLine < line && line <= region.endLine); }

  collapsedRanges() {
    if (!this.enabled) return [];
    const ranges = [];
    for (const region of this.regions) {
      if (!region.collapsed || ranges.length && region.startLine <= ranges.at(-1).endLine) continue;
      ranges.push(region);
    }
    return ranges;
  }

  toggle(line) {
    const region = this.at(line) ?? this.containing(line).at(-1);
    if (!region) return false;
    this.enabled = true;
    region.collapsed = !region.collapsed;
    this.changed();
    return true;
  }

  collapseAll(predicate = () => true) {
    this.enabled = true;
    for (const region of this.regions) region.collapsed = !!predicate(region);
    this.changed();
  }

  toggleAll() {
    const collapse = !this.regions.some(region => region.collapsed);
    for (const region of this.regions) region.collapsed = collapse;
    this.enabled = true;
    this.changed();
  }

  reveal(line) {
    let changed = false;
    for (const region of this.regions) {
      if (region.collapsed && region.startLine < line && line <= region.endLine) {
        region.collapsed = false;
        changed = true;
      }
    }
    if (changed) this.changed();
    return changed;
  }

  /** Transform before owner callbacks; publish at the original model-listener boundary. */
  prepareChange(event) {
    if (this.preparedChanges.has(event.after)) return;
    this.transformChange(event);
    this.preparedChanges.add(event.after);
  }

  applyChange(event) {
    if (!this.preparedChanges.delete(event.after)) this.transformChange(event);
    this.changed();
  }

  transformChange(event) {
    const edits = [...event.changes].sort((left, right) => right.start - left.start);
    for (const edit of edits) {
      const start = edit.range?.start.line ?? event.before.positionAt(edit.start).line;
      const end = edit.range?.end.line ?? event.before.positionAt(edit.end).line;
      const insertedLines = edit.newRange ? edit.newRange.end.line - edit.newRange.start.line : countBreaks(edit.text);
      const delta = insertedLines - (end - start);
      for (const region of this.regions) {
        if (end < region.startLine) {
          region.startLine += delta;
          region.endLine += delta;
        } else if (start <= region.endLine) {
          if (region.collapsed) region.collapsed = false;
          region.startLine = start < region.startLine ? start : region.startLine;
          region.endLine = Math.max(region.startLine, region.endLine + delta);
        }
      }
    }
    this.regions = this.regions.filter(region => region.endLine > region.startLine);
  }

  changed() {
    this.revision++;
    for (const listener of this.listeners) listener(this);
  }

  dispose() { this.listeners.clear(); this.regions = []; }
}

function countBreaks(text) { return (text.match(/\r\n|\r|\n/g) ?? []).length; }
