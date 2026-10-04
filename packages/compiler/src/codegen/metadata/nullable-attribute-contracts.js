/** Resolve Nullable/NullableContext contracts, embedding complete definitions only when the target lacks them. */
import { ArrayTypeSymbol, Accessibility } from '../../symbols/types.js';
import { FieldSymbol, DeclarationModifiers } from '../../symbols/members.js';
import { AttributeTargets as T } from '../../symbols/attribute-types.js';
import { planMembers } from './member-plan.js';
import {
  CompilerAttributeBody, compilerAttributeType, compilerAttributeConstructor, requiredAttributeConstructor, fieldAttributeContract,
} from './compiler-attribute-symbols.js';

export const NULLABLE_ATTRIBUTE = 'System.Runtime.CompilerServices.NullableAttribute';
export const NULLABLE_CONTEXT_ATTRIBUTE = 'System.Runtime.CompilerServices.NullableContextAttribute';
const nullableUsage = { targets: T.Class | T.Event | T.Field | T.GenericParameter | T.Parameter | T.Property | T.ReturnValue,
  allowMultiple: false, inherited: false };
const contextUsage = { targets: T.Class | T.Delegate | T.Interface | T.Method | T.Struct, allowMultiple: false, inherited: false };

function nullableAttributeContract(analysis, existing, required) {
  const core = analysis.core, bytes = new ArrayTypeSymbol(core.byte), constructors = new Map();
  if (existing) {
    for (const key of required) constructors.set(key, requiredAttributeConstructor(existing, [key === 'byte' ? core.byte : bytes], core.attribute));
    return { type: existing, constructors, plan: null, bodies: new Map() };
  }
  const type = compilerAttributeType(analysis, NULLABLE_ATTRIBUTE);
  const field = type.addMember(new FieldSymbol({
    name: 'NullableFlags', type: bytes, declaredAccessibility: Accessibility.Public, modifiers: DeclarationModifiers.ReadOnly,
  }));
  constructors.set('byte', compilerAttributeConstructor(type, core, [{ name: '', type: core.byte }]));
  constructors.set('byte[]', compilerAttributeConstructor(type, core, [{ name: '', type: bytes }]));
  const plan = planMembers(type, core, () => null), bodies = new Map();
  for (const method of plan.methods) {
    const kind = method.symbol === constructors.get('byte') ? CompilerAttributeBody.ByteArrayConstructor : CompilerAttributeBody.FieldConstructor;
    bodies.set(method, { kind, field });
  }
  return { type, constructors, plan, bodies, usage: nullableUsage };
}

/** All needed overloads are known before symbols/rows are allocated; unused malformed overloads are irrelevant. */
export function prepareNullableAttributes(writer) {
  const required = new Set();
  let context = false;
  for (const current of writer.nullableMetadata?.scopes.values() ?? []) {
    context ||= current.contextAttribute !== null;
    for (const item of current.entries) if (item.flags.length) required.add(item.flags.length === 1 ? 'byte' : 'byte[]');
  }
  const registry = writer.compilerAttributes;
  if (required.size) registry.getOrCreate(NULLABLE_ATTRIBUTE, (analysis, existing) => nullableAttributeContract(analysis, existing, required));
  if (context) registry.getOrCreate(NULLABLE_CONTEXT_ATTRIBUTE, (analysis, existing) => fieldAttributeContract(analysis, existing, {
    fullName: NULLABLE_CONTEXT_ATTRIBUTE, fieldName: 'Flag', fieldType: analysis.core.byte, usage: contextUsage,
  }));
}
