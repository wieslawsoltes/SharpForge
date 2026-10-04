import { accessScope } from './access-scope.js';

/** Local accessibility, separate from member resolution and instruction receiver typing. */
export function memberAccess(snapshot, members, types, budget) {
  const access = accessScope(snapshot, types, budget);
  return (member, accessingType, { receiverType } = {}) => {
    members.requireMember(member);
    // Reflexivity reuses the hierarchy's identity/cancellation checks without a second identity collection.
    types.isAssignable(accessingType, accessingType);
    if (receiverType !== undefined) types.isAssignable(receiverType, receiverType);
    return access(member, accessingType, receiverType);
  };
}
