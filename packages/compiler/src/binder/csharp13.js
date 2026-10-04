/**
 * Attribute-driven rules of C# 13 (SF-A02-E11), run once the attributes are bound.
 *
 *   OverloadResolutionPriorityAttribute (SF-A02-T81): overload resolution reads the priority from the bound
 *   attribute (overload/params-collections.js `overloadPriority`). Here its placement is checked like Roslyn:
 *   CS9261 on an overriding member (the priority of the overridden member applies), CS9262 where it has no
 *   meaning: a property that is not an indexer, a static constructor, a destructor, a conversion operator and an
 *   explicit interface implementation.
 *
 * Below C# 13 the attribute itself is the gated construct (CS9202 and its siblings, on the attribute).
 */
import { SymbolKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { attributesNamed } from './bound-attributes.js';
import { overloadPriorityAttribute } from '../overload/params-collections.js';

/** The diagnostic code for the attribute on `member`, or null when it is allowed there. */
function priorityPlacementProblem(member) {
  if (member.isOverride) return 'CS9261';
  if (member.explicitInterfaceSyntax) return 'CS9262';
  if (member.kind === SymbolKind.Property) return member.isIndexer ? null : 'CS9262';
  if (member.kind !== SymbolKind.Method) return null;
  return [MethodKind.StaticConstructor, MethodKind.Destructor, MethodKind.Conversion].includes(member.methodKind) ? 'CS9262' : null;
}

/** Class mixin (analysis phase): the attribute-driven rules of C# 13. */
export const CSharp13Rules = Base =>
  class extends Base {
    bindAttributes() {
      super.bindAttributes();
      for (const type of this.assembly.types)
        for (const member of type.getMembers()) {
          const attribute = attributesNamed(member, overloadPriorityAttribute)[0];
          if (!attribute) continue;
          const uri = member.uri ?? member.locations?.[0]?.uri ?? this.files[0]?.source.uri;
          if (!this.gate(uri, attribute.syntax, 'OverloadResolutionPriority', { name: 'overload resolution priority', version: 13 })) continue;
          const code = priorityPlacementProblem(member);
          if (code) this.report(uri, attribute.syntax, code);
        }
    }
  };
