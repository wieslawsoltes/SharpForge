import { declarationModifiers } from '../modifiers.js';
import { contextualKeywordKinds } from '../../lexer/keywords.js';
/** Attribute sections on every declaration kind, with targets (assembly, module, field, event, method, param, property, return, type, typevar) and named arguments. */
const targets = new Set(['assembly', 'module', 'field', 'method', 'param', 'property', 'type', 'typevar']), typeKeywords = ['class', 'struct', 'interface', 'enum', 'delegate', 'event', 'namespace', 'const', 'implicit', 'explicit', 'void'];
export const attributeMethods = {
  /** Index of the bracket closing the one at `i`, or -1. */
  matchingBracket(i) {
    let depth = 0;
    for (let guard = 0; guard < 4096; guard++, i++) { const kind = this.kindAt(i); if (kind === 'eof') return -1; if ('([{'.includes(kind) && kind.length === 1) depth++; else if (')]}'.includes(kind) && kind.length === 1 && --depth === 0) return i; }
    return -1;
  },
  /** At statement level `[` starts attribute lists only when a declaration follows the closing bracket (otherwise it is a collection expression). */
  isAttributeListAhead(i = this.i) {
    if (this.kindAt(i) !== '[') return false;
    const first = this.tokens[i + 1]; if ((this.isId(first) || first.kind === 'return' || first.kind === 'event') && this.kindAt(i + 2) === ':') return true;
    for (;;) { const close = this.matchingBracket(i); if (close < 0) return false; i = close + 1; if (this.kindAt(i) !== '[') break; }
    const token = this.tokens[i]; return declarationModifiers.has(token.kind) && token.kind !== 'new' || typeKeywords.includes(token.kind) || this.isPredefined(token) || this.isId(token);
  },
  attributeLists() { const lists = []; while (this.at('[')) lists.push(this.attributeList()); return lists; },
  attributeList() {
    const open = this.take(), attributes = []; let target = null;
    if ((this.isId() || this.atAny(['return', 'event'])) && this.peek().kind === ':') { const word = this.current.value; target = this.n('AttributeTargetSpecifier', targets.has(word) && this.isId() ? this.take(contextualKeywordKinds[word]) : this.take(), this.take()); }
    while (!this.at(']') && !this.at('eof')) {
      const before = this.i; attributes.push(this.n('Attribute', this.name(), this.at('(') ? this.attributeArgumentList() : null));
      if (this.at(',')) attributes.push(this.take()); else break; if (before === this.i) break;
    }
    return this.n('AttributeList', open, target, attributes, this.expect(']'));
  },
  attributeArgumentList() {
    const open = this.take(), args = [];
    while (!this.at(')') && !this.at('eof')) {
      const before = this.i; let nameEquals = null, nameColon = null;
      if (this.isId() && this.peek().kind === '=') nameEquals = this.n('NameEquals', this.n('IdentifierName', this.id()), this.take());
      else if (this.isId() && this.peek().kind === ':') nameColon = this.n('NameColon', this.n('IdentifierName', this.id()), this.take());
      args.push(this.n('AttributeArgument', nameEquals, nameColon, this.expression()));
      if (this.at(',')) args.push(this.take()); else break; if (before === this.i) break;
    }
    return this.n('AttributeArgumentList', open, args, this.expect(')'));
  }
};
