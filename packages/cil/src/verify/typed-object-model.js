import { CilError } from '../binary.js';
import { VerificationKind as Kind, verificationType } from './types.js';
import { knownMetadata } from './typed-storage.js';
import { objectAnnotationReader } from './object-annotations.js';
import { objectConstructorOwners } from './object-constructor-owners.js';

function prepareObjectModel(state, context) {
  const { metadata, fail } = state;
  const { types, current } = metadata;
  const identities = new Map();
  const constructors = new Map();
  let annotations;
  let constructorOwners;
  state.objectTypes = new Map();
  state.objectConstructors = new Map();

  function typeRecord(type) {
    if (identities.has(type)) return identities.get(type);
    const category = knownMetadata(types.typeCategory(type), fail);
    if (category === 'enum') fail('EnumStorageUnavailable', 'Object transfers require enum underlying-type normalization', true);
    if (!knownMetadata(types.isTypeAccessible(type, current.owner), fail)) fail('TypeAccess');
    const isValue = category === 'value';
    if (isValue && (type.flags & 0x18) === 0x10)
      fail('ExplicitLayoutUnavailable', 'Value object transfers require a non-overlapping layout policy', true);
    let byRefLike = false;
    if (isValue) {
      annotations ??= objectAnnotationReader(context.inspector.metadata, context.options, fail);
      byRefLike = annotations(type);
    }
    const value = verificationType(isValue ? Kind.Value : Kind.Object, type);
    const record = Object.freeze({ type, isValue, byRefLike, value,
      boxed: isValue ? verificationType(Kind.Boxed, type) : value,
      unboxed: isValue ? verificationType(Kind.ReadonlyPointer, type) : null });
    identities.set(type, record);
    return record;
  }

  return {
    type(token) {
      const record = typeRecord(knownMetadata(types.resolveType(token), fail));
      state.objectTypes.set(token, record);
      return record;
    },
    constructor(token) {
      const member = knownMetadata(types.resolveMember(token), fail);
      if (constructors.has(member)) {
        const record = constructors.get(member);
        state.objectConstructors.set(token, record);
        return record;
      }
      if (member.kind !== 'method' || member.name !== '.ctor') fail('CtorExpected');
      const signature = member.signature;
      if (signature.returnType.kind === 'modreq' || signature.returnType.kind === 'modopt')
        fail('ConstructorSignatureUnavailable', 'Modified constructor returns require signature normalization', true);
      if (member.isStatic || (member.flags & 0x1800) !== 0x1800 || member.flags & 0x400 ||
          signature.returnType.kind !== 'primitive' || signature.returnType.name !== 'void') fail('CtorSig');
      const owner = typeRecord(member.owner);
      if (member.owner.isInterface || member.owner.flags & 0x80) fail('NewobjAbstractClass');
      if (owner.byRefLike) fail('ByRefLikeLifetimeUnavailable', 'Constructing a ref-like value requires lifetime verification', true);
      const definition = context.inspector.methods.get(member.token);
      if (!definition?.hasBody || definition.implFlags & 3 || definition.flags & 0x2000)
        fail('ConstructorImplementationUnavailable', 'Only ordinary local CIL constructor contracts are prepared', true);
      if (!owner.isValue) {
        constructorOwners ??= objectConstructorOwners(types, context.options, fail);
        constructorOwners(member.owner);
      }
      if (!knownMetadata(types.isMemberAccessible(member, current.owner), fail)) fail('MethodAccess');
      const parameters = Object.freeze(signature.parameters.map(node => metadata.slot(node).value));
      const record = Object.freeze({ member, parameters, result: owner.value });
      constructors.set(member, record);
      state.objectConstructors.set(token, record);
      return record;
    },
  };
}

function model(state, context) {
  state.profile = 'SharpForge.TypedCIL.Objects/1';
  return context.objectModel ??= prepareObjectModel(state, context);
}

function preparation(operation, instruction, state, context) {
  try { return model(state, context)[operation](instruction.operand); }
  catch (error) {
    if (!(error instanceof CilError) || error.code) throw error;
    state.fail('ObjectOperand', error.message);
  }
}

/** Resolve each canonical type once during preparation; transfers retain only owned representation facts. */
export function prepareObjectType(instruction, state, context) {
  return preparation('type', instruction, state, context);
}

/** Constructor-body this-state remains separate; newobj checks the callee's declared construction contract. */
export function prepareObjectConstructor(instruction, state, context) {
  return preparation('constructor', instruction, state, context);
}
