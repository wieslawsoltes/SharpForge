import {
  TypeKind,
  SymbolKind
} from '../../symbols/types.js';
import {
  explicitlyImplementedMember
} from '../../binder/interface-impl.js';

/** Source dispatch keeps the binder's declaration identities through monomorphized image records. */
export function sourceInterfaceMethod(symbol, owner) {
  if (symbol.isStatic || symbol.name === '.ctor') return {};
  const iface = !!owner.interface;
  const explicit = !!symbol.explicitInterfaceType;
  const participates = iface || explicit || symbol.isVirtual || symbol.isAbstract || symbol.isOverride ||
    !!symbol.containingType?.interfaces?.length && symbol.declaredAccessibility === 'public';
  return participates ? {
    isVirtual: true,
    isAbstract: !!symbol.isAbstract || iface && !symbol.hasBody,
    isFinal: explicit && !iface || !iface && !symbol.isVirtual && !symbol.isAbstract && !symbol.isOverride,
    isNewSlot: !symbol.isOverride,
    access: explicit ? 'private' : symbol.declaredAccessibility ?? 'public'
  } : {};
}

const roles = ['getMethod', 'setMethod', 'addMethod', 'removeMethod'];

/** Preserve one exact constructed declaration/body association without duplicating MethodImpl rows. */
export function recordSourceMethodImpl(target, declared) {
  if (target.id === declared.id) return;
  const entries = target.explicitInterfaceImplementations ??= [];
  if (!entries.includes(declared.id)) entries.push(declared.id);
}

/** Close inherited interface identities and materialize the methods reachable only through their slots. */
export function connectSourceInterfaceType(host, type, record) {
  record.interfaces = (type.interfaces ?? []).filter(iface => host.isSource(iface)).map(iface => host.classOf(iface).name);
  if (host.generics.isGenericClass(type) && (record.interface || record.interfaces.length)) {
    for (const member of type.getMembers()) {
      const methods = member.kind === SymbolKind.Method ? [member] : roles.map(role => member[role]).filter(Boolean);
      for (const method of methods) {
        if (method.isStatic || method.isConstructor || method.typeParameters?.length) continue;
        if (record.interface || method.declaredAccessibility === 'public' || method.explicitInterfaceType) host.methodOf(method);
      }
    }
  }
  const connect = (declaration, implementation) => {
    const pairs = declaration.kind === SymbolKind.Method ? [
        [declaration, implementation]
      ] :
      roles.filter(role => declaration[role] && implementation[role]).map(role => [declaration[role], implementation[role]]);
    for (const [slot, body] of pairs) {
      const target = host.methodOf(body),
        declared = host.methodOf(slot);
      recordSourceMethodImpl(target, declared);
    }
  };
  for (const implementation of type.getMembers()) {
    if (implementation.kind === SymbolKind.Method && implementation.typeParameters?.length) continue;
    const declaration = explicitlyImplementedMember(implementation);
    if (declaration && host.isSource(declaration)) connect(declaration, implementation);
  }
  host.interfaceMethods.registerType(host.generics.closed(type), record);
}

/** Run before bodies: ordinary interface declarations and implementation targets have stable method IDs. */
export function connectSourceInterfaces(host) {
  for (const [type, record] of host.classes) connectSourceInterfaceType(host, type, record);
}

export function sourceInterfaceShape(symbol) {
  return symbol.typeKind === TypeKind.Interface ? {
    interface: true,
    abstract: true
  } : {};
}
