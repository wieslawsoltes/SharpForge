/**
 * C# 10 rules that are not a construct family of their own (SF-A02-T75).
 *
 *   Constant interpolated strings are folded where interpolated strings are bound (./csharp6.js).
 *   Extended property patterns - `{ A.B: p }` is bound as `{ A: { B: p } }` (`propertySubpattern`).
 *   `[CallerArgumentExpression]` is bound and lowered with the other caller info attributes (./caller-info.js).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, ErrorTypeSymbol } from '../symbols/types.js';
import { lookupMembers } from './inheritance.js';
import { isSourceSymbol } from '../semantic/analysis-helpers.js';

const unknown = ErrorTypeSymbol.unknown;

/** The identifiers of `A` or `A.B.C` in a property pattern, outermost first; null for any other expression. */
function memberPath(expression) {
  const path = [];
  let node = expression;
  for (; node?.kind === 'SimpleMemberAccessExpression'; node = node.expression) {
    if (node.name?.kind !== 'IdentifierName') return null;
    path.unshift(node.name);
  }
  if (node?.kind !== 'IdentifierName') return null;
  path.unshift(node);
  return path;
}

/** Class mixin of the body binder: C# 10 expression rules. */
export const CSharp10Binding = Base =>
  class extends Base {
    /**
     * One `Name: pattern` of a property pattern. C# 10 allows a member path, `A.B: pattern`, which means
     * `A: { B: pattern }`: it is bound to exactly that nesting, so later passes see ordinary property patterns.
     * @returns {{member:object|null,pattern:object,syntax:object}}
     */
    propertySubpattern(sub, type) {
      const written = sub.expressionColon?.expression ?? sub.expressionColon?.name ?? sub.nameColon?.name,
        path = memberPath(written);
      if (written && !path) this.report(written, DiagnosticId.CS8918);
      const members = [];
      let current = type;
      for (const nameNode of path ?? []) {
        const member = current && !current.isErrorType() ? this.patternMember(current, nameNode) : null;
        if (!member) break;
        members.push(member);
        current = member.type;
      }
      const isComplete = !!path && members.length === path.length;
      let pattern = this.pattern(sub.pattern, isComplete ? current : unknown, null);
      for (let i = members.length - 1; i > 0 && isComplete; i--) {
        const inputType = members[i - 1].type;
        pattern = { kind: 'RecursivePattern', syntax: sub, inputType, properties: [{ member: members[i], pattern, syntax: sub }], positional: null };
      }
      return { member: isComplete ? members[0] : null, pattern, syntax: sub };
    }
    /** The field or property `nameNode` names in a value of `type`, or null after reporting why there is none. */
    patternMember(type, nameNode) {
      const name = nameNode.identifier.valueText,
        found = lookupMembers(type, name, this.core, { within: this.c.containingType }).members,
        member = found.find(m => m.kind === SymbolKind.Field || m.kind === SymbolKind.Property);
      if (member) {
        const definition = member.originalDefinition ?? member;
        if (member.kind === SymbolKind.Field) definition.reads = (definition.reads ?? 0) + 1;
        return member;
      }
      if (found.length) this.report(nameNode, DiagnosticId.CS0154, [name]);
      else if (isSourceSymbol(type) || type.specialType) this.report(nameNode, DiagnosticId.CS0117, [this.display(type), name]);
      else this.incomplete = this.d.incomplete = true;
      return null;
    }
  };
