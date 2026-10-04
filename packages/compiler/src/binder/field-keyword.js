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
 * execution pipeline) and every use below C# 14 follow its rules. Below C# 14 `field` is an ordinary name: it binds
 * to a member named `field` or is CS0103, as in Roslyn; only an accessor without a body next to one with a body
 * needs the feature (CS9260 on the property name).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { lookupMembers } from './inheritance.js';

const skippedKeys = new Set(['source', 'tokens', 'symbol']);

/**
 * The nodes of a tree of the string-typed profile that `matches` accepts, in tree order. The profile does not bind
 * the `field` keyword itself: `Compilation.property` recognises a field-backed property with `reportFieldKeywordUses`
 * and leaves the program to the semantic pipeline, where the binding below is the only implementation.
 */
function collect(node, matches, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const item of node) collect(item, matches, found);
    return found;
  }
  if (matches(node)) found.push(node);
  for (const [key, value] of Object.entries(node)) if (!skippedKeys.has(key)) collect(value, matches, found);
  return found;
}
/**
 * The `field` keyword in a property of the profile's tree. `field` is the keyword from C# 14 on; below, it is an
 * ordinary name. Each use is reported as outside the profile (SF2098) and each local named `field` in an accessor
 * as CS9273.
 * @param node the property  @param version the selected language version `{number, name}`
 * @param {(node: object, code: string, args: any[]) => void} report
 * @returns {boolean} true when the property is field-backed
 */
export function reportFieldKeywordUses(node, version, report) {
  if (version.number < 14) return false;
  const bodies = node.accessors.map(accessor => accessor.body),
    uses = collect(bodies, candidate => candidate.kind === 'Name' && candidate.name === 'field' && !candidate.escaped);
  for (const use of uses) report(use, DiagnosticId.SF2098, ['field']);
  for (const local of collect(bodies, candidate => candidate.kind === 'Variable' && candidate.name === 'field')) report(local, DiagnosticId.CS9273, [version.name]);
  return uses.length > 0;
}

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
        this.report(syntax, DiagnosticId.CS0103, ['field']);
        return this.bad(syntax);
      }
      if (this.memberNamedField()) this.report(syntax, DiagnosticId.CS9258, [this.d.versionOf(this.c.uri).name ?? '14.0']);
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
