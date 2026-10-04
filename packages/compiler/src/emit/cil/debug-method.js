import { CilDebugScopes } from './debug-scopes.js';

const structuralStatements = new Set(['Block', 'Checked', 'Unchecked', 'Unsafe', 'Labeled', 'LocalFunction', 'Empty', 'Try']);

/** Optional source producer attached to one instruction stream. Markers consume no IL bytes or stack entries. */
export class CilMethodDebugInformation {
  constructor(emitter, sources) {
    this.emitter = emitter;
    this.sources = sources;
    this.frame = emitter.frame;
    this.scopes = new CilDebugScopes(emitter);
    this.points = [];
    this.awaits = [];
    this.statementDepth = 0;
    this.rootExpression = null;
    this.kickoffMachine = null;
    this.catchHandler = null;
  }
  marker() {
    const marker = {};
    this.emitter.il.markDebug(marker);
    return marker;
  }
  beginStatement(node) {
    const marker = this.marker();
    const scope = this.scopes.begin(node, marker);
    this.scopes.declarations(node);
    this.statementDepth++;
    const point = structuralStatements.has(node.kind) ? null : this.beginPoint(node.syntax, marker);
    return { point, scope };
  }
  endStatement(entry) {
    const end = this.marker();
    this.statementDepth--;
    if (entry.scope) entry.scope.end = end;
    this.endPoint(entry.point, end);
  }
  beginExpression(node) {
    if (this.statementDepth || this.rootExpression || this.emitter.il.depth !== 0) return null;
    const point = this.beginPoint(node.syntax, this.marker());
    this.rootExpression = point;
    return point;
  }
  endExpression(point) {
    if (!point) return;
    this.endPoint(point, this.marker());
    this.rootExpression = null;
  }
  beginPoint(syntax, start) {
    const uri = this.sources.uriOf(syntax, this.frame.uri);
    const location = this.sources.location(uri, syntax);
    if (!location) return null;
    const point = { start, end: null, location };
    this.points.push(point);
    return point;
  }
  endPoint(point, end) {
    if (point) point.end = end;
  }
  local(local, slot) {
    this.scopes.local(local, slot);
  }
  catchClause(clause, region) {
    this.scopes.catchClause(clause, region);
  }
  hoistLocals(fields) {
    this.scopes.markHoisted(fields);
  }
  kickoff(machine) {
    this.kickoffMachine = machine;
  }
  asyncCatch(label) {
    this.catchHandler = label;
  }
  awaitPoint(resume) {
    this.awaits.push({ yield: this.marker(), resume });
  }
  /** Discard source constructs that emitted no instruction; final instruction boundaries come from CilWriter. */
  sequencePoints(layout, length) {
    const events = new Map();
    for (const point of this.points) {
      const start = layout.get(point.start);
      const end = layout.get(point.end);
      if (start === undefined || end <= start || start >= length) continue;
      events.set(start, { ...point.location, ilOffset: start });
      if (end < length) events.set(end, { uri: point.location.uri, ilOffset: end, line: 0xfeefee, column: 0, endLine: 0xfeefee, endColumn: 0 });
    }
    return [...events.values()].sort((left, right) => left.ilOffset - right.ilOffset);
  }
  asyncSteps(layout, token) {
    const awaits = this.awaits.map(step => ({ yieldOffset: layout.get(step.yield), resumeOffset: layout.get(step.resume), resumeMethod: token }));
    return { awaits, catchHandlerOffset: this.catchHandler ? layout.get(this.catchHandler) : -1 };
  }
}
