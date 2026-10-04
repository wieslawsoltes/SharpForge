/**
 * The `AttributeUsage` an attribute class read from metadata declares: where it may be applied (CS0592), whether it
 * may be repeated (CS0579) and whether derived declarations inherit it.
 */
import { PEAssemblySymbol } from './pe-symbols.js';

const ATTRIBUTE_USAGE = 'System.AttributeUsageAttribute';

/** True for a type symbol the importer created. */
export const isImportedType = type => type?.containingAssembly instanceof PEAssemblySymbol;

/**
 * @param type an imported attribute class (a definition)
 * @returns {{validOn: number, allowMultiple: boolean, inherited: boolean}|null} null when the class declares no
 *   usage itself (its base class decides) or the attribute cannot be decoded
 */
export function importedAttributeUsage(type) {
  const applied = type.attributes?.find(attribute => attribute.attributeClassName === ATTRIBUTE_USAGE);
  if (!applied || applied.hasErrors || !applied.constructorArguments.length) return null;
  const named = name => applied.namedArguments.find(argument => argument.name === name)?.value?.value;
  return Object.freeze({
    validOn: Number(applied.constructorArguments[0].value),
    allowMultiple: named('AllowMultiple') === true,
    inherited: named('Inherited') !== false,
  });
}
