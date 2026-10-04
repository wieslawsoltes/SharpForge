/**
 * Implementations an interface gives for members of its base interfaces (C# 8 default interface members):
 *
 *   interface IA { string Who() => "IA"; }
 *   interface IB : IA { string IA.Who() => "IB"; }        // the most specific implementation for a class that lists IB
 *   interface IC : IB { abstract string IA.Who(); }        // made abstract again
 *
 * The binder maps interface members to implementations for classes and structs only. In an interface every such
 * member is written explicitly (`IA.Who`), and the CLR knows what it implements from a MethodImpl row alone.
 */
import { TypeKind } from '../../symbols/types.js';
import { explicitlyImplementedMember } from '../../binder/interface-impl.js';

/**
 * @param type a source type
 * @returns {[object, object][]} `[declared, implementing]` member pairs of an interface; empty for any other type
 */
export function interfaceReimplementations(type) {
  if (type.typeKind !== TypeKind.Interface) return [];
  const pairs = [];
  for (const member of type.getMembers()) {
    const declared = explicitlyImplementedMember(member);
    if (declared) pairs.push([declared, member]);
  }
  return pairs;
}
