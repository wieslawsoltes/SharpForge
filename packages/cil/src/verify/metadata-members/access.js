import { accessScope } from './access-scope.js';

/** Local accessibility, separate from member resolution and instruction receiver typing. */
export function metadataAccess(snapshot, members, types, budget) {
  const access = accessScope(snapshot, types, budget);
  return {
    isMemberAccessible(member, accessingType, { receiverType } = {}) {
      members.requireMember(member);
      // Reflexivity reuses the hierarchy's ownership checks without a second identity collection.
      types.isAssignable(accessingType, accessingType);
      if (receiverType !== undefined) types.isAssignable(receiverType, receiverType);
      return access.member(member, accessingType, receiverType);
    },
    /** Canonical local TypeDefs only; unknown never grants access, foreign identities throw CILVT0004. */
    isTypeAccessible(targetType, accessingType) {
      budget.check();
      types.isAssignable(targetType, targetType);
      types.isAssignable(accessingType, accessingType);
      return access.type(targetType, accessingType);
    },
  };
}
