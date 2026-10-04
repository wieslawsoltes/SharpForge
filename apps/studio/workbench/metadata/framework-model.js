import {intrinsicMetadata} from './intrinsic-model.js';

/** Registered framework and core intrinsic metadata remain distinct from an inspected PE assembly. */
export async function frameworkMetadata() {
  const {types, contracts, propertiesFor, eventsFor, ABI_VERSION, frameworkType} = await import('@sharpforge/framework');
  const intrinsic = await intrinsicMetadata();
  const members = new Map();
  for (const contract of contracts) {
    const list = members.get(contract.owner) ?? [];
    list.push({token: 'contract:' + contract.id, name: contract.name, owner: contract.owner, kind: contract.kind === 'constructor' ? 'constructor' : 'method',
      parameters: contract.parameters.map((type, index) => ({type, name: 'arg' + index})), type: contract.result,
      signature: `${contract.isStatic ? 'static ' : ''}${contract.result} ${contract.name}(${contract.parameters.join(', ')});`,
      contractId: contract.id});
    members.set(contract.owner, list);
  }
  const models = [];
  for (const type of types.values()) {
    const list = [...(members.get(type.name) ?? [])];
    for (const [name, property] of Object.entries(propertiesFor(type.name))) list.push({
      token: 'property:' + type.name + ':' + name, name, owner: type.name, kind: 'property', type: property.type,
      signature: `${property.type} ${name} { get; ${property.readOnly ? '' : 'set; '}}`
    });
    for (const [name, delegate] of Object.entries(eventsFor(type.name))) list.push({
      token: 'event:' + type.name + ':' + name, name, owner: type.name, kind: 'event', type: delegate,
      signature: `event ${delegate} ${name};`
    });
    models.push({token: type.name, name: type.name, displayName: type.name, kind: type.kind, base: type.base,
      namespace: type.name.slice(0, Math.max(0, type.name.lastIndexOf('.'))), members: list,
      signature: `${type.kind} ${type.name}${type.base ? ' : ' + type.base : ''}`});
  }
  for (const type of intrinsic.types) {
    const existing = models.find(model => model.name === type.name);
    if (existing) existing.members.push(...type.members);
    else models.push(type);
  }
  return {schemaVersion: 1, kind: 'framework', name: 'SharpForge Framework', version: String(ABI_VERSION),
    identity: 'SharpForge Framework ABI ' + ABI_VERSION, mvid: null,
    source: {id: 'framework', version: `ABI ${ABI_VERSION}; core bytecode format ${intrinsic.version}`},
    types: models, symbols: models.reduce((sum, type) => sum + 1 + type.members.length, 0), diagnostics: [],
    canonicalName: name => frameworkType(name)?.name ?? intrinsic.aliases[name]};
}
