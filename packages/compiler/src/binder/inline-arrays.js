/**
 * Uses of inline arrays (C# 12, SF-A02-T80). A struct marked `[InlineArray(n)]` with one instance field stores `n`
 * elements of that field's type; the declaration rules are in ./csharp12.js. Here:
 *
 *   element access  `buffer[i]` with one argument that converts implicitly to `int` (CS9172 otherwise); a constant
 *                   index outside `0 .. n-1` is CS9166. The element is a variable exactly when the buffer is one, and
 *                   read-only when the buffer is.
 *   foreach         enumerates the elements.
 *
 * Every use needs C# 12 (the language-version gate 'inline arrays'). Nothing here is executable: the runtime has no
 * struct storage, so code generation reports the struct.
 *
 * Not bound: indexing with `System.Index` or `System.Range`, and the conversions to `Span<T>` and `ReadOnlySpan<T>`.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind } from '../symbols/types.js';
import { attributesNamed } from './bound-attributes.js';

const inlineArrayAttribute = 'System.Runtime.CompilerServices.InlineArrayAttribute';

/**
 * The element type and length of an inline array type.
 * @returns {{elementType: object, length: number|null}|null} null when `type` is not a well-formed inline array
 */
export function inlineArrayShape(type) {
  const definition = type?.originalDefinition ?? type;
  if (!definition || definition.typeKind !== TypeKind.Struct || !definition.isSource) return null;
  const attribute = attributesNamed(definition, inlineArrayAttribute)[0];
  if (!attribute) return null;
  const fields = type.getMembers().filter(member => member.kind === SymbolKind.Field && !member.isStatic && !member.isImplicitlyDeclared);
  if (fields.length !== 1) return null;
  const length = attribute.arguments[0]?.constantValue?.value;
  return { elementType: fields[0].type, length: typeof length === 'number' ? length : null };
}

/** Class mixin of the body binder: element access on inline arrays. */
export const InlineArrayBinding = Base =>
  class extends Base {
    elementAccessOn(target, args, syntax) {
      const shape = target.hasErrors ? null : inlineArrayShape(target.type);
      if (!shape) return super.elementAccessOn(target, args, syntax);
      if (args.some(argument => argument.hasErrors)) return this.bad(syntax);
      this.d.gate(this.c.uri, syntax, 'InlineArrays');
      // The elements are the storage of the field that holds the array: it is not "never assigned" (as in Roslyn).
      if (target.kind === 'FieldAccess') this.markWrite(target, null);
      const conversion = args.length === 1 ? this.conversions.classifyFromExpression(args[0], this.core.int) : null;
      if (!conversion?.exists || !conversion.isImplicit) {
        this.report(syntax, DiagnosticId.CS9172);
        return this.bad(syntax);
      }
      const index = this.applyConversion(args[0], this.core.int, conversion),
        constant = index.constantValue?.value;
      if (typeof constant === 'number' && shape.length !== null && (constant < 0 || constant >= shape.length)) {
        this.report(args[0].syntax, DiagnosticId.CS9166);
        return this.bad(syntax);
      }
      return this.node('InlineArrayAccess', syntax, shape.elementType, { receiver: target, index });
    }
  };
