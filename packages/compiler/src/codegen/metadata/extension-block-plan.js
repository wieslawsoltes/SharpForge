/** Grouping/marker metadata contributed by C# extension blocks to both executable and reference assembly writers. */
import { MethodAttributes, TypeAttributes } from '@sharpforge/cil';
import { NamedTypeSymbol, TypeMap, SymbolKind, Accessibility } from '../../symbols/types.js';
import { MethodSymbol, DeclarationModifiers } from '../../symbols/members.js';
import { MetadataEmitError } from './type-tokens.js';
import { planMembers } from './member-plan.js';
import { extensionBlockKeys, extensionMetadataName } from './extension-block-keys.js';
import { extensionTypeParameters, bindExtensionConstraints, extensionParameter, extensionDeclaration } from './extension-block-symbols.js';
import { extensionMarkerAttribute, ExtensionMetadataBody } from './extension-marker-attribute.js';

const GROUP_FLAGS = TypeAttributes.NestedPublic | TypeAttributes.Sealed | TypeAttributes.SpecialName;
const MARKER_FLAGS = GROUP_FLAGS | TypeAttributes.Abstract;

function implementationOf(entry) {
  return entry.symbol.kind === SymbolKind.Method ? entry.symbol : entry.symbol.getMethod ?? entry.symbol.setMethod;
}

function groupedBlocks(owner) {
  const groups = new Map();
  const blocks = new Map();
  for (const entry of owner.extensionMembers ?? []) {
    const implementation = implementationOf(entry);
    if (!implementation?.extensionBlock || !implementation.extensionReceiver) continue;
    let block = blocks.get(implementation.extensionBlock);
    if (!block) {
      const keys = extensionBlockKeys(implementation);
      let group = groups.get(keys.grouping);
      if (!group) {
        group = { key: keys.grouping, implementation, parameters: keys.parameters, entries: [], markers: new Map() };
        groups.set(keys.grouping, group);
      }
      block = group.markers.get(keys.marker);
      if (!block) {
        block = { key: keys.marker, implementation, parameters: keys.parameters, group };
        group.markers.set(keys.marker, block);
      }
      blocks.set(implementation.extensionBlock, block);
    }
    block.group.entries.push({ entry, block });
  }
  return [...groups.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

/**
 * Synthetic declarations retain complete symbol signatures, while bodies and marker associations are explicit
 * plan data. No implementation symbol, source member list or source namespace is mutated.
 */
export class ExtensionBlockMetadataPlan {
  constructor(analysis, sourceTypes, compilerAttributes) {
    this.types = [];
    this.plans = new Map();
    this.markedTypes = new Set();
    this.declarations = new Map();
    this.bodies = new Map();
    this.markers = new Set();
    this.names = new Map();
    this.markerAttribute = null;
    for (const owner of sourceTypes) {
      if (!owner.extensionMembers?.length) continue;
      for (const group of groupedBlocks(owner)) this.addGroup(owner, group, analysis.core);
    }
    if (!this.types.length) return;
    this.markerAttribute = extensionMarkerAttribute(compilerAttributes);
  }

  name(owner, prefix, signature) {
    const name = extensionMetadataName(prefix, signature);
    let used = this.names.get(owner);
    if (!used) this.names.set(owner, used = new Map());
    if (used.has(name) && used.get(name) !== signature) throw new MetadataEmitError('extension metadata name hash collision');
    used.set(name, signature);
    return name;
  }

  addGroup(owner, record, core) {
    const parameters = extensionTypeParameters(record.parameters, null, true);
    const group = new NamedTypeSymbol({
      name: this.name(owner, 'G', record.key), containingSymbol: owner, declaredAccessibility: Accessibility.Public,
      isSealed: true, isImplicitlyDeclared: true, baseType: core.object, typeParameters: parameters,
    });
    bindExtensionConstraints(record.parameters, parameters, new TypeMap(record.parameters, parameters), true);
    this.types.push(group);
    this.markedTypes.add(owner);
    this.markedTypes.add(group);
    for (const block of [...record.markers.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)) {
      block.marker = this.addMarker(group, block, core);
    }
    for (const { entry, block } of record.entries) {
      const declaration = extensionDeclaration(entry, group, record.parameters.length);
      group.addMember(declaration);
      this.declarations.set(declaration, block.marker.name);
      if (declaration.kind === SymbolKind.Property) {
        for (const accessor of [declaration.getMethod, declaration.setMethod]) {
          if (accessor) this.declarations.set(accessor, block.marker.name);
        }
      }
    }
    const plan = planMembers(group, core, () => null);
    plan.typeFlags = GROUP_FLAGS;
    plan.emitsNullableTypeAttributes = false;
    this.plans.set(group, plan);
    for (const method of plan.methods) this.bodies.set(method, { kind: ExtensionMetadataBody.Declaration });
  }

  addMarker(group, block, core) {
    const marker = new NamedTypeSymbol({
      name: this.name(group, 'M', block.key), containingSymbol: group, declaredAccessibility: Accessibility.Public,
      isStatic: true, isImplicitlyDeclared: true, baseType: core.object,
    });
    const parameters = extensionTypeParameters(block.parameters, marker);
    // Nested arity zero still redeclares the enclosing VARs. References use those enclosing slots, not new !N slots.
    const substitution = new TypeMap(block.parameters, group.typeParameters);
    bindExtensionConstraints(block.parameters, parameters, substitution);
    const method = marker.addMember(new MethodSymbol({
      name: '<Extension>$', declaredAccessibility: Accessibility.Public, modifiers: DeclarationModifiers.Static, returnType: core.void,
      parameters: [extensionParameter(block.implementation.extensionReceiver, substitution, null)],
    }));
    method.hasBody = true;
    method.syntax = block.implementation.extensionBlock;
    method.locations = block.implementation.locations;
    const plan = planMembers(marker, core, () => null);
    plan.typeFlags = MARKER_FLAGS;
    plan.metadataTypeParameters = parameters;
    plan.methods[0].flags |= MethodAttributes.SpecialName;
    this.types.push(marker);
    this.plans.set(marker, plan);
    this.markers.add(method);
    this.bodies.set(plan.methods[0], { kind: ExtensionMetadataBody.Declaration });
    return marker;
  }
}
