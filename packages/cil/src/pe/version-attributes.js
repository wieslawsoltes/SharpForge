import { CilError } from '../binary.js';
import { decodeCoded } from '../metadata/indices.js';
import { decodeCustomAttribute } from '../metadata/custom-attribute-reader.js';

const attributeFields = new Map([
  ['AssemblyFileVersionAttribute', 'fileVersion'], ['AssemblyCompanyAttribute', 'companyName'],
  ['AssemblyTitleAttribute', 'fileDescription'], ['AssemblyProductAttribute', 'productName'],
  ['AssemblyDescriptionAttribute', 'comments'], ['AssemblyCopyrightAttribute', 'legalCopyright'],
]);

function metadataName(metadata, index) {
  const bytes = metadata.streams.get('#Strings');
  if (!bytes || !Number.isInteger(index) || index < 0 || index >= bytes.length) throw new CilError('Invalid version attribute name');
  let end = index;
  while (end < bytes.length && end - index <= 2048 && bytes[end]) end++;
  if (end === bytes.length || end - index > 2048) throw new CilError('Version attribute name limit exceeded');
  const name = metadata.string(index);
  if (name.length > 512) throw new CilError('Version attribute name limit exceeded');
  return name;
}

function methodOwners(metadata) {
  const types = metadata.rows[2] ?? [], methods = metadata.rows[6] ?? [], owners = new Map();
  if (types.length > 65536 || methods.length > 65536) throw new CilError('Version attribute constructor limit exceeded');
  let count = 0;
  for (let index = 0; index < types.length; index++) {
    const owner = 0x02000001 + index;
    for (const method of metadata.list(owner, 'MethodList')) {
      if (++count > 65536 || owners.has(method)) throw new CilError('Invalid version attribute method ownership');
      owners.set(method, owner);
    }
  }
  return owners;
}

function attributeConstructor(metadata, token, state) {
  const table = token >>> 24;
  if (![6, 10].includes(table)) throw new CilError('Invalid version attribute constructor');
  const row = metadata.row(token);
  let owner;
  if (table === 10) owner = decodeCoded('MemberRefParent', row[0]);
  else {
    state.owners ??= methodOwners(metadata);
    owner = state.owners.get(token);
  }
  if (![1, 2].includes(owner >>> 24)) return null;
  const type = metadata.row(owner);
  if (metadataName(metadata, type[2]) !== 'System.Reflection') return null;
  const field = attributeFields.get(metadataName(metadata, type[1]));
  if (!field) return null;
  if (metadataName(metadata, row[table === 6 ? 3 : 1]) !== '.ctor'
    || metadata.blob(row[table === 6 ? 4 : 2]).length > 256) {
    throw new CilError('Invalid version attribute constructor');
  }
  return field;
}

function fileVersion(value) {
  if (!/^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(value)) throw new CilError('Invalid AssemblyFileVersion attribute');
  const parts = value.split('.').map(Number);
  if (parts.some(part => part > 65535)) throw new CilError('AssemblyFileVersion component exceeds UInt16');
  while (parts.length < 4) parts.push(0);
  return parts.join('.');
}

/** Project supported Assembly metadata attributes into win32Resources.version options without instantiating attributes. */
export function win32VersionFromAssembly(pe) {
  const metadata = pe.metadata, assembly = metadata.rows[32], attributes = metadata.rows[12] ?? [];
  if (assembly?.length !== 1) throw new CilError('Version attributes require one Assembly definition');
  if (attributes.length > 4096) throw new CilError('Version attribute row limit exceeded');
  const version = assembly[0].slice(1, 5);
  if (version.some(part => !Number.isInteger(part) || part < 0 || part > 65535)) throw new CilError('Invalid Assembly version');
  const result = { fileVersion: version.join('.') }, seen = new Set(), state = {};
  for (const row of attributes) {
    if (decodeCoded('HasCustomAttribute', row[0]) !== 0x20000001) continue;
    const constructor = decodeCoded('CustomAttributeType', row[1]), field = attributeConstructor(metadata, constructor, state);
    if (!field) continue;
    if (seen.has(field)) throw new CilError(`Duplicate assembly version attribute: ${field}`);
    seen.add(field);
    const value = decodeCustomAttribute(metadata.blob(row[2]), constructor,
      { metadata, maxBytes: 32768, maxStringBytes: 24576, maxNodes: 16, maxDepth: 4 });
    const argument = value.constructorArguments[0];
    if (!value.success || value.constructorArguments.length !== 1 || value.namedArguments.length
      || argument?.type !== 'System.String' || typeof argument.value !== 'string'
      || argument.value.length > 8192 || argument.value.includes('\0')) {
      throw new CilError('Invalid assembly version attribute value');
    }
    result[field] = field === 'fileVersion' ? fileVersion(argument.value) : argument.value;
  }
  return result;
}
