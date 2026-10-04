import { CilError, TableId, referenceAssemblyMemberIncluded } from '@sharpforge/cil';
import { TypeKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { attributesNamed } from '../../binder/bound-attributes.js';
import { explicitInterfaceOf } from './member-plan.js';

const friendAttribute = 'System.Runtime.CompilerServices.InternalsVisibleToAttribute';
const markerAttribute = 'System.Runtime.CompilerServices.ReferenceAssemblyAttribute';

/** Validate the opt-in before table allocation. Metadata-only emission retains its historical default surface. */
export function refoutEnabled(options) {
  if (options.refout !== undefined && typeof options.refout !== 'boolean') throw new CilError('refout must be boolean');
  if (options.refout && ['module', 'netmodule'].includes(options.outputKind)) {
    throw new CilError('Reference assembly emission does not support netmodules');
  }
  return options.refout === true;
}

/**
 * Filters a planned source declaration before definition tokens are assigned. The plan's methods, fields and
 * accessor relations remain in their original order. All types remain, including private nested declarations.
 * Attribute ancestry is memoized per compilation, so inherited classification is linear in distinct base links.
 */
export class RefoutPlan {
  constructor(analysis) {
    this.includesInternals = attributesNamed(analysis.assembly, friendAttribute).some(attribute => attribute.location === 'assembly');
    this.hasMarker = attributesNamed(analysis.assembly, markerAttribute).some(attribute => attribute.location === 'assembly');
    this.attributeKinds = new Map([[analysis.core.attribute, true]]);
  }

  isAttributeType(type) {
    const path = [];
    const seen = new Set();
    let current = type?.originalDefinition ?? type;
    while (current && !this.attributeKinds.has(current)) {
      if (seen.has(current)) throw new CilError('Cyclic attribute ancestry in reference emission');
      if (path.length >= 256) throw new CilError('Reference attribute ancestry exceeds 256 levels');
      seen.add(current);
      path.push(current);
      const base = current.baseType;
      current = base?.originalDefinition ?? base;
    }
    const result = this.attributeKinds.get(current) ?? false;
    for (const item of path) this.attributeKinds.set(item, result);
    return result;
  }

  filter(type, plan) {
    const context = { includesInternals: this.includesInternals, isStruct: type.typeKind === TypeKind.Struct };
    const isAttribute = this.isAttributeType(type);
    // Removing a private .cctor must not change the declaration's BeforeFieldInit bit.
    plan.hasStaticConstructor = plan.methods.some(method => method.name === '.cctor' && !method.isInitializerOnly);
    plan.fields = plan.fields.filter(field => referenceAssemblyMemberIncluded(TableId.Field, field.flags, context));
    plan.methods = plan.methods.filter(method => referenceAssemblyMemberIncluded(TableId.MethodDef, method.flags, {
      includesInternals: this.includesInternals,
      isAttributeConstructor: isAttribute && method.symbol?.methodKind === MethodKind.Constructor,
      isExplicitImplementation: !!method.symbol && !!explicitInterfaceOf(method.symbol),
    }));
    const methods = new Set(plan.methods);
    plan.properties = plan.properties.flatMap(property => {
      const getter = methods.has(property.getter) ? property.getter : null;
      const setter = methods.has(property.setter) ? property.setter : null;
      return getter || setter ? [{ ...property, getter, setter }] : [];
    });
    plan.events = plan.events.flatMap(event => {
      const adder = methods.has(event.adder) ? event.adder : null;
      const remover = methods.has(event.remover) ? event.remover : null;
      return adder || remover ? [{ ...event, adder, remover }] : [];
    });
  }
}
