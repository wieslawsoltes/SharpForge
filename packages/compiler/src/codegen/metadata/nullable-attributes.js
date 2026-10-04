/** Writes planned nullable transforms after declaration and relation tokens have been allocated. */
import { encodeCustomAttribute } from '@sharpforge/cil';
import { ArrayTypeSymbol } from '../../symbols/types.js';
import { methodSignature } from './member-signatures.js';

const NULLABLE = 'System.Runtime.CompilerServices.NullableAttribute';
const CONTEXT = 'System.Runtime.CompilerServices.NullableContextAttribute';

/** Resolves relation rows once; a nested type's copies of enclosing GenericParams keep their distinct tokens. */
function relationTokens(writer) {
  const interfaces = new Map(), generics = new Map(), constraints = new Map();
  const add = (map, owner, key, value) => {
    if (!map.has(owner)) map.set(owner, new Map());
    map.get(owner).set(key, value);
  };
  for (const row of writer.interfaceRows ?? []) add(interfaces, row.type, row.interface, row.token);
  for (const row of writer.genericParameterRows ?? []) add(generics, row.owner, row.symbol, row.token);
  for (const row of writer.genericConstraintRows ?? []) add(constraints, row.owner, row.type, row.token);
  return { interfaces, generics, constraints };
}

function targetToken(item, owner, writer, relations) {
  switch (item.kind) {
    case 'base': return writer.typeToken(item.type);
    case 'interface': return relations.interfaces.get(item.type)?.get(item.interface);
    case 'field': return item.field.token;
    case 'property': return writer.propertyTokens.get(item.symbol);
    case 'event': return writer.eventTokens.get(item.symbol);
    case 'return': return item.method.returnParameterToken;
    case 'parameter': return item.method.parameterTokens?.[item.index];
    case 'genericParameter': return relations.generics.get(owner)?.get(item.symbol);
    case 'constraint': return relations.constraints.get(relations.generics.get(owner)?.get(item.symbol))?.get(item.type);
    default: throw new Error('Unknown nullable metadata target: ' + item.kind);
  }
}

/** Called by CustomAttributeWriter after SymbolMetadataWriter has written all target tables. */
export function writeNullableAttributes(attributes) {
  const writer = attributes.writer, plan = writer.nullableMetadata;
  if (!plan) return;
  const relations = relationTokens(writer), constructors = new Map();
  const write = (parent, name, flags) => {
    if (!parent) throw new Error('Nullable metadata target was not allocated: ' + name);
    const array = flags.length !== 1, key = name + (array ? '[]' : '');
    let constructor = constructors.get(key);
    if (!constructor) {
      const type = array ? new ArrayTypeSymbol(attributes.core.byte) : attributes.core.byte;
      const shape = { isStatic: false, returnType: attributes.core.void, parameters: [{ type }] };
      constructor = attributes.builder.member(attributes.frameworkAttribute(name), '.ctor', methodSignature(attributes.types, shape));
      constructors.set(key, constructor);
    }
    const descriptor = array ? { kind: 'szarray', element: 'byte' } : 'byte';
    attributes.add(parent, constructor, encodeCustomAttribute([descriptor], [array ? flags : flags[0]]));
  };
  for (const current of plan.scopes.values()) {
    const owner = current.kind === 'type' ? writer.typeToken(current.owner) : current.owner.token;
    if (current.contextAttribute !== null) write(owner, CONTEXT, [current.contextAttribute]);
    for (const item of current.entries) if (item.flags.length) write(targetToken(item, owner, writer, relations), NULLABLE, item.flags);
  }
}
