/**
 * Nullable annotations of framework members (SF-A02-T05.4).
 *
 * The framework registry describes members without nullable annotations, so every framework result would count as
 * not null. The .NET reference assemblies annotate some results as `T?`; the ones listed here are read as possibly
 * null by the flow walker (`string t = o.ToString();` is CS8600, as with Roslyn). A member is looked up by the name of
 * its declaring type and its own name, and only when it has no source declaration: an override in the program
 * (`public override string ToString()`) is a different symbol with the annotation it declares.
 *
 * The list is the annotated results of the members the registry has or is expected to get; a member that is not
 * listed keeps the oblivious, not-null reading.
 */
import { MAYBE_NULL, NOT_NULL } from './flow-state.js';
import { NullableAnnotation, SymbolKind } from '../symbols/types.js';

const maybeNullResults = new Set([
  'Object.ToString',
  'Exception.StackTrace',
  'Exception.InnerException',
  'Environment.GetEnvironmentVariable',
  'Console.ReadLine',
  'TextReader.ReadLine',
  'StreamReader.ReadLine',
  'Path.GetDirectoryName',
  'Type.GetType',
  'Activator.CreateInstance',
  'Enumerable.FirstOrDefault',
  'Enumerable.LastOrDefault',
  'Enumerable.SingleOrDefault',
  'Enumerable.ElementAtOrDefault',
  'List.Find',
  'List.FindLast',
]);

const isDeclaredInSource = symbol => !!(symbol.declarationSyntax ?? symbol.syntax) || (symbol.locations?.length ?? 0) > 0;

/**
 * `receiver.ToString()` binds to Object.ToString, but the method that runs is the override of the receiver's type.
 * Object.ToString and ValueType.ToString return `string?`; an override declared in the program has the annotation it
 * declares; the overrides of other framework types (Int32, String, Exception ...) return `string`.
 */
function toStringState(receiverType) {
  for (let type = receiverType; type; type = type.baseType) {
    if (type.specialType === 'System_Object' || type.specialType === 'System_ValueType') return MAYBE_NULL;
    if (!isDeclaredInSource(type)) return NOT_NULL;
    const override = type.getMembers?.('ToString').find(member => member.kind === SymbolKind.Method && member.parameters.length === 0);
    if (override) return override.returnTypeWithAnnotations?.nullableAnnotation === NullableAnnotation.Annotated ? MAYBE_NULL : NOT_NULL;
  }
  // An interface or a type parameter: nothing is known about the object behind it.
  return MAYBE_NULL;
}

/**
 * The null-state the reference assemblies give the result of a framework method or property.
 * @param member the method or property that was bound
 * @param [receiverType] the static type of the receiver of the call or access
 * @returns {'maybeNull'|'notNull'|null} null when the member is declared in source or nothing is recorded for it
 */
export function frameworkResultState(member, receiverType = null) {
  const definition = member?.originalDefinition ?? member,
    owner = definition?.containingType?.originalDefinition ?? definition?.containingType;
  if (!definition || !owner || isDeclaredInSource(definition)) return null;
  const key = `${owner.name}.${definition.name}`;
  if (key === 'Object.ToString' && receiverType) return toStringState(receiverType);
  return maybeNullResults.has(key) ? MAYBE_NULL : null;
}
