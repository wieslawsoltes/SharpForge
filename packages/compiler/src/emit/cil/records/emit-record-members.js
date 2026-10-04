/**
 * Bodies of the members a record synthesizes (SF-A02-T30), as Roslyn generates them:
 *
 *   Equals(R)        same reference, or `other != null`, equal `EqualityContract` (or `base.Equals(other)`) and every
 *                    instance field equal by `EqualityComparer<T>.Default`
 *   Equals(object)   `Equals(obj as R)`;  Equals(Base)  `Equals((object)other)`
 *   GetHashCode      the contract's (or the base's) hash, then `* -1521134295 + hash(field)` per field
 *   ToString         `Name { ` + PrintMembers + ` }`;  PrintMembers  `A = 1, B = x` after the base's members
 *   == / !=          reference equality or `left.Equals(right)`
 *   Deconstruct      one `out` parameter per positional property
 *   EqualityContract `typeof(R)`;  <Clone>$  `new R(this)`
 *
 * The method dispatch is in emit-records.js; these functions run with the method emitter as `this`.
 */
import { SymbolKind, TypeKind } from '../../../symbols/types.js';
import { MethodKind } from '../../../symbols/members.js';
import { positionalProperties } from '../../../symbols/synthesized/records.js';
import { isReference } from '../type-facts.js';
import { baseRecordOf, memberOn, storedFields, printableMembers, isInheritedPositional } from '../../../codegen/metadata/record-plan.js';

/** The multiplier Roslyn's synthesized GetHashCode combines members with. */
const HASH_FACTOR = -1521134295;
const RETURN_VALUE = { pops: 1, pushes: 0 };

const methodNamed = (type, name, matches) => type.getMembers(name).find(member => member.kind === SymbolKind.Method && matches(member.parameters)) ?? null;
const takesSelf = type => parameters => parameters.length === 1 && (parameters[0].type.originalDefinition ?? parameters[0].type) === type;
const typedEqualsOf = type => methodNamed(type, 'Equals', takesSelf(type));

/** Pushes `EqualityComparer<T>.Default` for a field type. */
function comparer(emitter, type) {
  const definition = emitter.core.bridge.coreType('System_Collections_Generic_EqualityComparer_T'),
    open = definition.construct([definition.typeParameters[0]]),
    shape = { isStatic: true, returnType: open, parameters: [] },
    constructed = definition.construct([type]);
  emitter.il.emit('call', emitter.tokens.external(constructed, 'get_Default', shape), { pops: 0, pushes: 1 });
  const element = { type: definition.typeParameters[0] };
  return {
    equals: () => {
      const equalsShape = { isStatic: false, returnType: emitter.core.bool, parameters: [element, element] };
      emitter.il.emit('callvirt', emitter.tokens.external(constructed, 'Equals', equalsShape), { pops: 3, pushes: 1 });
    },
    hash: () => {
      const hashShape = { isStatic: false, returnType: emitter.core.int, parameters: [element] };
      emitter.il.emit('callvirt', emitter.tokens.external(constructed, 'GetHashCode', hashShape), { pops: 2, pushes: 1 });
    },
  };
}

function contractGetter(emitter, type) {
  return emitter.program.records.membersOf(type).equalityContract.getMethod;
}

/** `this.EqualityContract` (a virtual call). */
function pushContract(emitter, type, argument) {
  emitter.il.emit('ldarg', argument);
  emitter.callMethod(contractGetter(emitter, type), { receiver: { type } });
}

