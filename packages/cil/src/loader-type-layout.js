import {frameworkType} from '@sharpforge/framework';
import {CilError} from './binary.js';
import {decodeCoded} from './metadata.js';

const accessibility = Object.freeze({1: 'private', 3: 'internal', 4: 'protected', 6: 'public'});

/** Recover inheritance and absolute field slots from TypeDef/Field metadata before decoding field instructions. */
export function restoreCanonicalTypeLayout(metadata, typeByToken, fieldByToken) {
  const types = new Map();
  for (const [token, type] of typeByToken) {
    if (types.has(type.name)) throw new CilError('Duplicate canonical type name');
    types.set(type.name, type);
    const encoded = metadata.row(token)[3];
    const base = encoded ? metadata.typeName(decodeCoded('TypeDefOrRef', encoded)) : null;
    if (base && base !== 'System.Object') type.base = base;
  }
  const offsets = new Map();
  for (const type of types.values()) {
    const ancestry = [], seen = new Set();
    for (let current = type; current; current = types.get(current.base)) {
      if (seen.has(current) || seen.size >= 256) throw new CilError('Cyclic or excessive canonical type ancestry');
      seen.add(current);
      ancestry.push(current);
    }
    let count = 0;
    for (let index = ancestry.length - 1; index >= 0; index--) {
      const current = ancestry[index];
      offsets.set(current.name, count);
      count += current.fields.length;
      if (count > 1000000) throw new CilError('Canonical inherited field budget exceeded');
    }
    let base = ancestry.at(-1)?.base;
    const frameworkSeen = new Set();
    while (base) {
      if (frameworkSeen.has(base) || frameworkSeen.size >= 256) throw new CilError('Invalid canonical framework ancestry');
      frameworkSeen.add(base);
      if (frameworkType(base)?.name.startsWith('Microsoft.UI.Xaml.')) { type.uiFrameworkBase = base; break; }
      base = frameworkType(base)?.base;
    }
  }
  for (const type of types.values()) {
    const offset = offsets.get(type.name) ?? 0;
    type.fields.forEach((field, index) => { field.index = offset + index; });
  }
  for (const field of fieldByToken.values()) field.index += offsets.get(field.owner) ?? 0;
}

/** Virtual dispatch flags are executable MethodDef metadata, never trusted debug annotations. */
export function restoreCanonicalMethodLayout(metadata, methodByToken) {
  for (const [token, method] of methodByToken) {
    const flags = metadata.row(token)[2];
    if (!(flags & 0x40) || method.implementsDispose) continue;
    const access = accessibility[flags & 7];
    if (!access || method.isStatic) throw new CilError('Invalid canonical virtual method flags');
    method.access = access;
    method.isVirtual = true;
    method.isOverride = !(flags & 0x100);
    method.isFinal = !!(flags & 0x20);
    method.virtualSlot = method.name + '(' + method.parameters.map(parameter => parameter.type).join(',') + ')';
  }
}
