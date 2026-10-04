/**
 * The generic classes behind anonymous types (SF-A02-T30), declared as Roslyn declares them. For the member names
 * `Name, Age`:
 *
 *   internal sealed class <>f__AnonymousType0<<Name>j__TPar, <Age>j__TPar>
 *     private readonly <Name>j__TPar <Name>i__Field;  ...            one field per member
 *     public <Name>j__TPar Name { get; }  ...                         one read-only property per member
 *     .ctor(<Name>j__TPar Name, <Age>j__TPar Age)                     stores the fields
 *     Equals(object)   an instance of the same construction whose fields are equal by `EqualityComparer<T>.Default`
 *     GetHashCode()    `hash * -1521134295 + EqualityComparer<T>.Default.GetHashCode(field)` per field
 *     ToString()       `{ Name = x, Age = 3 }`: `string.Format(null, "{{ Name = {0}, Age = {1} }}", texts)`
 *
 * The class is a planned type without member symbols: its rows are the additions made here, and code names a member
 * of a construction through `anonymousMemberToken`.
 */
import { FieldAttributes, MethodAttributes } from '@sharpforge/cil';
import { PropertySymbol, MethodSymbol, MethodKind } from '../../symbols/members.js';
import { Accessibility, TypeKind } from '../../symbols/types.js';
import { methodSignature } from '../../codegen/metadata/member-signatures.js';
import { IlBuilder } from './il-builder.js';
import { CONSTRUCTOR_FLAGS, callObjectConstructor, synthesizedMethod } from './synthesized-types.js';
import { selfTypeOf } from './generic-context.js';
import { frameworkType } from './framework-types.js';
import { comparer } from './records/emit-record-members.js';

const FIELD_FLAGS = FieldAttributes.Private | FieldAttributes.InitOnly;
const GETTER_FLAGS = MethodAttributes.Public | MethodAttributes.HideBySig | MethodAttributes.SpecialName;
const OVERRIDE_FLAGS = MethodAttributes.Public | MethodAttributes.HideBySig | MethodAttributes.Virtual;
/** The multiplier Roslyn's synthesized GetHashCode combines members with, and a seed for a type without members. */
const HASH_FACTOR = -1521134295;
const HASH_SEED = 0x51ed270b;
const RETURN_VALUE = { pops: 1, pushes: 0 };

const fieldNameOf = name => `<${name}>i__Field`;

/** `{{ Name = {0}, Age = {1} }}`: the composite format of `ToString`; braces in a member name are escaped. */
function formatOf(names) {
  const escape = text => text.replace(/\{/g, '{{').replace(/\}/g, '}}');
  if (!names.length) return '{{ }}';
  return '{{ ' + names.map((name, index) => `${escape(name)} = {${index}}`).join(', ') + ' }}';
}

function constructorBody(members) {
  return program => {
    const il = callObjectConstructor(program, new IlBuilder());
    members.forEach((member, index) => {
      il.emit('ldarg', 0)
        .emit('ldarg', index + 1)
        .emit('stfld', program.tokens.planned(member.field, member.owner));
    });
    return il.emit('ret', undefined, { pops: 0, pushes: 0 });
  };
}

function getterBody(member) {
  return program => new IlBuilder().emit('ldarg', 0).emit('ldfld', program.tokens.planned(member.field, member.owner)).emit('ret', undefined, RETURN_VALUE);
}

function equalsBody(template, members) {
  return program => {
    const il = new IlBuilder(),
      self = program.tokens.type(template.selfType),
      other = il.declareLocal(template.selfType),
      equal = il.newLabel(),
      unequal = il.newLabel();
    il.emit('ldarg', 1).emit('isinst', self).emit('stloc', other);
    il.emit('ldarg', 0).emit('ldloc', other).emit('beq', equal);
    il.emit('ldloc', other).emit('brfalse', unequal);
    for (const member of members) {
      const token = program.tokens.planned(member.field, member.owner),
        compare = comparer({ core: program.core, tokens: program.tokens, il }, member.field.type);
      il.emit('ldarg', 0).emit('ldfld', token).emit('ldloc', other).emit('ldfld', token);
      compare.equals();
      il.emit('brfalse', unequal);
    }
    il.mark(equal);
    il.emit('ldc.i4', 1).emit('ret', undefined, RETURN_VALUE);
    il.mark(unequal);
    return il.emit('ldc.i4', 0).emit('ret', undefined, RETURN_VALUE);
  };
}

function hashBody(members) {
  return program => {
    const il = new IlBuilder();
    il.emit('ldc.i4', HASH_SEED);
    for (const member of members) {
      il.emit('ldc.i4', HASH_FACTOR).emit('mul');
      const compare = comparer({ core: program.core, tokens: program.tokens, il }, member.field.type);
      il.emit('ldarg', 0).emit('ldfld', program.tokens.planned(member.field, member.owner));
      compare.hash();
      il.emit('add');
    }
    return il.emit('ret', undefined, RETURN_VALUE);
  };
}

