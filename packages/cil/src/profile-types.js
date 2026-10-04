import {CilError} from './binary.js';
import {token, decodeCoded, readSignature} from './metadata.js';
import {gcProfileBase} from './framework-builtin.js';

/** Read compiler image type/field mappings from CLI metadata, preserving supported GC ancestry. */
export function loadProfileTypes(debug, metadata, typeByToken, fieldByToken) {
  const definitions = metadata.rows[2] ?? [];
  return debug.types.map((item, id) => {
    if (item.id !== id || item.token >>> 24 !== 2 || typeByToken.has(item.token)) throw new CilError('Invalid type mapping');
    const row = metadata.row(item.token);
    const name = metadata.typeName(item.token);
    const fields = [];
    const end = definitions[item.token & 0xffffff]?.[4] ?? (metadata.counts[4] ?? 0) + 1;
    for (let index = row[4]; index < end; index++) {
      const fieldToken = token(4, index);
      const fieldRow = metadata.row(fieldToken);
      if (fieldRow[0] & 16) continue;
      const signature = readSignature(metadata.blob(fieldRow[2]), metadata);
      if (signature.kind !== 'field') throw new CilError('Invalid field signature');
      const field = {name: metadata.string(fieldRow[1]), type: signature.type, index: fields.length,
        ...((fieldRow[0] & 7) === 1 ? {backing: true} : {})};
      fields.push(field);
      fieldByToken.set(fieldToken, {...field, owner: name});
    }
    const interfaces = (metadata.rows[9] ?? []).filter(entry => entry[0] === (item.token & 0xffffff))
      .map(entry => metadata.typeName(decodeCoded('TypeDefOrRef', entry[1])));
    const type = {id, name, fields, initializer: item.initializer, ...gcProfileBase(metadata, row),
      ...(interfaces.length ? {interfaces} : {})};
    typeByToken.set(item.token, type);
    return type;
  });
}
