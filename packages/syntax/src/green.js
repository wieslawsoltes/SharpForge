import { BoundedCache } from '@sharpforge/text';
/**
 * Immutable, position-free green syntax: trivia, tokens (with leading and trailing trivia) and nodes.
 * Widths are UTF-16 lengths; a tree's full width always equals the length of the text it was parsed from.
 */
export const GreenFlags = Object.freeze({ None: 0, Missing: 1, ContainsDiagnostics: 2, ContainsSkippedText: 4, ContainsDirectives: 8, ContainsMissing: 16 });
const inherited = GreenFlags.ContainsDiagnostics | GreenFlags.ContainsSkippedText | GreenFlags.ContainsDirectives | GreenFlags.ContainsMissing, empty = Object.freeze([]);
let nextId = 1;
export class GreenTrivia {
  constructor(kind, text, structure = null) {
    this.kind = kind; this.text = text; this.structure = structure; this.fullWidth = text.length; this.id = nextId++;
    this.flags = kind === 'SkippedTokensTrivia' ? GreenFlags.ContainsSkippedText : structure || kind === 'DisabledTextTrivia' ? GreenFlags.ContainsDirectives : 0;
    Object.freeze(this);
  }
  get isTrivia() { return true; }
  get fullText() { return this.text; }
}
const widthOf = list => { let n = 0; for (const item of list) n += item.fullWidth; return n; }, flagsOf = list => { let f = 0; for (const item of list) f |= item.flags; return f; };
export class GreenToken {
  constructor(kind, text, value, leading = empty, trailing = empty, flags = 0) {
    this.kind = kind; this.text = text; this.value = value; this.leading = leading; this.trailing = trailing;
    this.width = text.length; this.leadingWidth = widthOf(leading); this.trailingWidth = widthOf(trailing); this.fullWidth = this.leadingWidth + this.width + this.trailingWidth;
    this.flags = flags | (flags & GreenFlags.Missing ? GreenFlags.ContainsMissing : 0) | flagsOf(leading) | flagsOf(trailing); this.id = nextId++;
    Object.freeze(this);
  }
  get isToken() { return true; }
  get isMissing() { return (this.flags & GreenFlags.Missing) !== 0; }
  get fullText() { let s = ''; for (const t of this.leading) s += t.text; s += this.text; for (const t of this.trailing) s += t.text; return s; }
}
export class GreenNode {
  /** `children` holds GreenNode, GreenToken or null (absent optional child / empty list) in grammar slot order. */
  constructor(kind, children, flags = 0) {
    this.kind = kind; this.children = Object.freeze(children); let width = 0, first = null, last = null;
    for (const child of children) if (child) { width += child.fullWidth; flags |= child.flags & inherited; first ??= child; last = child; }
    this.fullWidth = width; this.flags = flags; this.leadingWidth = first ? first.leadingWidth : 0; this.trailingWidth = last ? last.trailingWidth : 0; this.id = nextId++;
    Object.freeze(this);
  }
  get isNode() { return true; }
  get isList() { return this.kind === 'SyntaxList'; }
  get containsDiagnostics() { return (this.flags & GreenFlags.ContainsDiagnostics) !== 0; }
  get fullText() { return greenText(this); }
}
/** Concatenates the full text of a green element without recursion (deep trees are common in generated code). */
export function greenText(root) {
  if (!root) return ''; if (!root.isNode) return root.fullText;
  const parts = [], stack = [root];
  while (stack.length) {
    const item = stack.pop();
    if (item.isNode) { for (let i = item.children.length - 1; i >= 0; i--) if (item.children[i]) stack.push(item.children[i]); }
    else { for (const t of item.leading) parts.push(t.text); parts.push(item.text); for (const t of item.trailing) parts.push(t.text); }
  }
  return parts.join('');
}
/** The frozen token view kept for editor consumers: every trivia character between two tokens is `leading`. */
export function legacyGreenToken(kind, text, leading, value) { return Object.freeze({ kind, text, leading, width: leading.length + text.length, fullText: leading + text, value }); }
const caches = new WeakMap(), maxInternedChildren = 12;
/**
 * Structural interning of green elements on top of a workspace-owned BoundedCache: identical trivia and tokens,
 * and diagnostic-free nodes of up to twelve children with identical children, are shared between trees and between
 * parses - so after an edit every statement and member whose tokens did not change is reused by identity.
 */
export class GreenCache {
  constructor(store = new BoundedCache(65536)) { this.store = store; this.hits = 0; }
  static for(store) { if (!store) return new GreenCache(); let cache = caches.get(store); if (!cache) caches.set(store, cache = new GreenCache(store)); return cache; }
  intern(key, factory) {
    const map = this.store.map, found = map.get(key); if (found !== undefined) { this.hits++; return found; }
    const value = factory(); map.set(key, value); if (map.size > this.store.limit) map.delete(map.keys().next().value); return value;
  }
  trivia(kind, text, structure = null) { return structure ? new GreenTrivia(kind, text, structure) : this.intern('t\0' + kind + '\0' + text, () => new GreenTrivia(kind, text)); }
  triviaList(items) { return items.length ? items.length === 1 ? this.intern('l\0' + items[0].id, () => Object.freeze([items[0]])) : Object.freeze(items) : empty; }
  token(kind, text, value, leading = empty, trailing = empty, flags = 0) {
    if (flags || leading.length > 3 || trailing.length > 3) return new GreenToken(kind, text, value, leading, trailing, flags);
    let key = 'k\0' + kind + '\0' + text; for (const t of leading) key += '\0' + t.id; key += '\0|'; for (const t of trailing) key += '\0' + t.id;
    return this.intern(key, () => new GreenToken(kind, text, value, leading, trailing, flags));
  }
  missing(kind, leading = empty) { return leading.length ? new GreenToken(kind, '', undefined, leading, empty, GreenFlags.Missing) : this.intern('m\0' + kind, () => new GreenToken(kind, '', undefined, empty, empty, GreenFlags.Missing)); }
  node(kind, children, flags = 0) {
    if (flags || children.length > maxInternedChildren) return new GreenNode(kind, children, flags);
    let key = 'n\0' + kind; for (const child of children) { if (child && child.flags & (GreenFlags.ContainsDiagnostics | GreenFlags.ContainsSkippedText)) return new GreenNode(kind, children, flags); key += '\0' + (child ? child.id : 0); }
    return this.intern(key, () => new GreenNode(kind, children, flags));
  }
  list(items) { return items.length ? this.node('SyntaxList', items) : null; }
}
