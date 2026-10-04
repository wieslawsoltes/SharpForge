import {decodeCoded, token} from '@sharpforge/cil';

const definitionName = table => table.genericDefinition?.metadataName ?? table.metadataName ?? table.name;

export function simpleTypeName(table) {
  if (table.elementType) return simpleTypeName(table.elementType) + table.name.slice(table.elementType.name.length);
  const name = definitionName(table);
  return name.slice(Math.max(name.lastIndexOf('.'), name.lastIndexOf('+')) + 1);
}

function metadataAssemblyRow(vm, name) {
  const metadata = vm.inspector?.metadata;
  if (!metadata) return null;
  const own = vm.inspector.types.find(type => type.name === name);
  if (own && metadata.rows[32]?.[0]) return {metadata, row: metadata.rows[32][0], definition: true};
  for (let index = 0; index < (metadata.rows[1]?.length ?? 0); index++) {
    if (metadata.typeName(token(1, index + 1)) !== name) continue;
    let scope = decodeCoded('ResolutionScope', metadata.rows[1][index][0]);
    while (scope >>> 24 === 1) scope = decodeCoded('ResolutionScope', metadata.row(scope)[0]);
    if (scope >>> 24 === 35) return {metadata, row: metadata.row(scope), definition: false};
    break;
  }
  const row = name.startsWith('System.') && (metadata.rows[35] ?? []).find(item =>
    ['System.Runtime', 'mscorlib', 'System.Private.CoreLib'].includes(metadata.string(item[6])));
  return row ? {metadata, row, definition: false} : null;
}

export function typeAssemblyIdentity(vm, table) {
  if (table.elementType) return typeAssemblyIdentity(vm, table.elementType);
  const definition = table.genericDefinition ?? table;
  if (definition.assemblyKey) return definition.assemblyKey;
  const name = definitionName(table);
  const location = metadataAssemblyRow(vm, name);
  if (location) {
    const {metadata, row, definition: own} = location;
    const version = row.slice(own ? 1 : 0, own ? 5 : 4).join('.');
    const assembly = metadata.string(row[own ? 7 : 6]);
    const culture = metadata.string(row[own ? 8 : 7]) || 'neutral';
    const key = metadata.blob(row[own ? 6 : 5]);
    // The execution profile uses System.Runtime as the core-library reference facade.
    const core = assembly === 'System.Runtime';
    const publicKey = core ? '7cec85d7bea7798e' : key.length === 8
      ? Array.from(key, byte => byte.toString(16).padStart(2, '0')).join('') : 'null';
    return `${core ? 'System.Private.CoreLib' : assembly}, Version=${version}, Culture=${culture}, PublicKeyToken=${publicKey}`;
  }
  return name.startsWith('System.')
    ? 'System.Private.CoreLib, Version=8.0.0.0, Culture=neutral, PublicKeyToken=7cec85d7bea7798e'
    : `${vm.image?.name ?? 'Application'}, Version=0.2.0.0, Culture=neutral, PublicKeyToken=null`;
}

export function fullTypeName(vm, table) {
  if (table.containsGenericParameters && !table.flags.genericDefinition) return null;
  if (table.elementType) {
    const element = fullTypeName(vm, table.elementType);
    return element === null ? null : element + table.name.slice(table.elementType.name.length);
  }
  if (table.genericDefinition) {
    const arguments_ = table.typeArguments.map(type => fullTypeName(vm, type) + ', ' + typeAssemblyIdentity(vm, type));
    return definitionName(table) + '[[' + arguments_.join('],[') + ']]';
  }
  return definitionName(table);
}

export function displayTypeName(table) {
  if (table.genericDefinition) return definitionName(table) + '[' + table.typeArguments.map(displayTypeName).join(',') + ']';
  if (table.elementType) return displayTypeName(table.elementType) + table.name.slice(table.elementType.name.length);
  return definitionName(table);
}
