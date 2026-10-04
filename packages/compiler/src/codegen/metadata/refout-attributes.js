import { encodeCustomAttribute, encodeSignature } from '@sharpforge/cil';
import { SymbolKind, TypeKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';

const DEBUGGER_BROWSABLE = 'System.Diagnostics.DebuggerBrowsableAttribute';
const DEBUGGER_STATE = 'System.Diagnostics.DebuggerBrowsableState';
const READ_ONLY = 'System.Runtime.CompilerServices.IsReadOnlyAttribute';

function hideStorage(attributes, parent) {
  const state = attributes.frameworkAttribute(DEBUGGER_STATE);
  const signature = encodeSignature({ kind: 'method', hasThis: true,
    returnType: { kind: 'primitive', name: 'void' }, parameters: [{ kind: 'valuetype', token: state }] });
  const constructor = attributes.builder.member(attributes.frameworkAttribute(DEBUGGER_BROWSABLE), '.ctor', signature);
  const value = encodeCustomAttribute([{ kind: 'enum', name: DEBUGGER_STATE, underlying: 'int' }], [0]);
  attributes.add(parent, constructor, value);
}

/** Complete retained storage/accessor attributes for refout without changing the legacy metadata-only profile. */
export function writeRefoutAttributes(attributes) {
  for (const type of attributes.writer.types) {
    const plan = attributes.writer.plans.get(type);
    for (const field of plan.fields) {
      if (field.symbol?.associatedSymbol?.kind === SymbolKind.Property || field.isDebuggerHidden) hideStorage(attributes, field.token);
    }
    if (type.typeKind !== TypeKind.Struct || type.isReadOnly) continue;
    for (const method of plan.methods) {
      const symbol = method.symbol;
      if (!symbol || symbol.isStatic) continue;
      const autoGetter = symbol.methodKind === MethodKind.PropertyGet && symbol.associatedSymbol?.isAutoProperty;
      if (symbol.isReadOnly || autoGetter) attributes.wellKnown(method.token, READ_ONLY);
    }
  }
}
