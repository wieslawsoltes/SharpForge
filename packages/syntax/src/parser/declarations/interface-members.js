import { accessibilityModifiers } from '../modifiers.js';
/**
 * C# 8 member forms that reuse the ordinary member grammar: default interface members and readonly struct members.
 * An interface may declare members with bodies, modifiers, static members, fields, operators and nested types; the
 * grammar is that of a class member, so this module only records the feature where Roslyn reports it:
 *   - a member with a body, a field, an operator, a constructor or a nested type: at its name;
 *   - an accessor with a body: at the accessor keyword; an expression-bodied property: at the expression;
 *   - otherwise each modifier other than `new` and `unsafe` (accessibility counts once): at the member name, as the
 *     dedicated "modifier is not valid for this item" diagnostic.
 * `readonly` on a struct method, property, indexer, event or accessor is recorded at the modifier.
 */
const alwaysAllowed = new Set(['new', 'unsafe']);
const typeKeywords = new Set(['class', 'struct', 'interface', 'enum']);
export const interfaceMemberMethods = {
  inInterface() {
    return this.containerKind === 'InterfaceDeclaration';
  },
  /**
   * Records what a member needs. `nameToken` is where Roslyn reports it; `implemented` is true when the member has a
   * body or is of a kind interfaces could not declare before C# 8. The member's modifiers are the tokens from
   * memberModifiers to memberModifiersEnd (set by memberDeclaration).
   */
  memberForm(nameToken, implemented) {
    this.readonlyModifiers(this.memberModifiers, this.memberModifiersEnd);
    if (!this.inInterface()) return;
    if (implemented) this.feature('DefaultInterfaceImplementation', nameToken);
    else this.interfaceModifiers(nameToken);
  },
  /** One "modifier is not valid" use per modifier of a bodiless interface member. */
  interfaceModifiers(nameToken) {
    let accessibility = false;
    for (let i = this.memberModifiers; i < this.memberModifiersEnd; i++) {
      const kind = this.tokens[i].kind;
      if (alwaysAllowed.has(kind)) continue;
      if (accessibilityModifiers.has(kind)) {
        if (accessibility) continue;
        accessibility = true;
      }
      this.feature('DefaultInterfaceImplementation', nameToken, nameToken, this.tokens[i].text);
    }
  },
  /**
   * A property, indexer or event with accessors. `bodies` is the accessor-body count before its accessors were parsed
   * and `expression` the index of the first token of its expression body, or -1. Accessors with bodies have been
   * recorded already, so only a member without any body reports its modifiers.
   */
  accessorMemberForm(nameToken, bodies, expression) {
    this.readonlyModifiers(this.memberModifiers, this.memberModifiersEnd);
    if (!this.inInterface()) return;
    if (expression >= 0) {
      const semicolon = this.tokens[this.i - 1].kind === ';' ? 1 : 0;
      this.feature('DefaultInterfaceImplementation', this.tokens[expression], this.tokens[Math.max(expression, this.i - 1 - semicolon)]);
    } else if (this.accessorBodies === bodies) this.interfaceModifiers(nameToken);
  },
  /** A type declared inside an interface; the cursor is at its keyword (or at `delegate`). */
  interfaceNestedType() {
    if (!this.inInterface()) return;
    const kind = this.current.kind;
    if (typeKeywords.has(kind)) this.feature('DefaultInterfaceImplementation', this.peek());
    else if (kind === 'delegate') {
      const end = this.scanType(this.i + 1);
      if (end > 0) this.feature('DefaultInterfaceImplementation', this.tokens[end]);
    }
  },
  /** An accessor with a block or expression body; `keyword` is its lexer token. */
  accessorBody(keyword) {
    this.accessorBodies++;
    if (this.inInterface()) this.feature('DefaultInterfaceImplementation', keyword);
  },
  /** Records `readonly` among the modifier tokens [from, to) of a member or accessor (not of a field, where it is C# 1). */
  readonlyModifiers(from, to) {
    for (let i = from; i < to; i++) if (this.tokens[i].kind === 'readonly') this.feature('ReadOnlyMembers', this.tokens[i]);
  }
};
