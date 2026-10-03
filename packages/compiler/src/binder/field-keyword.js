/**
 * Binding of the C# 14 `field` keyword (SF-A02-T84): inside a property accessor, `field` is the synthesized
 * backing field of the property (symbols/source/field-keyword.js), read and written like any other field. The
 * bound node is `FieldAccess` on `this` (none for a static property), so flow analysis, nullable analysis and
 * lowering need nothing new.
 *
 *   CS9258 (warning)  a member named `field` is in scope: before C# 14 the name meant that member
 *   CS0103            `field` outside a property accessor (an indexer or event accessor, a method)
 *
 * The parser decides where `field` is the keyword: `@field`, a local named `field` (CS9273, reported by the
 * execution pipeline) and every use below C# 14 follow its rules, including the language-version gate.
 */
import { SymbolKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { lookupMembers } from './inheritance.js';

/** Binder mixin: the `field` keyword. */
export const FieldKeywordBinding = Base =>
  class extends Base {
    expression(syntax, options = {}) {
      return syntax.kind === 'FieldExpression' ? this.fieldKeyword(syntax) : super.expression(syntax, options);
    }
    fieldKeyword(syntax) {
      const accessor = this.rootBinder.c.method,
        isPropertyAccessor = accessor?.methodKind === MethodKind.PropertyGet || accessor?.methodKind === MethodKind.PropertySet,
        property = isPropertyAccessor ? accessor.associatedSymbol : null,
        backing = property && !property.isIndexer ? property.backingField : null;
      if (!backing) {
        this.report(syntax, 'CS0103', ['field']);
        return this.bad(syntax);
      }
      if (this.memberNamedField()) this.report(syntax, 'CS9258', [this.d.versionOf(this.c.uri).name ?? '14.0']);
      const receiver = backing.isStatic ? null : this.node('This', syntax, this.c.containingType, { isImplicit: true });
      return this.node('FieldAccess', syntax, backing.type, { field: backing, receiver });
    }
    /** True when a field, property or event named `field` is visible from the accessor (the pre-C# 14 meaning of the name). */
    memberNamedField() {
      for (let type = this.c.containingType; type; type = type.containingType) {
        const found = lookupMembers(type, 'field', this.core, { within: this.c.containingType }).members;
        if (found.some(member => member.kind !== SymbolKind.Method && member.kind !== SymbolKind.NamedType)) return true;
      }
      return false;
    }
  };
