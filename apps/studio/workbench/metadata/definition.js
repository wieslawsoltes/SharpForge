import {metadataLimits, metadataError} from './limits.js';
import {canonicalType} from '@sharpforge/framework';

const simpleName = name => String(name).split(/[.+]/u).at(-1).replace(/`\d+$/u, '');
const undecorated = name => String(name ?? '').replace(/^global::/u, '').replace(/<[^<>]*>/gu, '').replace(/`\d+/gu, '').replaceAll('+', '.');

/** Resolve an explicit metadata token, bound owner/member, or qualified type/member expression without guessing ambiguous owners. */
export function findMetadataDefinition(assemblies, query = {}) {
  const expression = String(query.expression ?? query.type ?? '').replace(/\s+/gu, '').replace(/^global::/u, '');
  const matches = [];
  for (const assembly of assemblies) {
    if (query.assemblyIdentity && assembly.identity !== query.assemblyIdentity && assembly.name !== query.assemblyIdentity) continue;
    const owner = query.owner ?? (query.name ? query.type : null);
    for (const type of assembly.types) {
      let memberName = query.name, matchesType = false;
      if (query.memberToken !== undefined) matchesType = type.token === query.memberToken || type.members.some(member => member.token === query.memberToken);
      else if (owner) matchesType = type.name === owner || undecorated(type.name) === undecorated(owner) ||
        assembly.canonicalName?.(owner) === type.name || simpleName(type.name) === undecorated(owner);
      else {
        const names = [type.name, type.displayName, undecorated(type.name), simpleName(type.name)];
        const canonical = assembly.canonicalName?.(expression);
        if (names.includes(expression) || canonical === type.name) matchesType = true;
        else for (const name of names) if (expression.startsWith(name + '.')) {
          matchesType = true;
          memberName = expression.slice(name.length + 1);
          break;
        }
        if (!matchesType && expression.includes('.')) {
          const dot = expression.lastIndexOf('.');
          if (assembly.canonicalName?.(expression.slice(0, dot)) === type.name) {
            matchesType = true;
            memberName = expression.slice(dot + 1);
          }
        }
      }
      if (!matchesType) continue;
      let members = type.members.filter(member => query.memberToken !== undefined ? member.token === query.memberToken : member.name === memberName);
      if (query.argumentCount !== undefined && members.length) {
        const exact = members.filter(member => member.parameters?.length === query.argumentCount);
        if (exact.length) members = exact;
      }
      if (Array.isArray(query.parameters) && members.length) {
        const expected = query.parameters.map(parameter => canonicalType(typeof parameter === 'string' ? parameter : parameter.type));
        const exact = members.filter(member => member.parameters?.length === expected.length &&
          member.parameters.every((parameter, index) => canonicalType(parameter.type) === expected[index]));
        if (exact.length) members = exact;
      }
      if (memberName && !members.length) continue;
      matches.push({assembly, type, members});
    }
  }
  if (matches.length > 1) throw metadataError('METADATA_DEFINITION_AMBIGUOUS',
    'The metadata name matches more than one referenced type. Use its fully qualified name or choose its assembly in Object Browser.');
  return matches[0] ?? null;
}

/** Produce bounded read-only metadata source, with real assembly/MVID/input version and exact member selection. */
export async function metadataDefinition(match, {signal, sourceVersion, projectId} = {}) {
  if (!match) return null;
  signal?.throwIfAborted();
  const {assembly, type, members} = match;
  const lines = ['// Read-only ' + (assembly.kind === 'framework' ? 'registered framework contracts' : 'ECMA-335 declaration metadata'),
    '// Assembly: ' + assembly.identity, '// Module MVID: ' + (assembly.mvid ?? 'not supplied'),
    '// Input: ' + (assembly.source.path ?? assembly.source.id) + ' · version ' + assembly.source.version,
    type.signature, '{'];
  let length = lines.reduce((sum, line) => sum + line.length + 1, 0), selection;
  for (let index = 0; index < type.members.length; index++) {
    const member = type.members[index], line = '    ' + member.signature;
    if (!selection && members.includes(member)) selection = {start: length + 4, end: length + line.length};
    lines.push(line);
    length += line.length + 1;
    if (length > metadataLimits.definition) throw metadataError('METADATA_DEFINITION_LIMIT',
      'This type exceeds the metadata source preview limit; inspect individual members in Object Browser');
    if (index && index % 128 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
  }
  lines.push('}');
  const key = [assembly.source.projectId ?? projectId ?? '', assembly.identity, assembly.mvid ?? '', assembly.source.version, type.token];
  return {uri: 'metadata:' + key.map(value => encodeURIComponent(value)).join('/'), text: lines.join('\n'), readOnly: true,
    version: String(assembly.source.version), assemblyIdentity: assembly.identity, mvid: assembly.mvid,
    metadataSourceVersion: assembly.source.version, sourceVersion, projectId: assembly.source.projectId ?? projectId,
    selection: selection ?? {start: lines.slice(0, 4).reduce((sum, line) => sum + line.length + 1, 0), end: length},
    overloadCount: members.length};
}