export function equalsBody(type) {
  const il = this.il,
    isClass = isReference(type),
    base = baseRecordOf(type),
    equal = il.newLabel(),
    unequal = il.newLabel();
  if (isClass) {
    il.emit('ldarg', 0).emit('ldarg', 1).emit('beq', equal);
    il.emit('ldarg', 1).emit('brfalse', unequal);
    if (base) {
      const baseEquals = typedEqualsOf(base.originalDefinition ?? base);
      il.emit('ldarg', 0).emit('ldarg', 1);
      il.emit('call', this.tokens.method(memberOn(base, baseEquals)), { pops: 2, pushes: 1 }).emit('brfalse', unequal);
    } else {
      pushContract(this, type, 0);
      pushContract(this, type, 1);
      const typeType = this.core.type,
        shape = { isStatic: true, returnType: this.core.bool, parameters: [{ type: typeType }, { type: typeType }] };
      il.emit('call', this.tokens.external(typeType, 'op_Equality', shape), { pops: 2, pushes: 1 }).emit('brfalse', unequal);
    }
  }
  for (const field of storedFields(type)) {
    const token = this.tokens.field(field),
      compare = comparer(this, field.type);
    il.emit('ldarg', 0).emit('ldfld', token).emit(isClass ? 'ldarg' : 'ldarga', 1).emit('ldfld', token);
    compare.equals();
    il.emit('brfalse', unequal);
  }
  il.mark(equal);
  il.emit('ldc.i4', 1).emit('ret', undefined, RETURN_VALUE);
  il.mark(unequal);
  il.emit('ldc.i4', 0).emit('ret', undefined, RETURN_VALUE);
}

export function equalsObjectBody(type) {
  const il = this.il,
    token = this.tokens.type(type),
    typedEquals = typedEqualsOf(type);
  if (isReference(type)) {
    il.emit('ldarg', 0).emit('ldarg', 1).emit('isinst', token);
    this.callMethod(typedEquals, { receiver: { type } });
    return il.emit('ret', undefined, RETURN_VALUE);
  }
  const other = il.newLabel();
  il.emit('ldarg', 1).emit('isinst', token).emit('brfalse', other);
  il.emit('ldarg', 0).emit('ldarg', 1).emit('unbox.any', token);
  this.callMethod(typedEquals, { receiver: { type } });
  il.emit('ret', undefined, RETURN_VALUE);
  il.mark(other);
  return il.emit('ldc.i4', 0).emit('ret', undefined, RETURN_VALUE);
}

/** `sealed override bool Equals(Base other) => Equals((object)other)`. */
export function equalsBaseBody(type) {
  const equalsObject = methodNamed(type, 'Equals', parameters => parameters.length === 1 && parameters[0].type === this.core.object);
  this.il.emit('ldarg', 0).emit('ldarg', 1);
  this.callMethod(equalsObject, { receiver: { type } });
  this.il.emit('ret', undefined, RETURN_VALUE);
}

export function hashBody(type) {
  const il = this.il,
    base = baseRecordOf(type),
    fields = storedFields(type);
  let hasValue = true;
  if (base) {
    const baseHash = methodNamed(base.originalDefinition ?? base, 'GetHashCode', parameters => !parameters.length);
    il.emit('ldarg', 0).emit('call', this.tokens.method(memberOn(base, baseHash)), { pops: 1, pushes: 1 });
  } else if (isReference(type)) {
    const contract = comparer(this, this.core.type);
    pushContract(this, type, 0);
    contract.hash();
  } else hasValue = false;
  for (const field of fields) {
    if (hasValue) il.emit('ldc.i4', HASH_FACTOR).emit('mul');
    const hashing = comparer(this, field.type);
    il.emit('ldarg', 0).emit('ldfld', this.tokens.field(field));
    hashing.hash();
    if (hasValue) il.emit('add');
    hasValue = true;
  }
  if (!hasValue) il.emit('ldc.i4', 0);
  il.emit('ret', undefined, RETURN_VALUE);
}

/** The members of `StringBuilder` the text of a record is built with. */
function builderCalls(emitter) {
  const core = emitter.core,
    builder = core.bridge.coreType('System_Text_StringBuilder'),
    append = (parameterType, pushValue) => {
      const shape = { isStatic: false, returnType: builder, parameters: [{ type: parameterType }] };
      pushValue();
      emitter.il.emit('callvirt', emitter.tokens.external(builder, 'Append', shape), { pops: 2, pushes: 1 }).emit('pop');
    };
  return { builder, append };
}

