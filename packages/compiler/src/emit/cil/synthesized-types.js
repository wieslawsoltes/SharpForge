/**
 * Compiler-generated classes (SF-A02-T30): the bookkeeping closure conversion and the state machines share. A
 * synthesized class is nested in the type whose code it serves - so that its code may use that type's private
 * members - and its fields and methods are additions to the member plan (synthesized-members.js).
 */
import { MethodAttributes, FieldAttributes, MethodImplAttributes } from '@sharpforge/cil';
import { NamedTypeSymbol, TypeKind, Accessibility } from '../../symbols/types.js';
import { IlBuilder } from './il-builder.js';
import { classTypeParameterCopies, substitutionOver, selfTypeOf } from './generic-context.js';

export const CONSTRUCTOR_FLAGS =
  MethodAttributes.Public | MethodAttributes.HideBySig | MethodAttributes.SpecialName | MethodAttributes.RTSpecialName;

/** `ldarg.0; call object::.ctor()`, the start of every synthesized constructor. */
export function callObjectConstructor(program, il) {
  const core = program.core,
    shape = { isStatic: false, returnType: core.void, parameters: [] };
  return il.emit('ldarg', 0).emit('call', program.tokens.external(core.object, '.ctor', shape), { pops: 1, pushes: 0 });
}

/** `ldarg.0; call object::.ctor(); ret` */
function objectConstructorBody(program) {
  return callObjectConstructor(program, new IlBuilder()).emit('ret', undefined, { pops: 0, pushes: 0 });
}

/** A planned method without a symbol: `emitBody(program)` returns its instruction stream. */
export function synthesizedMethod(name, flags, shape, parameterNames, emitBody) {
  return {
    symbol: null,
    name,
    flags,
    implFlags: MethodImplAttributes.IL,
    hasBody: true,
    isCompilerGenerated: true,
    shape,
    parameters: parameterNames.map(parameterName => ({ name: parameterName, flags: 0 })),
    emitBody,
  };
}

export class SynthesizedTypes {
  constructor(core) {
    this.core = core;
    /** Synthesized type symbols, in the order they get their TypeDef rows. */
    this.types = [];
    /** Type symbol (source or synthesized) -> the fields and methods synthesized into it. */
    this.additions = new Map();
  }
  additionsTo(type) {
    let entry = this.additions.get(type);
    if (!entry) {
      entry = { fields: [], methods: [] };
      this.additions.set(type, entry);
    }
    return entry;
  }
  /**
   * A synthesized sealed class nested in `owner`.
   * @param {{interfaces?: object[], hasDefaultConstructor?: boolean, typeParameters?: object[]}} [options] without a
   *   default constructor the caller adds one of its own; `typeParameters` are the method type parameters the code
   *   of the class is written over - the class declares copies of them (generic-context.js)
   * @returns {{type: object, definition: object, constructor: object|null}} the class as code names it (constructed
   *   over `typeParameters` when it has any), its definition - the key of its members - and its planned
   *   parameterless constructor
   */
  nestedClass(owner, name, { interfaces = [], hasDefaultConstructor = true, typeParameters = [] } = {}) {
    const core = this.core,
      copies = classTypeParameterCopies(typeParameters),
      type = new NamedTypeSymbol({
        name,
        typeKind: TypeKind.Class,
        containingSymbol: owner,
        declaredAccessibility: Accessibility.Private,
        baseType: () => core.object,
        interfaces,
        isSealed: true,
        isImplicitlyDeclared: true,
        typeParameters: copies,
      }),
      shape = { isStatic: false, returnType: core.void, parameters: [] },
      constructor = hasDefaultConstructor ? synthesizedMethod('.ctor', CONSTRUCTOR_FLAGS, shape, [], objectConstructorBody) : null;
    type.isSource = true;
    type.typeSubstitution = substitutionOver(typeParameters, copies);
    type.selfType = selfTypeOf(type, typeParameters);
    this.types.push(type);
    if (constructor) this.additionsTo(type).methods.push(constructor);
    else this.additionsTo(type);
    return { type: type.selfType, definition: type, constructor };
  }
  field(type, name, fieldType, flags = FieldAttributes.Public) {
    const field = { symbol: null, name, flags, type: fieldType, constant: null, isCompilerGenerated: true };
    this.additionsTo(type).fields.push(field);
    return field;
  }
}
