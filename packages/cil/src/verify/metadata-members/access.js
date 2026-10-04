import { yes, no, unknown } from '../metadata-types/results.js';

/** Local flat-type accessibility, separate from member resolution and instruction receiver typing. */
export function memberAccess(visibility, members, types) {
  const nested = type => visibility[(type.token & 0xffffff) - 1] >= 2;
  return (member, accessingType, { receiverType } = {}) => {
    members.requireMember(member);
    // Reflexivity reuses the hierarchy's identity/cancellation checks without a second identity collection.
    types.isAssignable(accessingType, accessingType);
    if (receiverType !== undefined) types.isAssignable(receiverType, receiverType);
    const owner = member.owner;
    if (nested(owner) || nested(accessingType) || receiverType !== undefined && nested(receiverType))
      return unknown('nested-member-access', member.token);
    const access = member.flags & 7;
    // Compiler-controlled identities can only have reached this query through a definition, never a MemberRef.
    if (access === 0 || access === 3 || access === 5 || access === 6) return yes;
    if (access === 1) return accessingType === owner ? yes : no;
    if (owner.isInterface || accessingType.isInterface || receiverType?.isInterface)
      return unknown('interface-family-access', member.token);
    if (accessingType === owner) return yes;
    const family = types.isAssignable(accessingType, owner);
    if (family.status === 'unknown' || !family.value || member.isStatic) return family;
    if (receiverType === undefined) return unknown('protected-receiver-required', member.token);
    return types.isAssignable(receiverType, accessingType);
  };
}
