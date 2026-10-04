/**
 * Accessors and operators named by their metadata name (`get_X`, `set_Item`, `add_Changed`, `op_Addition`).
 *
 * Such a method exists in metadata but is not a member a C# program can name: Roslyn reports CS0571 where one is
 * called or converted. Lookup does not find accessors (they are not members of the type), so the binder asks here
 * before it reports the name as missing.
 */
import { SymbolKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { indexerNameOf } from './members/indexer-names.js';

const accessorPrefixes = [
  ['get_', SymbolKind.Property, property => property.getMethod],
  ['set_', SymbolKind.Property, property => property.setMethod],
  ['add_', SymbolKind.Event, event => event.addMethod ?? event],
  ['remove_', SymbolKind.Event, event => event.removeMethod ?? event],
];
const accessorSuffix = { get_: 'get', set_: 'set', add_: 'add', remove_: 'remove' };

/** True for a user-defined operator or conversion method. */
export function isOperatorMethod(method) {
  return method.methodKind === MethodKind.UserDefinedOperator || method.methodKind === MethodKind.Conversion;
}

/**
 * The accessor of `type` (or of a base type) whose metadata name is `name`.
 * @param type the type the name was looked up in  @param {string} name the name the program wrote
 * @param {(type:object,name:string)=>object[]} membersNamed members of `type` and its bases with a given name
 * @returns {null|string} the display text of the accessor for CS0571 (`C.X.set`), or null when there is none
 */
export function accessorNamed(type, name, membersNamed) {
  for (const [prefix, kind, accessorOf] of accessorPrefixes) {
    if (!name.startsWith(prefix) || name.length === prefix.length) continue;
    const memberName = name.slice(prefix.length),
      named = m => m.kind === kind && accessorOf(m),
      // An indexer is found by its metadata name: `Item`, or the one `[IndexerName]` gives.
      indexer = kind === SymbolKind.Property ? membersNamed(type, 'this[]').find(m => named(m) && indexerNameOf(m) === memberName) : null;
    const owner = indexer ?? membersNamed(type, memberName).find(named);
    if (!owner) continue;
    const accessor = accessorOf(owner);
    return accessor.kind === SymbolKind.Method ? accessor.toDisplayString() : owner.toDisplayString() + '.' + accessorSuffix[prefix];
  }
  return null;
}
