/**
 * Implementations of static virtual interface members (SF-A02-T30).
 *
 * The binder's implementation map (`type.interfaceImplementations`) lists the members a type must implement. A static
 * virtual member with a body (`static virtual string Describe() { ... }`) need not be implemented, but a type that
 * declares a public static member of the same name and signature implements it (C# 11), and the CLR only knows that
 * from a MethodImpl row: static members are never matched by name.
 */
import { SymbolKind, TypeKind } from '../../symbols/types.js';

const isStaticVirtualWithBody = method => method.kind === SymbolKind.Method && method.isStatic && !!method.isVirtual && !method.isAbstract;

function sameSignature(declared, candidate) {
  if (candidate.kind !== SymbolKind.Method || !candidate.isStatic || candidate.parameters.length !== declared.parameters.length) return false;
  if ((candidate.typeParameters?.length ?? 0) !== (declared.typeParameters?.length ?? 0)) return false;
  if (!candidate.returnType.equals(declared.returnType)) return false;
  return candidate.parameters.every((parameter, index) => parameter.type.equals(declared.parameters[index].type));
}

/** Every interface of a type, with the interfaces those inherit. */
function allInterfacesOf(type) {
  const seen = [],
    visit = implemented => {
      if (seen.some(known => known.equals(implemented))) return;
      seen.push(implemented);
      for (const inherited of implemented.interfaces ?? []) visit(inherited);
    };
  for (const implemented of type.interfaces ?? []) visit(implemented);
  return seen;
}

/**
 * The static virtual interface members with a body that a type implements itself.
 * @param type a source class or struct
 * @returns {[object, object][]} `[declared, implementing]` method pairs; `declared` is a member of the constructed interface
 */
export function staticVirtualImplementations(type) {
  if (type.typeKind !== TypeKind.Class && type.typeKind !== TypeKind.Struct) return [];
  const pairs = [];
  for (const implemented of allInterfacesOf(type)) {
    for (const declared of implemented.getMembers().filter(isStaticVirtualWithBody)) {
      const implementing = type.getMembers(declared.name).find(candidate => sameSignature(declared, candidate));
      if (implementing) pairs.push([declared, implementing]);
    }
  }
  return pairs;
}
