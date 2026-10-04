import { createMetadataVerificationContext } from './member-system.js';
import { primitiveStorageSlot, nominalStorageSlot, knownMetadata } from './typed-storage.js';
import { typedMetadataRelations } from './typed-relations.js';
import { VerificationKind, verificationType } from './types.js';

/** Construct metadata only for methods whose signatures/instructions need it; share existing canonical declarations. */
export function ensureTypedMetadata(state, inspector, options) {
  if (state.metadata) return state.metadata;
  state.profile = 'SharpForge.TypedCIL.Fields/1';
  const fail = state.fail;
  const types = createMetadataVerificationContext(inspector, options);
  const current = knownMetadata(types.resolveMember(state.method.token), fail);
  if (current.name === '.ctor') fail('ConstructorStateUnavailable', 'Instance constructor state is not implemented', true);
  const slots = new Map();
  const slot = node => primitiveStorageSlot(node) ?? nominalStorageSlot(node, types, fail);
  const ownerCategory = () => knownMetadata(types.typeCategory(current.owner), fail);
  state.relations = typedMetadataRelations(types, fail);
  state.metadata = {
    types, current, slot,
    instanceSlot() {
      const category = ownerCategory();
      if (category === 'enum') fail('EnumStorageUnavailable', 'Enum instance state is not implemented', true);
      const type = current.owner;
      const address = verificationType(VerificationKind.ManagedPointer, type);
      return Object.freeze({ type, value: category === 'reference' ? verificationType(VerificationKind.Object, type) : address,
        address: category === 'reference' ? address : null, byref: category !== 'reference' });
    },
    field(token) {
      if (slots.has(token)) return slots.get(token);
      const member = knownMetadata(types.resolveMember(token), fail);
      if (member.kind !== 'field') fail('ExpectedField');
      if (member.flags & 0x40) fail('LiteralField');
      if (member.flags & 0x100) fail('FieldRvaUnavailable', 'Unmanaged RVA field storage is not implemented', true);
      const category = knownMetadata(types.typeCategory(member.owner), fail);
      if (category === 'enum') fail('EnumStorageUnavailable', 'Enum field storage is not implemented', true);
      if (!member.isStatic && (member.owner.flags & 0x18) === 0x10)
        fail('ExplicitLayoutUnavailable', 'Overlapped field access requires layout proof', true);
      const storage = slot(member.signature.type);
      if (storage.byref) fail('ByrefFieldUnavailable', 'Byref fields require escape and lifetime verification', true);
      const receiver = verificationType(category === 'reference' ? VerificationKind.Object : VerificationKind.ManagedPointer, member.owner);
      const result = Object.freeze({ member, storage, receiver });
      slots.set(token, result);
      return result;
    },
    access(field, receiverType) {
      if (!knownMetadata(types.isMemberAccessible(field, current.owner, { receiverType }), fail)) fail('FieldAccess');
    },
    canInitialize(field) {
      const signature = current.signature;
      return field.isStatic && field.owner === current.owner && current.isStatic && current.name === '.cctor' &&
        (current.flags & 0x1800) === 0x1800 && !signature.parameters.length &&
        signature.returnType.kind === 'primitive' && signature.returnType.name === 'void';
    },
  };
  return state.metadata;
}
