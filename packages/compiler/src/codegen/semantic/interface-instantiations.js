import {SymbolKind, TypeKind} from '../../symbols/types.js';
import {typeMapOf} from '../../symbols/substitution.js';
import {explicitlyImplementedMember} from '../../binder/interface-impl.js';
import {recordSourceMethodImpl} from './interface-shape.js';

const definitionOf = symbol => symbol.originalDefinition ?? symbol;
const maximumMaterializations = 65536;

/** Match reachable closed method constructions to the binder's existing interface implementation identities. */
export class SourceInterfaceInstantiations {
  constructor(host) {
    this.host = host;
    this.types = new Set();
    this.methods = new Set();
    this.slots = new Map();
    this.materializations = 0;
  }

  slot(declaration, iface) {
    const definition = definitionOf(declaration);
    let owners = this.slots.get(definition);
    if (!owners) this.slots.set(definition, owners = new Map());
    const key = this.host.generics.argumentsKey([iface]);
    let slot = owners.get(key);
    if (!slot) owners.set(key, slot = {pairs: [], demands: []});
    return slot;
  }

  registerType(type, record) {
    if (this.types.has(record.id)) return;
    this.types.add(record.id);
    const definition = definitionOf(type);
    const pairs = type.typeKind === TypeKind.Interface ? definition.getMembers().flatMap(body => {
      const declaration = explicitlyImplementedMember(body);
      return declaration ? [[declaration, body]] : [];
    }) : [...(definition.interfaceImplementations ?? [])];
    const generics = this.host.generics;
    generics.withMap(typeMapOf(type), () => {
      for (const [declaration, body] of pairs) {
        if (declaration.kind !== SymbolKind.Method || !declaration.typeParameters?.length || declaration.isStatic) continue;
        const iface = generics.closed(declaration.containingType);
        const owner = generics.closed(body.containingType);
        const implementation = owner.typeMap ? definitionOf(body).asMemberOf(owner) : definitionOf(body);
        const slot = this.slot(declaration, iface);
        const pair = {implementation, done: new Set()};
        slot.pairs.push(pair);
        for (const demand of slot.demands) this.materialize(pair, demand);
      }
    });
  }

  registerMethod(instance) {
    const {definition, typeArguments} = instance;
    if (definition.containingType?.typeKind !== TypeKind.Interface || definition.isStatic || !typeArguments?.length) return;
    const record = this.host.methods.get(instance);
    if (!record || this.methods.has(record.id)) return;
    this.methods.add(record.id);
    const slot = this.slot(definition, instance.owner?.type ?? definition.containingType);
    const demand = {record, typeArguments};
    slot.demands.push(demand);
    for (const pair of slot.pairs) this.materialize(pair, demand);
  }

  materialize(pair, demand) {
    if (pair.done.has(demand.record.id)) return;
    pair.done.add(demand.record.id);
    if (++this.materializations > maximumMaterializations)
      this.host.unsupported('interface method instantiation budget exceeded', pair.implementation.locations?.[0]);
    const implementation = pair.implementation.construct(demand.typeArguments);
    const target = this.host.generics.withClosedTarget(() => this.host.methodOf(implementation));
    recordSourceMethodImpl(target, demand.record);
  }
}
