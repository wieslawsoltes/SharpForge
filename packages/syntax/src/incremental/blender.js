import { GreenFlags } from '../green.js';
/**
 * The node blender: while the parser re-parses an edited document it asks, at every member and statement position,
 * whether the old tree has a node starting there that can be reused as is. A node qualifies when it lies outside the
 * relexed token window (and, before the window, ends before the last unchanged token, which was its lookahead), has
 * no diagnostics up to the start of the token after it, missing tokens or skipped text, and was parsed in the same context (enclosing type name for members,
 * async context for statements, namespace level for namespace members). Reused nodes are skipped by position, so a
 * keystroke costs the rescanned window plus the spine of nodes around it.
 */
const dirty = GreenFlags.ContainsDiagnostics | GreenFlags.ContainsSkippedText | GreenFlags.ContainsMissing;
const typeKinds = ['ClassDeclaration', 'StructDeclaration', 'InterfaceDeclaration', 'RecordDeclaration', 'RecordStructDeclaration', 'EnumDeclaration', 'DelegateDeclaration', 'UnionDeclaration'];
const containers = new Set(['ClassDeclaration', 'StructDeclaration', 'InterfaceDeclaration', 'RecordDeclaration', 'RecordStructDeclaration', 'EnumDeclaration', 'ExtensionBlockDeclaration', 'UnionDeclaration']);
const functions = new Set(['MethodDeclaration', 'LocalFunctionStatement', 'SimpleLambdaExpression', 'ParenthesizedLambdaExpression', 'AnonymousMethodExpression']);
export const reusableMembers = Object.freeze(new Set([...typeKinds, 'FieldDeclaration', 'EventFieldDeclaration', 'MethodDeclaration', 'OperatorDeclaration', 'ConversionOperatorDeclaration', 'ConstructorDeclaration', 'DestructorDeclaration', 'PropertyDeclaration', 'EventDeclaration', 'IndexerDeclaration']));
export const reusableNamespaceMembers = Object.freeze(new Set([...typeKinds, 'NamespaceDeclaration', 'GlobalStatement']));
export const reusableStatements = Object.freeze(new Set(['Block', 'LocalFunctionStatement', 'LocalDeclarationStatement', 'ExpressionStatement', 'EmptyStatement', 'LabeledStatement', 'GotoStatement', 'GotoCaseStatement', 'GotoDefaultStatement', 'BreakStatement', 'ContinueStatement',
  'ReturnStatement', 'ThrowStatement', 'YieldReturnStatement', 'YieldBreakStatement', 'WhileStatement', 'DoStatement', 'ForStatement', 'ForEachStatement', 'ForEachVariableStatement', 'UsingStatement', 'FixedStatement', 'CheckedStatement', 'UncheckedStatement',
  'UnsafeStatement', 'LockStatement', 'IfStatement', 'SwitchStatement', 'TryStatement']));
const lowerBound = (list, position) => { let low = 0, high = list.length; while (low < high) { const mid = (low + high) >> 1; if (list[mid].start < position) low = mid + 1; else high = mid; } return low; };
export class Blender {
  /**
   * `root` is the old red CompilationUnit; `diagnostics` and `features` are the old parser's (sorted by start);
   * `tokens` is the new TokenList and [start, end) the relexed window in the new text; `delta` the length change.
   */
  constructor({ root, diagnostics, features, tokens, start, end, delta }) { this.root = root; this.diagnostics = diagnostics; this.features = features; this.tokens = tokens; this.start = start; this.end = end; this.delta = delta; this.cursor = null; this.reused = 0; }
  /** The outermost old node of an accepted kind whose full span starts at old offset `position`. Consecutive siblings are found without descending again. */
  find(position, accept) {
    const cursor = this.cursor;
    if (cursor && cursor.end === position) {
      const next = cursor.siblings[cursor.index + 1];
      if (next && next.isNode && next.position === position && accept.has(next.kind)) { this.cursor = { siblings: cursor.siblings, index: cursor.index + 1, end: position + next.green.fullWidth, async: cursor.async }; return next; }
    }
    const root = this.root; if (position < 0 || position >= root.green.fullWidth) return null;
    const token = root.findToken(position); if (token.position !== position) return null;
    let best = null; for (let node = token.parent; node && node.position === position; node = node.parent) if (accept.has(node.kind)) best = node;
    if (!best || !best.parent) return null;
    const siblings = best.parent.childNodesAndTokens(); let low = 0, high = siblings.length - 1;
    while (low < high) { const mid = (low + high) >> 1; if (siblings[mid].position < position) low = mid + 1; else high = mid; }
    while (low < siblings.length && siblings[low] !== best) low++;
    this.cursor = { siblings, index: low, end: position + best.green.fullWidth, async: undefined }; return best;
  }
  hasDiagnostics(from, to) { const list = this.diagnostics, index = lowerBound(list, from); return index < list.length && list[index].start <= to; }
  /** Copies the old feature uses inside [from, to) to `out`, moved by `shift`. */
  carryFeatures(from, to, shift, out) {
    const list = this.features;
    for (let i = lowerBound(list, from); i < list.length && list[i].start < to; i++) { const use = list[i]; out.push(shift ? { id: use.id, start: use.start + shift, end: use.end + shift } : use); }
  }
  /** Whether `await` was a keyword where the old node was parsed: inside an async function, or at the top level. */
  asyncOf(node) {
    const cursor = this.cursor; if (cursor && cursor.siblings[cursor.index] === node && cursor.async !== undefined) return cursor.async;
    let result = true;
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (functions.has(parent.kind)) { result = parent.modifiers.some(m => m.kind === 'AsyncKeyword'); break; }
      if (containers.has(parent.kind)) { result = false; break; }
    }
    if (cursor && cursor.siblings[cursor.index] === node) cursor.async = result; return result;
  }
}
export const blenderMethods = {
  /**
   * Returns the old green node of an `accept`ed kind that starts at the cursor when it can be reused, and moves the
   * cursor past it; null otherwise. `context` is 'member' (with the enclosing type name), 'statement' or
   * 'namespace' (with whether the list is inside a namespace).
   */
  reuse(accept, context, owner) {
    const blend = this.blend; if (this.skippedTokens.length || this.depth > 100 || this.declarationContext > 0 || this.tupleContext) return null;
    const tokens = blend.tokens, position = tokens.leadAt(this.i); let old;
    if (position < blend.start) old = position; else if (position >= blend.end) old = position - blend.delta; else return null;
    const node = blend.find(old, accept); if (!node) return null;
    const green = node.green, width = green.fullWidth; if (!width || green.flags & dirty) return null;
    if (position < blend.start && position + width >= blend.start) return null;
    if (context === 'member') { const parent = node.parent; if (!containers.has(parent.kind) || parent.kind === 'EnumDeclaration' || parent.identifier?.valueText !== owner) return null; }
    else if (context === 'statement') { if (blend.asyncOf(node) !== this.inAsync) return null; }
    else { if ((node.parent.kind !== 'CompilationUnit') !== owner) return null; const first = this.tokens[this.i].kind; if (first === '[' || first === 'extern' || first === 'using') return null; }
    const next = tokens.indexAt(position + width); if (next <= this.i || tokens.leadAt(next) !== position + width) return null;
    // An error may be reported on the token after the node (the token the parser stopped at), so the clean range runs through that token's start.
    if (blend.hasDiagnostics(old, tokens.startAt(next) - position + old)) return null;
    blend.carryFeatures(old, old + width, position - old, this.features); this.i = next; blend.reused++; return green;
  }
};