export function toStringBody(type) {
  const il = this.il,
    core = this.core,
    { builder, append } = builderCalls(this),
    slot = this.temp(builder),
    load = () => il.emit('ldloc', slot),
    closing = il.newLabel(),
    printMembers = this.program.records.membersOf(type).printMembers;
  il.emit('newobj', this.tokens.external(builder, '.ctor', { isStatic: false, returnType: core.void, parameters: [] }), { pops: 0, pushes: 1 });
  il.emit('stloc', slot);
  load();
  append(core.string, () => il.emit('ldstr', this.tokens.string(type.name)));
  load();
  append(core.string, () => il.emit('ldstr', this.tokens.string(' { ')));
  il.emit('ldarg', 0);
  load();
  this.callMethod(printMembers, { receiver: { type } });
  il.emit('brfalse', closing);
  load();
  append(core.char, () => il.emit('ldc.i4', 0x20));
  il.mark(closing);
  load();
  append(core.char, () => il.emit('ldc.i4', 0x7d));
  load();
  const toString = core.object.getMembers('ToString').find(member => member.kind === SymbolKind.Method && !member.parameters.length);
  this.callMethod(toString, { receiver: { type: builder } });
  il.emit('ret', undefined, RETURN_VALUE);
}

export function printMembersBody(type) {
  const il = this.il,
    core = this.core,
    { append } = builderCalls(this),
    base = baseRecordOf(type),
    members = printableMembers(type),
    builder = () => il.emit('ldarg', 1);
  if (base) {
    const basePrint = this.program.records.membersOf(base).printMembers;
    il.emit('ldarg', 0).emit('ldarg', 1);
    il.emit('call', this.tokens.method(memberOn(base, basePrint)), { pops: 2, pushes: 1 });
    if (!members.length) return il.emit('ret', undefined, RETURN_VALUE);
    const first = il.newLabel();
    il.emit('brfalse', first);
    builder();
    append(core.string, () => il.emit('ldstr', this.tokens.string(', ')));
    il.mark(first);
  }
  members.forEach((member, index) => {
    builder();
    append(core.string, () => il.emit('ldstr', this.tokens.string((index ? ', ' : '') + member.name + ' = ')));
    builder();
    printValue.call(this, type, member, append);
  });
  il.emit('ldc.i4', members.length ? 1 : 0).emit('ret', undefined, RETURN_VALUE);
}

/** Appends one member: a value type as its `ToString()`, a reference as an object (null prints nothing). */
function printValue(type, member, append) {
  const il = this.il,
    core = this.core,
    memberType = member.type,
    read = () => {
      il.emit('ldarg', 0);
      if (member.kind === SymbolKind.Field) il.emit('ldfld', this.tokens.field(member));
      else this.callMethod(member.getMethod, { receiver: { type } });
    };
  if (isReference(memberType) && memberType.typeKind !== TypeKind.TypeParameter) return append(core.object, read);
  // A type parameter that may be a reference type is printed through a box: a null reference prints nothing.
  if (memberType.typeKind === TypeKind.TypeParameter && !memberType.isValueType) {
    return append(core.object, () => {
      read();
      il.emit('box', this.tokens.type(memberType));
    });
  }
  return append(core.string, () => {
    const slot = this.temp(memberType),
      toString = core.object.getMembers('ToString').find(candidate => candidate.kind === SymbolKind.Method && !candidate.parameters.length);
    read();
    il.emit('stloc', slot).emit('ldloca', slot).emit('constrained.', this.tokens.type(memberType));
    il.emit('callvirt', this.tokens.method(toString), { pops: 1, pushes: 1 });
  });
}