/** `string.Format(null, format, new object[] { field?.ToString(), ... })`; a null member prints as nothing. */
function toStringBody(members) {
  return program => {
    const il = new IlBuilder(),
      core = program.core,
      tokens = program.tokens,
      objects = core.arrayOf(core.object),
      provider = frameworkType(core, 'System', 'IFormatProvider', { typeKind: TypeKind.Interface }),
      toStringShape = { isStatic: false, returnType: core.string, parameters: [] },
      formatShape = { isStatic: true, returnType: core.string, parameters: [{ type: provider }, { type: core.string }, { type: objects }] };
    il.emit('ldnull').emit('ldstr', tokens.string(formatOf(members.map(member => member.name))));
    il.emit('ldc.i4', members.length).emit('newarr', tokens.type(core.object));
    members.forEach((member, index) => {
      const type = member.field.type,
        value = il.declareLocal(type),
        hasValue = il.newLabel(),
        store = il.newLabel();
      il.emit('dup').emit('ldc.i4', index);
      il.emit('ldarg', 0).emit('ldfld', tokens.planned(member.field, member.owner)).emit('stloc', value);
      il.emit('ldloca', value).emit('ldloc', value).emit('box', tokens.type(type)).emit('brtrue', hasValue);
      il.emit('pop').emit('ldnull').emit('br', store);
      il.mark(hasValue);
      il.emit('constrained.', tokens.type(type));
      il.emit('callvirt', tokens.external(core.object, 'ToString', toStringShape), { pops: 1, pushes: 1 });
      il.mark(store);
      il.emit('stelem.ref');
    });
    return il.emit('call', tokens.external(core.string, 'Format', formatShape), { pops: 3, pushes: 1 }).emit('ret', undefined, RETURN_VALUE);
  };
}

/**
 * The rows of one anonymous type class, added to its member plan.
 * @param template the generic class (symbols/synthesized/anonymous-types.js)  @param plan its member plan
 * @param core the core types
 */
export function planAnonymousTemplate(template, plan, core) {
  const parameters = template.typeParameters,
    instance = (returnType, types) => ({ isStatic: false, returnType, parameters: types.map(type => ({ type })) });
  template.isSource = true;
  template.selfType = selfTypeOf(template, parameters);
  const members = template.anonymousMemberNames.map((name, index) => {
    const type = parameters[index],
      field = { symbol: null, name: fieldNameOf(name), flags: FIELD_FLAGS, type, constant: null, isCompilerGenerated: true };
    return { name, field, owner: template };
  });
  plan.fields.push(...members.map(member => member.field));
  const constructor = synthesizedMethod(
    '.ctor',
    CONSTRUCTOR_FLAGS,
    instance(
      core.void,
      members.map(member => member.field.type),
    ),
    members.map(member => member.name),
    constructorBody(members),
  );
  plan.methods.push(constructor);
  for (const member of members) {
    const getter = synthesizedMethod('get_' + member.name, GETTER_FLAGS, instance(member.field.type, []), [], getterBody(member)),
      getMethod = new MethodSymbol({ name: getter.name, methodKind: MethodKind.PropertyGet, returnType: member.field.type }),
      symbol = new PropertySymbol({ name: member.name, type: member.field.type, getMethod, declaredAccessibility: Accessibility.Public });
    plan.methods.push(getter);
    plan.properties.push({ symbol, getter, setter: null });
  }
  plan.methods.push(
    synthesizedMethod('Equals', OVERRIDE_FLAGS, instance(core.bool, [core.object]), ['value'], equalsBody(template, members)),
    synthesizedMethod('GetHashCode', OVERRIDE_FLAGS, instance(core.int, []), [], hashBody(members)),
    synthesizedMethod('ToString', OVERRIDE_FLAGS, instance(core.string, []), [], toStringBody(members)),
  );
}

/**
 * The token of a member of an anonymous type as code names it: a MemberRef on the construction, with the signature
 * the generic class declares (`!0 get_Name()`).
 * @param tokens the MemberTokens of the code  @param type the anonymous type symbol  @param {string} name `.ctor` or `get_<Member>`
 */
export function anonymousMemberToken(tokens, type, name) {
  const form = type.metadataForm(),
    template = form.originalDefinition ?? form,
    planned = tokens.writer.plans.get(template).methods.find(method => method.name === name);
  if (!template.arity) return planned.token;
  return tokens.builder.member(tokens.type(type), planned.name, methodSignature(tokens.definitionTypes, planned.shape));
}
