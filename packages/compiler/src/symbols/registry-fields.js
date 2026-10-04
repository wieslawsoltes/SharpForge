import {FieldSymbol, DeclarationModifiers} from './members.js';
import {frameworkType} from '@sharpforge/framework';

/** Read normalized type metadata without giving source-defined fields framework storage. */
export function registeredField(owner, name, lookup = frameworkType) {
  const fields = lookup(owner)?.fields;
  return fields && Object.hasOwn(fields, name) ? fields[name] : null;
}

/** Bound readonly fields carry an execution descriptor separately from their language constant value. */
export function registeredFieldDescriptor(field) {
  return field?.originalDefinition?.registryField ?? field?.registryField ?? null;
}

/** Strings retain field provenance so the source runtime can root and snapshot their managed references. */
export function registeredFieldSourceValue(descriptor, owner, name) {
  return descriptor.type === 'string' ? {readonlyField: {owner, name}} : descriptor.value;
}

export function registeredFieldSymbolValue(field) {
  const descriptor = registeredFieldDescriptor(field);
  const owner = field.originalDefinition?.registryFieldOwner ?? field.registryFieldOwner;
  return descriptor && registeredFieldSourceValue(descriptor, owner, field.name);
}

/** Registry profile values belong to readonly fields, never to properties or compile-time constants. */
export function appendRegistryFields(members, entry, bridge, publicMember) {
  for (const [name, descriptor] of Object.entries(entry?.fields ?? {})) {
    const field = new FieldSymbol({
      ...publicMember,
      name,
      type: bridge.typeFromName(descriptor.type),
      modifiers: DeclarationModifiers.Static | DeclarationModifiers.ReadOnly
    });
    field.registryField = descriptor;
    field.registryFieldOwner = entry.name;
    members.push(field);
  }
}
