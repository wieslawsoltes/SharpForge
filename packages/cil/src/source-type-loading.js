import {readSourceTypeIdentities} from './source-type-identities.js';
import {loadSourceTypeShape} from './source-value-loading.js';
import {token, decodeCoded, readSignature} from './metadata.js';
import {CilError} from './binary.js';

/** Recover physical source layouts and independently validated logical identity projections from CIL metadata. */
export function loadSourceTypes({debug, metadata, typeByToken, fieldByToken}) {
  const identities = readSourceTypeIdentities({metadata, debug});
  const rows = metadata.rows[2] ?? [];
  const interfaces = new Map();
  for (const row of metadata.rows[9] ?? []) {
    const list = interfaces.get(row[0]) ?? [];
    list.push(metadata.typeName(decodeCoded('TypeDefOrRef', row[1])));
    interfaces.set(row[0], list);
  }
  return debug.types.map((item, id) => {
    if (item.id !== id || item.token >>> 24 !== 2 || typeByToken.has(item.token)) throw new CilError('Invalid type mapping');
    const row = metadata.row(item.token);
    const name = metadata.typeName(item.token);
    const fields = [];
    const end = rows[item.token & 0xffffff]?.[4] ?? (metadata.counts[4] ?? 0) + 1;
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
    const type = {...loadSourceTypeShape(metadata, row), id, name, fields, initializer: item.initializer,
      ...(identities.has(item.token) ? {sourceIdentity: identities.get(item.token)} : {}),
      ...(interfaces.has(item.token & 0xffffff) ? {interfaces: interfaces.get(item.token & 0xffffff)} : {})};
    typeByToken.set(item.token, type);
    return type;
  });
}
