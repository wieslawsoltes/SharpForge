import { GreenNode, GreenToken } from './green.js';
import { createNode } from './red.js';
/** Visitor, walker and rewriter over the red tree. */
export const SyntaxWalkerDepth = Object.freeze({ Node: 0, Token: 1, Trivia: 2 });
/** Dispatches to `visit<Kind>(node)` when defined, otherwise to `defaultVisit(node)`. */
export class SyntaxVisitor {
  visit(node) { if (!node) return undefined; const method = this['visit' + node.kind]; return typeof method === 'function' ? method.call(this, node) : this.defaultVisit(node); }
  defaultVisit() { return undefined; }
}
/** Depth-first traversal in source order. `depth` selects how far down to go: nodes only, tokens, or trivia. */
export class SyntaxWalker extends SyntaxVisitor {
  constructor(depth = SyntaxWalkerDepth.Node) { super(); this.depth = depth; }
  /** Iterative walk, so deeply nested trees cannot overflow the stack. Override visitNode / visitToken / visitTrivia. */
  walk(root) {
    const stack = [root];
    while (stack.length) {
      const item = stack.pop();
      if (item.isToken) { if (this.depth >= SyntaxWalkerDepth.Token) this.token(item); continue; }
      if (this.visit(item) === false) continue;
      const children = item.childNodesAndTokens(); for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }
  token(token) {
    if (this.depth >= SyntaxWalkerDepth.Trivia) for (const trivia of token.leadingTrivia) this.visitTrivia(trivia);
    this.visitToken(token);
    if (this.depth >= SyntaxWalkerDepth.Trivia) for (const trivia of token.trailingTrivia) this.visitTrivia(trivia);
  }
  defaultVisit(node) { return this.visitNode(node); }
  /** Called for every node without a kind-specific method; return false to skip its children. */
  visitNode() { return true; }
  visitToken() {}
  visitTrivia() {}
}
/**
 * Rebuilds a tree bottom-up. Override `visit<Kind>(node)`, `visitNode(node)` or `visitToken(token)` and return a
 * replacement (red or green), the same element to keep it, or null to remove it from a list or optional slot.
 * Untouched subtrees keep their green nodes, so an identity rewrite returns the same green root.
 */
export class SyntaxRewriter {
  /** Returns the rewritten root as a detached red node (the input node itself when nothing changed). */
  rewrite(root) { const green = this.rewriteGreen(root); return green === root.green ? root : green ? createNode(green, null, 0) : null; }
  visitNode(node) { return node; }
  visitToken(token) { return token; }
  rewriteGreen(red) {
    if (red.isToken) { const result = this.visitToken(red); return result ? result.green ?? result : null; }
    const green = red.green, children = green.children; let changed = null;
    const elements = red.childNodesAndTokens(); let cursor = 0;
    const one = child => { const element = elements[cursor++]; const result = this.rewriteGreen(element); return result; };
    for (let i = 0; i < children.length; i++) {
      const child = children[i]; let replacement = child;
      if (child && child.isNode && child.isList) {
        let items = null;
        for (let k = 0; k < child.children.length; k++) { const result = one(child.children[k]); if (result !== child.children[k] && !items) items = child.children.slice(0, k); if (items && result) items.push(result); }
        if (items) replacement = items.length ? new GreenNode('SyntaxList', items) : null;
      } else if (child) replacement = one(child);
      if (replacement !== child) { changed ??= [...children]; changed[i] = replacement; }
    }
    const rebuilt = changed ? createNode(new GreenNode(green.kind, changed), null, 0) : red, method = this['visit' + green.kind];
    const result = typeof method === 'function' ? method.call(this, rebuilt) : this.visitNode(rebuilt);
    return result ? result.green ?? result : null;
  }
}
/** Creates a token for use in rewrites; `leading` and `trailing` are GreenTrivia arrays. */
export function greenToken(kind, text, value, leading = [], trailing = []) { return new GreenToken(kind, text, value, Object.freeze(leading), Object.freeze(trailing)); }
