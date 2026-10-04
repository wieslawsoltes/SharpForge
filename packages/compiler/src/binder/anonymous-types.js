/**
 * Binding of anonymous object creation (SF-A02-T53): `new { Name = value, other.Member, local }`.
 *
 * Every member declarator gives a property: its name is written (`Name =`) or inferred from the expression, its type
 * is the type of the value. The bound node is `AnonymousObjectCreation { type, initializers: [{ property, value }] }`
 * with the values in source order, which is their evaluation order.
 *
 *   CS0746  a declarator without a name whose expression gives none (`new { 1 }`, `new { a + b }`)
 *   CS0828  a value without a type: null, a lambda, a method group, a void call
 *   CS0833  two members with the same name
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind } from '../symbols/types.js';
import { anonymousTypeOf, inferredMemberName } from '../symbols/synthesized/anonymous-types.js';

/** Class mixin for the body binder: anonymous object creation. */
export const AnonymousTypeBinding = Base =>
  class extends Base {
    anonymousObjectCreation(syntax) {
      const members = [],
        names = new Set();
      let hasErrors = false;
      for (const declarator of syntax.initializers) {
        const member = this.anonymousMember(declarator);
        if (!member) {
          hasErrors = true;
          continue;
        }
        if (names.has(member.name)) {
          this.report(declarator, DiagnosticId.CS0833);
          hasErrors = true;
          continue;
        }
        names.add(member.name);
        members.push(member);
      }
      if (hasErrors) return this.bad(syntax);
      const type = anonymousTypeOf(this.d, this.core, members),
        propertyNamed = name => type.getMembers(name).find(member => member.kind === SymbolKind.Property),
        initializers = members.map(member => ({ property: propertyNamed(member.name), value: member.value }));
      return this.node('AnonymousObjectCreation', syntax, type, { initializers });
    }
    /** One member declarator: `{ name, type, value }`, or null after reporting why it declares no property. */
    anonymousMember(declarator) {
      const expression = declarator.expression,
        name = declarator.nameEquals ? declarator.nameEquals.name.identifier.valueText : inferredMemberName(expression),
        value = this.value(expression);
      if (name === null) this.report(expression, DiagnosticId.CS0746);
      if (value.hasErrors) return null;
      const isVoid = value.type?.specialType === 'System_Void';
      if (!value.type || isVoid) {
        this.report(declarator, DiagnosticId.CS0828, [isVoid ? 'void' : this.operandDisplay(value)]);
        return null;
      }
      return name === null ? null : { name, type: value.type, value };
    }
  };
