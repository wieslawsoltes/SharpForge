import {CilError} from '../binary.js';
import {token, decodeCoded, readSignature} from '../metadata.js';
import {memberAccessFlags, memberAccessNames} from '../metadata/member-definitions.js';

function propertySemantics(metadata) {
  const byProperty = new Map();
  for (const row of metadata.rows[24] ?? []) {
    const association = decodeCoded('HasSemantics', row[2]);
    const values = byProperty.get(association) ?? [];
    values.push(row);
    byProperty.set(association, values);
  }
  return byProperty;
}

function readAccessor(metadata, row, methodByToken, owner, property) {
  const methodToken = token(6, row[1]);
  const method = methodByToken.get(methodToken);
  const kind = row[0] === 2 ? 'get' : row[0] === 1 ? 'set' : null;
  if (!method || !kind || method.owner !== owner.name || property[kind] !== null) {
    throw new CilError('Invalid property accessor');
  }
  const flags = metadata.row(methodToken)[2];
  const access = memberAccessNames.get(flags & 7);
  if (!access || !(flags & 0x800)) throw new CilError('Invalid accessor flags');
  method.accessor = {property: property.name, kind, access};
  property[kind] = method.id;
  if ((flags & 7) > memberAccessFlags.get(property.access)) property.access = access;
}

/** Reconstruct bounded named properties from real metadata in O(properties + semantics + fields). */
export function readCanonicalProperties(metadata, {typeByToken, methodByToken, statics}) {
  const maps = metadata.rows[21] ?? [];
  const rows = metadata.rows[23] ?? [];
  const semantics = propertySemantics(metadata);
  const staticBacking = new Set(statics.filter(field => field.backing).map(field => field.name));
  for (const [index, map] of maps.entries()) {
    const owner = typeByToken.get(token(2, map[0]));
    if (!owner) continue;
    owner.properties = [];
    const backing = new Set(owner.fields.filter(field => field.backing).map(field => field.name));
    const end = maps[index + 1]?.[1] ?? rows.length + 1;
    for (let rowId = map[1]; rowId < end; rowId++) {
      const row = rows[rowId - 1];
      if (!row) throw new CilError('Invalid property map');
      const signature = readSignature(metadata.blob(row[2]), metadata);
      if (signature.kind !== 'property' || signature.parameters.length) throw new CilError('Unsupported property signature');
      const name = metadata.string(row[1]);
      const property = {name, type: signature.returnType, isStatic: signature.isStatic,
        access: 'private', get: null, set: null, backing: null};
      for (const accessor of semantics.get(token(23, rowId)) ?? []) readAccessor(metadata, accessor, methodByToken, owner, property);
      const backingName = '<' + name + '>k__BackingField';
      if (backing.has(backingName) || staticBacking.has(owner.name + '.' + backingName)) property.backing = backingName;
      owner.properties.push(property);
    }
  }
}
