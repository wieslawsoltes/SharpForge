/** Attribute targets of extension syntax, while implementation accessors remain ordinary static methods. */
import { SymbolKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { attributeLocations } from './attribute-targets.js';

class ExtensionAttributeBinding {
  constructor(analysis) {
    this.analysis = analysis;
    this.properties = new Map();
    this.parameters = new Map();
  }

  propertiesOf(type) {
    let properties = this.properties.get(type);
    if (properties) return properties;
    properties = new Map();
    for (const entry of type.extensionMembers ?? []) {
      if (entry.symbol.kind !== SymbolKind.Property) continue;
      for (const accessor of [entry.symbol.getMethod, entry.symbol.setMethod]) {
        if (accessor) properties.set(accessor, entry.symbol);
      }
    }
    this.properties.set(type, properties);
    return properties;
  }

  /** A block receiver/type parameter is copied per implementation, but its source attribute diagnostics occur once. */
  bindParameter(parameter, scope, type) {
    if (!parameter?.syntax?.attributeLists?.length || parameter.boundAttributes) return;
    const existing = this.parameters.get(parameter.syntax);
    if (existing) {
      parameter.boundAttributes = existing.boundAttributes;
      if (existing.obsolete) parameter.obsolete = existing.obsolete;
      return;
    }
    this.analysis.bindDeclared(parameter, parameter.syntax, scope, type);
    this.parameters.set(parameter.syntax, parameter);
  }

  bind(member, type) {
    const analysis = this.analysis, scope = member.scope ?? type.primaryScope;
    const property = this.propertiesOf(type).get(member);
    if (property) analysis.bindDeclared(property, property.syntax, scope, type);
    const syntax = property?.syntax === member.syntax ? null : member.syntax;
    const locations = property ? attributeLocations({ kind: SymbolKind.Method,
      methodKind: property.setMethod === member ? MethodKind.PropertySet : MethodKind.PropertyGet }) : null;
    analysis.bindDeclared(member, syntax, scope, type, locations);
    this.bindParameter(member.extensionReceiver, scope, type);
    for (const parameter of member.typeParameters) this.bindParameter(parameter, scope, type);
    for (const parameter of member.parameters) this.bindParameter(parameter, scope, type);
    analysis.decodeMethodAttributes(member);
  }
}

/** Returns true when extension syntax supplied all targets; ordinary members use their existing binding path. */
export function bindExtensionMemberAttributes(analysis, member, type) {
  if (!member.extensionBlock) return false;
  const binding = analysis.extensionAttributeBinding ??= new ExtensionAttributeBinding(analysis);
  binding.bind(member, type);
  return true;
}
