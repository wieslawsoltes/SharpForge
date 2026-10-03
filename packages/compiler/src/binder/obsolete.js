/**
 * Uses of obsolete symbols (SF-A02-T41): CS0612 (`[Obsolete]`), CS0618 (`[Obsolete("message")]`, a warning) and CS0619
 * (`[Obsolete("message", true)]`, an error), for symbols declared in source and for imported ones.
 *
 * A use is recorded where the binder resolves a type name, a call, a constructor or a field, property or event; it is
 * reported once every declaration is bound, because a use inside a declaration that is itself obsolete (the member,
 * or a type containing it) is not reported, and that is only known when the attributes of all declarations are.
 */
import { SymbolKind } from '../symbols/types.js';
import { obsoleteDiagnostic } from '../metadata-import/attributes.js';

const spanOf = node => node.span ?? node;

/** The syntax whose extent is "inside" a source declaration: all parts of a type, the whole declaration of a member. */
function declarationSpans(symbol) {
  if (symbol.kind === SymbolKind.NamedType) return (symbol.declarations ?? []).map(d => ({ uri: d.uri, ...spanOf(d.syntax) }));
  const syntax = symbol.declarationSyntax ?? (symbol.isFieldLike ? symbol.syntax?.parent?.parent : symbol.syntax),
    uri = symbol.uri ?? symbol.locations?.[0]?.uri;
  return syntax && uri ? [{ uri, ...spanOf(syntax) }] : [];
}

/** Class mixin of the semantic analysis: recording and reporting uses of obsolete symbols. */
export const ObsoleteUses = Base =>
  class extends Base {
    /** Records a use of `symbol` at `node`; cheap for the common case of a symbol that carries no attributes. */
    noteUse(symbol, uri, node) {
      const definition = symbol?.originalDefinition ?? symbol;
      if (!definition || !node || (!definition.isSource && !definition.obsolete && !definition.syntax)) return;
      (this.symbolUses ??= []).push({ symbol: definition, uri, node });
    }
    /** Reports the recorded uses of symbols that turned out to be obsolete. */
    reportObsoleteUses() {
      const uses = this.symbolUses ?? [];
      if (!uses.some(use => use.symbol.obsolete)) return;
      const contexts = [];
      for (const type of this.assembly.types) {
        if (type.obsolete) contexts.push(...declarationSpans(type));
        for (const member of type.getMembers()) if (member.obsolete) contexts.push(...declarationSpans(member));
      }
      for (const { symbol, uri, node } of uses) {
        const found = obsoleteDiagnostic(symbol);
        if (!found) continue;
        const { start, end } = spanOf(node);
        if (contexts.some(context => context.uri === uri && context.start <= start && end <= context.end)) continue;
        this.report(uri, node, found.code, found.args);
      }
    }
  };
