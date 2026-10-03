import { greenText } from './green.js';
/**
 * Red facade: positioned, parent-linked views computed lazily over green nodes.
 * Lists are transparent, as in Roslyn: a list element's parent is the node that owns the list.
 */
const classes = new Map(), empty = Object.freeze([]);
/** Registers the node class (generated from the grammar) used for the given green kinds. */
export function registerNodeClass(kinds, type) { for (const kind of kinds) classes.set(kind, type); }
export class SyntaxTrivia {
  constructor(green, token, position) { this.green = green; this.token = token; this.position = position; }
  get kind() { return this.green.kind; }
  get text() { return this.green.text; }
  get structure() { return this.green.structure; }
  get span() { return { start: this.position, end: this.position + this.green.fullWidth }; }
  get fullSpan() { return this.span; }
  get isTrivia() { return true; }
  toString() { return this.green.text; }
  toFullString() { return this.green.text; }
}
export class SyntaxToken {
  constructor(green, parent, position) { this.green = green; this.parent = parent; this.position = position; }
  get kind() { return this.green.kind; }
  get text() { return this.green.text; }
  get value() { return this.green.value; }
  get valueText() { const v = this.green.value; return typeof v === 'string' ? v : this.green.text; }
  get isToken() { return true; }
  get isMissing() { return this.green.isMissing; }
  get fullSpan() { return { start: this.position, end: this.position + this.green.fullWidth }; }
  get spanStart() { return this.position + this.green.leadingWidth; }
  get span() { const start = this.position + this.green.leadingWidth; return { start, end: start + this.green.width }; }
  get leadingTrivia() { let at = this.position; return this.green.leading.map(t => { const trivia = new SyntaxTrivia(t, this, at); at += t.fullWidth; return trivia; }); }
  get trailingTrivia() { let at = this.position + this.green.leadingWidth + this.green.width; return this.green.trailing.map(t => { const trivia = new SyntaxTrivia(t, this, at); at += t.fullWidth; return trivia; }); }
  get hasLeadingTrivia() { return this.green.leading.length > 0; }
  get hasTrailingTrivia() { return this.green.trailing.length > 0; }
  toString() { return this.green.text; }
  toFullString() { return this.green.fullText; }
}
export class SyntaxNode {
  constructor(green, parent = null, position = 0) { this.green = green; this.parent = parent; this.position = position; this._slots = null; this._children = null; }
  get kind() { return this.green.kind; }
  get isNode() { return true; }
  get fullSpan() { return { start: this.position, end: this.position + this.green.fullWidth }; }
  get spanStart() { return this.position + this.green.leadingWidth; }
  get span() { return { start: this.position + this.green.leadingWidth, end: this.position + this.green.fullWidth - this.green.trailingWidth }; }
  get containsDiagnostics() { return this.green.containsDiagnostics; }
  get root() { let node = this; while (node.parent) node = node.parent; return node; }
  _build() {
    const slots = [], children = []; let at = this.position;
    const wrap = green => { const red = green.isToken ? new SyntaxToken(green, this, at) : createNode(green, this, at); at += green.fullWidth; children.push(red); return red; };
    for (const child of this.green.children) {
      if (!child) slots.push(null);
      else if (child.isNode && child.isList) slots.push(Object.freeze(child.children.map(wrap)));
      else slots.push(wrap(child));
    }
    this._slots = slots; this._children = Object.freeze(children);
  }
  /** The red child in grammar slot `index`: a node, a token, an array (list slot) or null. */
  slot(index) { if (!this._slots) this._build(); return this._slots[index]; }
  /** List slot contents; `separated` drops the separator tokens. */
  list(index, separated = false) { const items = this.slot(index); return !items ? empty : separated ? items.filter((_, i) => i % 2 === 0) : items; }
  separators(index) { const items = this.slot(index); return items ? items.filter((_, i) => i % 2 === 1) : empty; }
  childNodesAndTokens() { if (!this._children) this._build(); return this._children; }
  childNodes() { return this.childNodesAndTokens().filter(c => c.isNode); }
  childTokens() { return this.childNodesAndTokens().filter(c => c.isToken); }
  *ancestors() { for (let node = this.parent; node; node = node.parent) yield node; }
  *descendantNodesAndTokens(includeSelf = false) {
    const stack = includeSelf ? [this] : [...this.childNodesAndTokens()].reverse();
    while (stack.length) { const item = stack.pop(); yield item; if (item.isNode) { const children = item.childNodesAndTokens(); for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]); } }
  }
  *descendantNodes(includeSelf = false) { for (const item of this.descendantNodesAndTokens(includeSelf)) if (item.isNode) yield item; }
  *descendantTokens() { for (const item of this.descendantNodesAndTokens()) if (item.isToken) yield item; }
  firstToken() { let node = this; for (;;) { const child = node.childNodesAndTokens()[0]; if (!child) return null; if (child.isToken) return child; node = child; } }
  lastToken() { let node = this; for (;;) { const child = node.childNodesAndTokens().at(-1); if (!child) return null; if (child.isToken) return child; node = child; } }
  /** The token whose full span contains `position`; the last token (end of file) when position equals the end. */
  findToken(position) {
    const end = this.position + this.green.fullWidth;
    if (position < this.position || position > end) throw new RangeError('Position is outside the node');
    if (position === end) return this.lastToken();
    let node = this;
    for (;;) {
      const children = node.childNodesAndTokens(); let low = 0, high = children.length - 1;
      while (low < high) { const mid = (low + high + 1) >>> 1; if (children[mid].position <= position) low = mid; else high = mid - 1; }
      while (low > 0 && children[low].green.fullWidth === 0) low--;
      let child = children[low];
      while (child.position + child.green.fullWidth <= position) child = children[++low];
      if (child.isToken) return child; node = child;
    }
  }
  /** The innermost node whose full span contains [start, end). */
  findNode(start, end = start) { let node = this.findToken(Math.min(start, this.position + this.green.fullWidth)).parent; while (node.parent && (node.position > start || node.position + node.green.fullWidth < end)) node = node.parent; return node; }
  /** Returns a detached copy of this node with the child in `index` replaced (a node, token, list array or null). */
  withSlot(index, value) {
    const children = [...this.green.children], unwrap = v => v && v.green ? v.green : v;
    children[index] = Array.isArray(value) ? (value.length ? new this.green.constructor('SyntaxList', value.map(unwrap)) : null) : unwrap(value) ?? null;
    return createNode(new this.green.constructor(this.green.kind, children), null, 0);
  }
  toString() { const text = greenText(this.green); return text.slice(this.green.leadingWidth, text.length - this.green.trailingWidth); }
  toFullString() { return greenText(this.green); }
}
/** Creates the red node for a green node, using the generated class for its kind when one is registered. */
export function createNode(green, parent = null, position = 0) { const type = classes.get(green.kind) ?? SyntaxNode; return new type(green, parent, position); }
