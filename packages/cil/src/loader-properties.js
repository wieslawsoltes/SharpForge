import {CilError} from './binary.js';
import {decodeCoded, readSignature, token} from './metadata.js';

const accessibility = Object.freeze({1: 'private', 3: 'internal', 4: 'protected', 6: 'public'});

function accessorFor(metadata, methodByToken, owner, row) {
  const methodToken = token(6, row[1]);
  const method = methodByToken.get(methodToken);
  const kind = row[0] === 2 ? 'get' : row[0] === 1 ? 'set' : null;
  if (!method || !kind || method.owner !== owner.name) throw new CilError('Invalid property accessor');
  const flags = metadata.row(methodToken)[2];
  const access = accessibility[flags & 7];
  if (!access || !(flags & 0x800)) throw new CilError('Invalid accessor flags');
  return {method, kind, access};
}

function propertyFor(metadata, row, signature) {
  const property = {
    name: metadata.string(row[1]), type: signature.returnType, isStatic: signature.isStatic,
    access: 'private', get: null, set: null, backing: null
  };
  if (signature.parameters.length) {
    property.parameters = signature.parameters.map((type, index) => ({name: 'arg' + index, type}));
  }
  return property;
}

/** Reconstruct ordinary properties and indexers from Property/MethodSemantics tables in linear metadata work. */
export function restoreCanonicalProperties(metadata, {typeByToken, methodByToken, statics}) {
  const maps = metadata.rows[21] ?? [];
  const rows = metadata.rows[23] ?? [];
  const accessors = new Map();
  const backingFields = new Set(statics.filter(field => field.backing).map(field => field.name));
  for (const owner of typeByToken.values()) {
    for (const field of owner.fields) if (field.backing) backingFields.add(owner.name + '.' + field.name);
  }
  for (const row of metadata.rows[24] ?? []) {
    const property = decodeCoded('HasSemantics', row[2]);
    if (property >>> 24 !== 23) continue;
    const entries = accessors.get(property) ?? [];
    entries.push(row);
    if (entries.length > 2) throw new CilError('Excessive property accessor count');
    accessors.set(property, entries);
  }
  for (let index = 0; index < maps.length; index++) {
    const owner = typeByToken.get(token(2, maps[index][0]));
    if (!owner) continue;
    owner.properties = [];
    const end = maps[index + 1]?.[1] ?? rows.length + 1;
    for (let rowId = maps[index][1]; rowId < end; rowId++) {
      const row = rows[rowId - 1];
      if (!row) throw new CilError('Invalid property map');
      const signature = readSignature(metadata.blob(row[2]), metadata);
      if (signature.kind !== 'property' || signature.parameters.length > 1024) {
        throw new CilError('Unsupported property signature');
      }
      const property = propertyFor(metadata, row, signature);
      for (const entry of accessors.get(token(23, rowId)) ?? []) {
        const {method, kind, access} = accessorFor(metadata, methodByToken, owner, entry);
        if (property[kind] !== null) throw new CilError('Duplicate property accessor');
        method.accessor = {property: property.name, kind, access};
        property[kind] = method.id;
        if (property.access === 'private' || access === 'public') property.access = access;
      }
      const backing = '<' + property.name + '>k__BackingField';
      if (backingFields.has(owner.name + '.' + backing)) property.backing = backing;
      owner.properties.push(property);
    }
  }
}
