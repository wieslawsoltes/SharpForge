import {metadataLimits, metadataError, boundedMetadataText} from './limits.js';

function signatureOf(member) {
  if (typeof member.signature === 'string') return boundedMetadataText(member.signature);
  const signature = member.signature;
  if (!signature) return 'Signature unavailable in the supplied inspection summary';
  return `${signature.isStatic ? 'static ' : ''}${signature.returnType ?? signature.type ?? ''} ${member.name}` +
    (signature.parameters ? '(' + signature.parameters.join(', ') + ')' : '') + ';';
}

/** Compatibility for hosts that already supply inspector summaries; preserves their explicit signature gaps. */
export function suppliedMetadata(summary, source = {}) {
  const members = new Map();
  for (const method of summary.methods ?? []) {
    const list = members.get(method.owner) ?? [];
    list.push({token: method.token, name: boundedMetadataText(method.name), owner: method.owner, kind: 'method',
      signature: signatureOf(method), parameters: method.signature?.parameters?.map(type => ({type}))});
    members.set(method.owner, list);
  }
  const types = (summary.types ?? []).map(type => ({token: type.token, name: boundedMetadataText(type.name),
    namespace: type.name.slice(0, Math.max(0, type.name.lastIndexOf('.'))), displayName: type.name,
    kind: type.kind ?? 'type', signature: (type.kind ?? 'type') + ' ' + type.name,
    members: [...(members.get(type.name) ?? []), ...(type.fields ?? []).map(field => ({
      token: field.token, name: field.name, owner: type.name, kind: 'field', signature: (field.type ?? '?') + ' ' + field.name + ';'
    }))]}));
  const symbols = types.reduce((sum, type) => sum + 1 + type.members.length, 0);
  if (symbols > metadataLimits.symbols) throw metadataError('METADATA_SYMBOL_LIMIT', 'Supplied metadata exceeds its declaration limit');
  return {schemaVersion: 1, kind: 'summary', name: boundedMetadataText(summary.name), version: summary.version ?? 'unknown',
    identity: `${summary.name}, Version=${summary.version ?? 'unknown'}`, mvid: summary.mvid ?? null,
    source: {...source}, types, symbols, diagnostics: summary.diagnostics ?? []};
}
