import { BoundedCache } from '@sharpforge/text';
/**
 * Immutable, position-free green syntax: trivia, tokens (with leading and trailing trivia) and nodes.
 * Widths are UTF-16 lengths; a tree's full width always equals the length of the text it was parsed from.
 */
export const GreenFlags = Object.freeze({ None: 0, Missing: 1, ContainsDiagnostics: 2, ContainsSkippedText: 4, ContainsDirectives: 8, ContainsMissing: 16 });
const inherited = GreenFlags.ContainsDiagnostics | GreenFlags.ContainsSkippedText | GreenFlags.ContainsDirectives | GreenFlags.ContainsMissing, empty = Object.freeze([]);
let nextId = 1;
/**
 * A copy of a substring that does not keep the source text alive. Engines represent longer substrings as views of
 * their parent string, so a token kept across edits would otherwise retain every version of the document it was cut from.
 */
export const ownText = text => text.length < 13 ? text : (' ' + text).slice(1);
export class GreenTrivia {
  constructor(kind, text, structure = null) {
    this.kind = kind; this.text = text; this.structure = structure; this.fullWidth = text.length; this.id = nextId++; this.asList = Object.freeze([this]);
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
const caches = new WeakMap(), maxInternedChildren = 12, kindHashes = new Map();
const kindHash = kind => { let h = kindHashes.get(kind); if (h === undefined) kindHashes.set(kind, h = Math.imul(kindHashes.size + 1, 0x9E3779B1) | 0); return h; };
const sameItems = (a, b) => { if (a === b) return true; if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
/**
 * Structural interning of green elements: identical trivia and tokens, and nodes of up to twelve children with
 * identical children, are shared between trees and between parses that use the same workspace-owned BoundedCache.
 * Lookups use integer hashes of element ids (no key strings) and verify the candidate, so the cache is exact; it is
 * bounded by the store's limit and a colliding entry simply replaces the older one.
 */
export class GreenCache {
  constructor(store = new BoundedCache(65536)) { this.store = store; this.hits = 0; this.limit = Math.max(1024, store.limit ?? 65536); this.trivias = new Map(); this.tokens = new Map(); this.nodes = new Map(); this.missings = new Map(); }
  static for(store) { if (!store) return new GreenCache(); let cache = caches.get(store); if (!cache) caches.set(store, cache = new GreenCache(store)); return cache; }
  clear() { this.trivias.clear(); this.tokens.clear(); this.nodes.clear(); this.missings.clear(); }
  trivia(kind, text, structure = null) {
    if (structure) return new GreenTrivia(kind, text, structure);
    const map = this.trivias, found = map.get(text); if (found !== undefined) { if (found.kind === kind) { this.hits++; return found; } return new GreenTrivia(kind, text); }
    const value = new GreenTrivia(kind, text); if (map.size >= this.limit) map.clear(); map.set(text, value); return value;
  }
  triviaList(items) { return items.length ? items.length === 1 ? items[0].asList : Object.freeze(items) : empty; }
  token(kind, text, value, leading = empty, trailing = empty, flags = 0) {
    if (flags || leading.length > 3 || trailing.length > 3) return new GreenToken(kind, text, value, leading, trailing, flags);
    let h = kindHash(kind); const length = text.length, scan = length < 24 ? length : 24;
    for (let i = 0; i < scan; i++) h = Math.imul(h, 31) + text.charCodeAt(i) | 0;
    h = Math.imul(h, 31) + length | 0;
    for (let i = 0; i < leading.length; i++) h = Math.imul(h, 31) + leading[i].id | 0;
    h = Math.imul(h, 37) | 0; for (let i = 0; i < trailing.length; i++) h = Math.imul(h, 31) + trailing[i].id | 0;
    const map = this.tokens, found = map.get(h);
    if (found !== undefined && found.kind === kind && found.text === text && sameItems(found.leading, leading) && sameItems(found.trailing, trailing)) { this.hits++; return found; }
    const token = new GreenToken(kind, text, value, leading, trailing, flags); if (found === undefined && map.size >= this.limit) map.clear(); map.set(h, token); return token;
  }
  missing(kind, leading = empty) {
    if (leading.length) return new GreenToken(kind, '', undefined, leading, empty, GreenFlags.Missing);
    let token = this.missings.get(kind); if (token === undefined) this.missings.set(kind, token = new GreenToken(kind, '', undefined, empty, empty, GreenFlags.Missing)); else this.hits++; return token;
  }
  node(kind, children, flags = 0) {
    const count = children.length; if (flags || count > maxInternedChildren) return new GreenNode(kind, children, flags);
    let h = kindHash(kind);
    for (let i = 0; i < count; i++) { const child = children[i]; if (child === null) { h = Math.imul(h, 31) | 0; continue; } if (child.flags & (GreenFlags.ContainsDiagnostics | GreenFlags.ContainsSkippedText)) return new GreenNode(kind, children, flags); h = Math.imul(h, 31) + child.id | 0; }
    const map = this.nodes, found = map.get(h);
    if (found !== undefined && found.kind === kind && sameItems(found.children, children)) { this.hits++; return found; }
    const node = new GreenNode(kind, children, flags); if (found === undefined && map.size >= this.limit) map.clear(); map.set(h, node); return node;
  }
  list(items) { return items.length ? this.node('SyntaxList', items) : null; }
}
