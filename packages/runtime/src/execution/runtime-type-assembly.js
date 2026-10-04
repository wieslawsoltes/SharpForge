import {decodeCoded, token} from '@sharpforge/cil';

function referencedAssembly(metadata, name) {
  for (let index = 0; index < (metadata.rows[1]?.length ?? 0); index++) {
    if (metadata.typeName(token(1, index + 1)) !== name) continue;
    let scope = decodeCoded('ResolutionScope', metadata.rows[1][index][0]);
    while (scope >>> 24 === 1) scope = decodeCoded('ResolutionScope', metadata.row(scope)[0]);
    return scope >>> 24 === 35 ? metadata.row(scope) : null;
  }
  return null;
}

function formatAssembly(metadata, row, definition) {
  const version = row.slice(definition ? 1 : 0, definition ? 5 : 4).join('.');
  const assembly = metadata.string(row[definition ? 7 : 6]);
  const culture = metadata.string(row[definition ? 8 : 7]) || 'neutral';
  const key = metadata.blob(row[definition ? 6 : 5]);
  // System.Runtime is the reference facade for core library types in this profile.
  const core = assembly === 'System.Runtime';
  const publicKey = core ? '7cec85d7bea7798e' : key.length === 8 ?
    Array.from(key, byte => byte.toString(16).padStart(2, '0')).join('') : 'null';
  return `${core ? 'System.Private.CoreLib' : assembly}, Version=${version}, Culture=${culture}, PublicKeyToken=${publicKey}`;
}

/** Preserve actual PE assembly identities and the source profile's existing reference-assembly defaults. */
export function runtimeTypeAssembly(vm, table) {
  const metadata = vm.inspector?.metadata;
  const name = table.genericDefinition?.name ?? table.name;
  if (metadata) {
    const own = table.sourceIdentity?.assembly === 'source' || vm.inspector.types.some(type => type.name === name);
    let row = own ? metadata.rows[32]?.[0] : null;
    const definition = !!row;
    row ??= referencedAssembly(metadata, name);
    if (!row && name.startsWith('System.')) row = (metadata.rows[35] ?? []).find(item =>
      ['System.Runtime', 'mscorlib', 'System.Private.CoreLib'].includes(metadata.string(item[6])));
    if (row) return formatAssembly(metadata, row, definition);
  }
  const core = table.sourceIdentity?.assembly !== 'source' &&
    (name.startsWith('System.') || table.sourceIdentity?.assembly === 'core');
  return core ? 'System.Private.CoreLib, Version=8.0.0.0, Culture=neutral, PublicKeyToken=7cec85d7bea7798e' :
    `${vm.image?.name ?? 'Application'}, Version=0.2.0.0, Culture=neutral, PublicKeyToken=null`;
}