export function equalityOperatorBody(type) {
  const il = this.il,
    typedEquals = typedEqualsOf(type);
  if (!isReference(type)) {
    il.emit('ldarga', 0).emit('ldarg', 1);
    this.callMethod(typedEquals, { receiver: { type } });
    return il.emit('ret', undefined, RETURN_VALUE);
  }
  const same = il.newLabel(),
    different = il.newLabel();
  il.emit('ldarg', 0).emit('ldarg', 1).emit('beq', same);
  il.emit('ldarg', 0).emit('brfalse', different);
  il.emit('ldarg', 0).emit('ldarg', 1);
  this.callMethod(typedEquals, { receiver: { type } });
  il.emit('ret', undefined, RETURN_VALUE);
  il.mark(same);
  il.emit('ldc.i4', 1).emit('ret', undefined, RETURN_VALUE);
  il.mark(different);
  return il.emit('ldc.i4', 0).emit('ret', undefined, RETURN_VALUE);
}

export function inequalityOperatorBody(type) {
  const equality = type.getMembers('op_Equality').find(member => member.methodKind === MethodKind.UserDefinedOperator && member.parameters.length === 2);
  this.il.emit('ldarg', 0).emit('ldarg', 1);
  this.callMethod(equality, {});
  this.il.emit('ldc.i4', 0).emit('ceq').emit('ret', undefined, RETURN_VALUE);
}

export function deconstructBody(type, method) {
  const il = this.il,
    properties = new Map(positionalProperties(type).map(property => [property.name, property]));
  method.parameters.forEach((parameter, index) => {
    const property = properties.get(parameter.name) ?? type.getMembers(parameter.name).find(member => member.kind === SymbolKind.Property);
    il.emit('ldarg', index + 1).emit('ldarg', 0);
    this.callMethod(property.getMethod, { receiver: { type } });
    this.storeIndirect(parameter.type);
  });
  il.emit('ret', undefined, { pops: 0, pushes: 0 });
}

export function equalityContractBody(type) {
  const typeType = this.core.type,
    handle = this.core.bridge.coreType('System_RuntimeTypeHandle'),
    shape = { isStatic: true, returnType: typeType, parameters: [{ type: handle }] };
  this.il.emit('ldtoken', this.tokens.type(type));
  this.il.emit('call', this.tokens.external(typeType, 'GetTypeFromHandle', shape), { pops: 1, pushes: 1 });
  this.il.emit('ret', undefined, RETURN_VALUE);
}

/** The copy constructor of a record class: `R(R original)`. */
export function copyConstructorOf(type) {
  return methodNamed(type, '.ctor', takesSelf(type));
}

export function cloneBody(type) {
  this.il.emit('ldarg', 0);
  this.il.emit('newobj', this.tokens.method(copyConstructorOf(type)), { pops: 1, pushes: 1 });
  this.il.emit('ret', undefined, RETURN_VALUE);
}

/** What the synthesized copy constructor runs: the base copy (or `object()`), then every field is copied. */
export function copyConstructorPrologue(type) {
  const il = this.il,
    base = baseRecordOf(type);
  il.emit('ldarg', 0);
  if (base) {
    const baseCopy = copyConstructorOf(base.originalDefinition ?? base);
    il.emit('ldarg', 1).emit('call', this.tokens.method(memberOn(base, baseCopy)), { pops: 2, pushes: 0 });
  } else {
    const objectConstructor = this.core.object.getMembers('.ctor').find(member => !member.parameters.length);
    il.emit('call', this.tokens.method(objectConstructor), { pops: 1, pushes: 0 });
  }
  for (const field of storedFields(type)) {
    const token = this.tokens.field(field);
    il.emit('ldarg', 0).emit('ldarg', 1).emit('ldfld', token).emit('stfld', token);
  }
}

/** The primary constructor of a record first stores each positional parameter in the property it declares. */
export function positionalInitializers(type, constructor) {
  constructor.parameters.forEach((parameter, index) => {
    const property = type.getMembers(parameter.name).find(member => member.kind === SymbolKind.Property && member.isPositional);
    if (!property?.backingField || isInheritedPositional(type, property)) return;
    this.il.emit('ldarg', 0).emit('ldarg', index + 1).emit('stfld', this.tokens.field(property.backingField));
  });
}
