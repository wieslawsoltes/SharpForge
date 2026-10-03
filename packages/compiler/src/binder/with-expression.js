/**
 * `with` expressions (SF-A02-T08.7): `receiver with { Member = value, ... }` is a copy of the receiver in which the
 * named members are assigned. The receiver must be a record (copied by its copy constructor), a value of a struct
 * type (copied by value, C# 10) or an instance of an anonymous type (a new instance, C# 10). The assignments are
 * bound as an object initializer on the copy, which is what makes init-only members assignable here and nowhere else
 * outside construction.
 *
 * Bound node: `With {receiver, initializers: [{target, value}]}` of the receiver's type; the receiver of every
 * target is the `WithCopy` placeholder that stands for the copy.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { TypeKind } from '../symbols/types.js';

/** True for a type whose values `with` can copy. */
export function isWithReceiverType(type) {
  if (!type || type.isErrorType?.()) return false;
  if (type.typeKind === TypeKind.Struct || type.isAnonymousType) return true;
  return type.typeKind === TypeKind.Class && !!type.isRecord;
}

/** Class mixin: with expressions. */
export const WithBinding = Base =>
  class extends Base {
    withExpression(syntax) {
      const receiver = this.value(syntax.expression),
        type = receiver.type;
      if (receiver.hasErrors || !type) {
        this.initializerSilently(syntax.initializer);
        return this.bad(syntax);
      }
      if (!isWithReceiverType(type)) {
        this.report(syntax.expression, DiagnosticId.CS8858, [this.display(type)]);
        this.initializerSilently(syntax.initializer);
        return this.bad(syntax);
      }
      // C# 10: the receiver may be a struct value or an instance of an anonymous type (record structs are C# 10 themselves).
      if (type.isAnonymousType) this.d.gate(this.c.uri, syntax, 'WithOnAnonymousTypes');
      else if (type.typeKind === TypeKind.Struct) this.d.gate(this.c.uri, syntax, 'WithOnStructs');
      const copy = this.node('WithCopy', syntax.expression, type, {}),
        members = { kind: 'ObjectInitializerExpression', expressions: syntax.initializer.expressions },
        initialized = this.withInitializer(copy, members);
      return this.node('With', syntax, type, { receiver, initializers: initialized.initializers ?? [] });
    }
  };
