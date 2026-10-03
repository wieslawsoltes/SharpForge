/**
 * Tuples in the semantic model (SF-A02-T38): the two places where a query sees element names the bound tree does not
 * carry on a node.
 *
 *   - `pair.count` is bound to the field `Item1` (a name is another name of the element's field). A language service
 *     asks for the element as written: a field of the tuple type named `count`, as Roslyn has it.
 *   - `var (count, label) = pair` has the tuple type of its left side, whose element names are those of the variables.
 */
import { FieldSymbol } from '../symbols/members.js';
import { Accessibility } from '../symbols/types.js';
import { tupleElementIndex, tupleElements } from '../binder/tuples.js';

/** The element of a tuple a field access names, as a field of the tuple type with the element's name; else null. */
export function namedTupleElement(bound) {
  if (bound.kind !== 'FieldAccess') return null;
  const index = tupleElementIndex(bound.field),
    type = bound.receiver?.type,
    name = index >= 0 ? type?.tupleElementNames?.[index] : null,
    written = bound.syntax?.name?.identifier?.valueText ?? bound.syntax?.identifier?.valueText;
  if (!name || written !== name) return null;
  const fields = (type.namedElementFields ??= new Map());
  if (!fields.has(index)) {
    const init = { name, type: tupleElements(type)[index], containingSymbol: type, declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true };
    fields.set(index, Object.assign(new FieldSymbol(init), { tupleElementIndex: index }));
  }
  return fields.get(index);
}

/** The name the left side of a deconstruction gives one element: a declared variable or a named variable. */
function elementName(syntax) {
  const designation = syntax.kind === 'DeclarationExpression' ? syntax.designation : syntax;
  if (designation?.kind === 'SingleVariableDesignation') return designation.identifier.valueText;
  return designation?.kind === 'IdentifierName' ? designation.identifier.valueText : null;
}

/** The element names of the left side of a deconstruction assignment (`var (a, b)`, `(int a, var b)`, `(x, y)`), or null. */
export function deconstructionNames(left) {
  const designation = left?.kind === 'DeclarationExpression' ? left.designation : null,
    parts =
      designation?.kind === 'ParenthesizedVariableDesignation'
        ? designation.variables
        : left?.kind === 'TupleExpression'
          ? left.arguments.map(argument => argument.expression)
          : null,
    names = parts?.map(elementName).map(name => (name === '_' ? null : name));
  return names?.some(Boolean) ? names : null;
}

/** A tuple type with the element names of the left side of the deconstruction it is the type of. */
export function namedDeconstructionType(type, left) {
  const names = type?.isTupleType ? deconstructionNames(left) : null;
  return names && names.length === tupleElements(type).length ? type.withTupleElementNames(names) : type;
}
