import { contracts, types } from '../../../packages/framework/src/index.js';
import { signatureKey, normalizeType, counts } from './common.js';

const areaForType = name => /System\.Threading/.test(name) ? 'A11'
  : /System\.Net|System\.Uri/.test(name) ? 'A12'
  : /System\.Numerics|System\.Math|System\.Random/.test(name) ? 'A10'
  : /System\.Collections|System\.(?:Memory|ReadOnlyMemory|Span|ReadOnlySpan)|System\.Linq|System\.Buffers/.test(name) ? 'A08'
  : /System\.IO|System\.Text\.(?:Json|Encodings)|System\.Security|System\.Xml/.test(name) ? 'A09'
  : /System\.Reflection|System\.Runtime\.InteropServices|System\.Runtime\.Loader/.test(name) ? 'A04'
  : /System\.GC|System\.WeakReference|System\.Runtime\.GCSettings/.test(name) ? 'A06' : 'A07';

export function compareMembers(reference, { domain = 'BCL', specRevision = 'dotnet-10.0.5', area = areaForType, registryTypes = types, registryContracts = contracts } = {}) {
  const methods = new Map(registryContracts.map(contract => [signatureKey({ ...contract, owner: normalizeType(contract.owner) }), contract]));
  const rows = reference.rows.map(member => {
    const owner = normalizeType(member.owner);
    const descriptor = registryTypes.get(owner) ?? registryTypes.get(member.owner);
    let implemented = false, contractIds = [];
    if (member.kind === 'type') implemented = !!descriptor;
    else if (member.kind === 'method') {
      const contract = methods.get(signatureKey({ ...member, owner }, { requireHeader: true }));
      implemented = !!contract; contractIds = contract ? [contract.id] : [];
    } else if (member.kind === 'property') {
      const property = descriptor?.properties?.[member.name];
      implemented = !!property && normalizeType(property.type) === normalizeType(member.result) && !!property.isStatic === member.isStatic && !member.parameters.length && (!member.set || !property.readOnly);
      if (implemented) contractIds = registryContracts.filter(contract => contract.owner === descriptor.name && contract.property === member.name).map(contract => contract.id);
    } else if (member.kind === 'event') {
      const delegate = descriptor?.events?.[member.name];
      implemented = typeof delegate === 'string' && normalizeType(delegate) === normalizeType(member.result) && !member.isStatic;
      if (implemented) contractIds = registryContracts.filter(contract => contract.owner === descriptor.name && contract.event === member.name).map(contract => contract.id);
    } else if (member.kind === 'field') implemented = descriptor?.kind === 'enum' && Object.hasOwn(descriptor.values, member.name);
    return {
      key: `${domain.toLowerCase()}:${member.assembly}:${member.kind}:${member.signature}`, domain, name: member.name,
      assembly: member.assembly, owner: member.owner, kind: member.kind, signature: member.signature,
      area: typeof area === 'function' ? area(member.owner) : area, specRevision,
      status: implemented ? 'implemented' : 'missing', statusScope: 'exact registered signature only; behavior unqualified', contractIds,
    };
  });
  if (new Set(rows.map(row => row.key)).size !== rows.length) throw new Error('Duplicate reference member identity');
  return { schemaVersion: 1, referenceFiles: reference.files, extractor: reference.extractor, rows, totals: counts(rows) };
}

export const bclApiDiff = reference => compareMembers(reference);
