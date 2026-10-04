/**
 * What each source type contributes to the Field and MethodDef tables (SF-A02-T29), decided before any row is
 * written so that every definition has its token when signatures and cross-references are encoded.
 *
 * Besides the declared members a type gets what the language synthesizes into metadata:
 *   enum                 - the instance field `value__` of the underlying type; members are literal static fields
 *   auto-property        - the private backing field `<Name>k__BackingField`
 *   property, indexer    - the accessor methods (`get_Name`, `set_Name`)
 *   field-like event     - a private delegate field and the `add_Name` / `remove_Name` accessors
 *   delegate             - the runtime-implemented `.ctor(object, native int)`, `Invoke`, `BeginInvoke` and `EndInvoke`
 */
import { FieldAttributes, MethodAttributes, MethodImplAttributes } from '@sharpforge/cil';
import { SymbolKind, TypeKind, RefKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { isInheritedPositional } from '../../symbols/synthesized/records.js';
import { fieldFlags, methodFlags, memberAccessFlags, parameterFlags } from './attribute-flags.js';

const ENUM_VALUE_FIELD = 'value__';
const ENUM_VALUE_FLAGS = FieldAttributes.Public | FieldAttributes.SpecialName | FieldAttributes.RTSpecialName;
const ENUM_MEMBER_FLAGS = FieldAttributes.Public | FieldAttributes.Static | FieldAttributes.Literal;
const DELEGATE_CONSTRUCTOR_FLAGS =
  MethodAttributes.Public | MethodAttributes.HideBySig | MethodAttributes.SpecialName | MethodAttributes.RTSpecialName;
const DELEGATE_INVOKE_FLAGS = MethodAttributes.Public | MethodAttributes.HideBySig | MethodAttributes.Virtual | MethodAttributes.NewSlot;
const ACCESSOR_FLAGS = MethodAttributes.HideBySig | MethodAttributes.SpecialName;
const IMPLEMENTATION_FLAGS = MethodAttributes.Virtual | MethodAttributes.Final | MethodAttributes.NewSlot;

const parametersOf = method =>
  method.parameters.map(parameter => ({ name: parameter.name, flags: parameterFlags(parameter), type: parameter.type, refKind: parameter.refKind }));
const privateField = owner => FieldAttributes.Private | (owner.isStatic ? FieldAttributes.Static : 0);

/** True when an interface member of the type maps to `member` (the binder's implementation map). */
function implementedBy(type, member) {
  if (!member || !type.interfaceImplementations) return false;
  for (const implementation of type.interfaceImplementations.values()) if (implementation === member) return true;
  return false;
}

/** The interface the declaration names when it is an explicit implementation (`void I.M()`), else null. */
export function explicitInterfaceOf(method) {
  return method.explicitInterfaceType ?? method.associatedSymbol?.explicitInterfaceType ?? null;
}

/** The MethodDef row of a method symbol declared in `type`: `{symbol, name, flags, implFlags, hasBody, parameters}`. */
export function plannedMethod(type, method) {
  const inInterface = type.typeKind === TypeKind.Interface,
    isAbstract = method.isAbstract || (inInterface && !method.hasBody),
    explicit = !!explicitInterfaceOf(method);
  return {
    symbol: method,
    name: method.metadataName,
    flags: methodFlags(method, { inInterface, implementsInterface: explicit || implementedBy(type, method) || implementedBy(type, method.associatedSymbol) }),
    implFlags: MethodImplAttributes.IL,
    hasBody: !isAbstract && !method.isExtern,
    parameters: parametersOf(method),
  };
}

/** `add_Name` or `remove_Name` of a field-like event: `void accessor(EventType value)`. */
function synthesizedEventAccessor(type, event, prefix, core) {
  // An accessor an interface event maps to must be virtual for the CLR; it is sealed, as the event is not virtual.
  const slot = event.isStatic ? MethodAttributes.Static : implementedBy(type, event) ? IMPLEMENTATION_FLAGS : 0;
  return {
    symbol: null,
    name: prefix + event.name,
    flags: memberAccessFlags(event) | ACCESSOR_FLAGS | slot,
    implFlags: MethodImplAttributes.IL,
    hasBody: true,
    isCompilerGenerated: true,
    shape: { isStatic: event.isStatic, returnType: core.void, parameters: [{ type: event.type }] },
    parameters: [{ name: 'value', flags: 0 }],
  };
}

/**
 * A field-like event: its accessors are synthesized, and outside an interface so is the delegate field they guard.
 * @returns {{adder: object, remover: object}} the planned accessors, already added to `plan`
 */
function fieldLikeEvent(type, event, core, plan) {
  const adder = synthesizedEventAccessor(type, event, 'add_', core),
    remover = synthesizedEventAccessor(type, event, 'remove_', core);
  if (type.typeKind === TypeKind.Interface) {
    for (const accessor of [adder, remover]) {
      accessor.flags |= DELEGATE_INVOKE_FLAGS | MethodAttributes.Abstract;
      accessor.hasBody = false;
    }
  } else plan.fields.push({ symbol: null, name: event.name, flags: privateField(event), type: event.type, constant: null, isCompilerGenerated: true });
  plan.methods.push(adder, remover);
  return { adder, remover };
}

/** The runtime-implemented members of a delegate type, in the order Roslyn declares them. */
function delegateMethods(type, core) {
  const invoke = type.delegateInvokeMethod,
    runtime = MethodImplAttributes.Runtime,
    member = (name, flags, shape, parameters) => ({ symbol: null, name, flags, implFlags: runtime, hasBody: false, shape, parameters }),
    named = (name, type, refKind) => ({ name, flags: 0, type, refKind });
  const constructor = member(
    '.ctor',
    DELEGATE_CONSTRUCTOR_FLAGS,
    { isStatic: false, returnType: core.void, parameters: [{ type: core.object }, { type: core.intPtr }] },
    [named('object'), named('method')],
  );
  if (!invoke) return [constructor];
  const parameters = parametersOf(invoke),
    byReference = parameters.filter(parameter => parameter.refKind && parameter.refKind !== RefKind.None),
    begin = [...parameters, named('callback', 'System.AsyncCallback'), named('object', core.object)],
    end = [...byReference, named('result', 'System.IAsyncResult')];
  return [
    constructor,
    { symbol: invoke, name: 'Invoke', flags: DELEGATE_INVOKE_FLAGS, implFlags: runtime, hasBody: false, parameters },
    member('BeginInvoke', DELEGATE_INVOKE_FLAGS, { isStatic: false, returnType: 'System.IAsyncResult', parameters: begin }, begin),
    member('EndInvoke', DELEGATE_INVOKE_FLAGS, { isStatic: false, returnType: invoke.returnType, refKind: invoke.refKind, parameters: end }, end),
  ];
}

function enumFields(type, core, constantOf) {
  const fields = [{ symbol: null, name: ENUM_VALUE_FIELD, flags: ENUM_VALUE_FLAGS, type: type.enumUnderlyingType ?? core.int, constant: null }];
  for (const member of type.getMembers()) {
    if (member.kind !== SymbolKind.Field) continue;
    fields.push({ symbol: member, name: member.name, flags: ENUM_MEMBER_FLAGS, type, constant: constantOf(member) });
  }
  return fields;
}

/**
 * The rows one source type declares.
 * @param type a source type definition  @param core the core types  @param {(field) => object|null} constantOf
 * @returns {{fields: object[], methods: object[], properties: object[], events: object[]}} `properties` and `events`
 *   refer to their accessors by the planned method objects
 */
export function planMembers(type, core, constantOf) {
  const plan = { fields: [], methods: [], properties: [], events: [] };
  if (type.typeKind === TypeKind.Enum) {
    plan.fields = enumFields(type, core, constantOf);
    return plan;
  }
  if (type.typeKind === TypeKind.Delegate) {
    plan.methods = delegateMethods(type, core);
    return plan;
  }
  const isStruct = type.typeKind === TypeKind.Struct,
    declared = new Set(),
    addField = (field, flags = fieldFlags(field)) => {
      if (declared.has(field)) return;
      declared.add(field);
      plan.fields.push({ symbol: field, name: field.name, flags, type: field.type, constant: field.isConst ? constantOf(field) : null });
    },
    addMethod = method => {
      if (declared.has(method)) return null;
      declared.add(method);
      const planned = plannedMethod(type, method);
      plan.methods.push(planned);
      return planned;
    };
  for (const member of type.getMembers()) {
    if (member.kind === SymbolKind.Field) addField(member);
    else if (member.kind === SymbolKind.Method) {
      // A struct has no parameterless constructor in metadata unless the program declares one.
      const implicitStructConstructor = isStruct && member.isImplicitlyDeclared && member.methodKind === MethodKind.Constructor;
      if (!implicitStructConstructor) addMethod(member);
    }
    else if (member.kind === SymbolKind.Property) {
      // A positional parameter a base record already has a property for declares nothing here.
      if (isInheritedPositional(type, member)) continue;
      // The backing field of a property without a `set` accessor (get-only, or `init`) is `initonly`.
      if (member.backingField) addField(member.backingField, privateField(member) | (member.backingField.isReadOnly ? FieldAttributes.InitOnly : 0));
      const getter = member.getMethod ? addMethod(member.getMethod) : null,
        setter = member.setMethod ? addMethod(member.setMethod) : null;
      plan.properties.push({ symbol: member, getter, setter });
    } else if (member.kind === SymbolKind.Event) {
      const accessors = member.addMethod
        ? { adder: addMethod(member.addMethod), remover: addMethod(member.removeMethod) }
        : fieldLikeEvent(type, member, core, plan);
      plan.events.push({ symbol: member, ...accessors });
    }
  }
  return plan;
}
