import { SourceText } from '@sharpforge/text';

const order = (a, b) => a.line - b.line || a.column - b.column || a.offset - b.offset || a.id - b.id;
const validPosition = request => Number.isSafeInteger(request?.line) && request.line > 0 &&
  (request.column === undefined || Number.isSafeInteger(request.column) && request.column > 0);

/** Index immutable compiled source locations once, rather than scanning all points per VM hook.
 * Locations are 1-based UTF-16; spans are half-open. Source identities are exact (never basename-matched).
 */
export class SourceBreakpointIndex {
  constructor(image) {
    this.sources = new Map((image.sources ?? []).filter(s => typeof s.text === 'string')
      .map(s => [s.uri, new SourceText(s.text, s.uri)]));
    this.bySource = new Map(); this.byMethod = new Map(); this.byId = new Map();
    this.ranges = (image.methods ?? []).filter(m => m.sourceRange).map(m => ({...m.sourceRange, methodId:m.id}));
    for (const raw of image.sequencePoints ?? []) {
      if (raw.hidden) continue;
      const source = this.sources.get(raw.uri), end = source?.positionAt(raw.end);
      const p = {...raw, endLine:end ? end.line + 1 : raw.endLine ?? raw.line,
        endColumn:end ? end.character + 1 : raw.endColumn ?? raw.column + 1};
      this.byId.set(p.id, p);
      if (!this.bySource.has(p.uri)) this.bySource.set(p.uri, []);
      if (!this.byMethod.has(p.methodId)) this.byMethod.set(p.methodId, []);
      this.bySource.get(p.uri).push(p); this.byMethod.get(p.methodId).push(p);
    }
    for (const list of this.bySource.values()) list.sort(order);
    for (const list of this.byMethod.values()) list.sort((a,b) => a.offset - b.offset);
  }
  resolve(uri, request) {
    if (!validPosition(request)) return {message:'Breakpoint line/column must be positive integers'};
    const source = this.sources.get(uri), points = this.bySource.get(uri) ?? [];
    if (!points.length) return {message:'No executable source mapping for this exact document'};
    if (source && request.line > source.lineStarts.length) return {message:'Breakpoint is beyond the compiled source document'};
    const offset = source?.offsetAt({line:request.line - 1, character:(request.column ?? 1) - 1});
    // Prefer the smallest enclosing method; top-level methods can contain local functions.
    const scope = offset === undefined ? null : this.ranges.filter(r => r.uri === uri &&
      offset >= r.start && offset < r.end).sort((a,b) => a.end - a.start - (b.end - b.start))[0];
    const eligible = scope ? points.filter(p => p.methodId === scope.methodId) : points;
    // A click in the middle of an expression (even on a continuation line) binds to
    // that statement, not the statement after it. Smallest span wins nested expressions.
    const containing = offset === undefined ? [] : eligible.filter(p =>
      p.start <= offset && offset < p.end).sort((a,b) => a.end - a.start - (b.end - b.start) || order(a,b));
    const onLine = eligible.filter(p => p.line === request.line);
    let point = request.column === undefined && onLine.length ? onLine[0] : containing[0];
    if (!point) point = eligible.find(p => p.line > request.line ||
      p.line === request.line && p.column >= (request.column ?? 1));
    if (!point) return {message:scope ? 'No executable statement at or after this position in the containing method' :
      'No executable code at or after this location in this source file'};
    // A line breakpoint can represent several statements on that line, but never
    // silently bind to another method on the same physical line. Column requests are exact.
    const locations = request.column === undefined ? eligible.filter(p => p.line === point.line && p.methodId === point.methodId) : [point];
    let message;
    if (point.line < request.line || request.column !== undefined && point.column < request.column && point.line === request.line)
      message = `Bound to the containing statement (${point.line}:${point.column})`;
    else if (point.line !== request.line) message = `Bound to the next executable line (${point.line})`;
    else if (locations.length > 1) message = `${locations.length} executable locations on this line; specify a column to select one`;
    return {point, locations, message};
  }
  locations(uri, {line=1, column=1, endLine=line, endColumn=Number.MAX_SAFE_INTEGER} = {}) {
    if (!validPosition({line,column}) || !Number.isSafeInteger(endLine) || endLine < line ||
        !Number.isSafeInteger(endColumn) || endColumn < 1) throw new RangeError('Invalid executable-location range');
    return (this.bySource.get(uri) ?? []).filter(p => (p.line > line || p.line === line && p.column >= column) &&
      (p.line < endLine || p.line === endLine && p.column <= endColumn)).map(p => ({...p}));
  }
}
