/**
 * Implementations of static virtual interface members (SF-A02-T30).
 *
 * The binder's implementation map (`type.interfaceImplementations`) lists the members a type must implement. A static
 * virtual member with a body (`static virtual string Describe() { ... }`) need not be implemented, but a type that
 * declares a public static member of the same name and signature implements it (C# 11), and the CLR only knows that
 * from a MethodImpl row: static members are never matched by name.
 */
import { SymbolKind, TypeKind } from '../../symbols/types.js';

const IMPLEMENTABLE_KINDS = new Set([SymbolKind.Method, SymbolKind.Property, SymbolKind.Event]);

const isStaticVirtualWithBody = member => IMPLEMENTABLE_KINDS.has(member.kind) && member.isStatic && !!member.isVirtual && !member.isAbstract;

function sameMethodSignature(declared, candidate) {
  if (candidate.parameters.length !== declared.parameters.length) return false;
  if ((candidate.typeParameters?.length ?? 0) !== (declared.typeParameters?.length ?? 0)) return false;
  if (!candidate.returnType.equals(declared.returnType)) return false;
  return candidate.parameters.every((parameter, index) => parameter.type.equals(declared.parameters[index].type));
}

/** Whether a static member of the type is the implementation of `declared`: the same kind, name (by lookup) and types. */
function sameSignature(declared, candidate) {
  if (candidate.kind !== declared.kind || !candidate.isStatic) return false;
  if (declared.kind === SymbolKind.Method) return sameMethodSignature(declared, candidate);
  // A property or an event: its accessors are paired by the writer of the MethodImpl rows.
  return candidate.type.equals(declared.type);
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
 * The static virtual interface members with a body (methods, properties and events) that a type implements itself.
 * @param type a source class or struct
 * @returns {[object, object][]} `[declared, implementing]` member pairs; `declared` is a member of the constructed interface
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
