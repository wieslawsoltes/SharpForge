import { yes, no, unknown } from '../metadata-types/results.js';
import { maxAccessChecks } from './nesting.js';
import { rejectMember } from './budget.js';

const nestedAccess = [0, 0, 6, 1, 4, 3, 2, 5];

/** One bounded lexical query, reusing the owning context's canonical resolver and hierarchy. */
export function accessScope(snapshot, types, budget) {
  const { nesting, visibility } = snapshot;
  const parent = type => nesting?.[type.token & 0xffffff] ?? 0;
  function direct(member, caller, receiver) {
    const { owner, token } = member;
    const access = member.flags & 7;
    if (access === 0 || access === 3 || access === 5 || access === 6) return yes;
    if (access === 1) return caller === owner ? yes : no;
    if (owner.isInterface || caller.isInterface || receiver?.isInterface) return unknown('interface-family-access', token);
    if (caller === owner) return yes;
    const family = types.isAssignable(caller, owner);
    if (family.status === 'unknown' || !family.value || member.isStatic) return family;
    if (receiver === undefined) return unknown('protected-receiver-required', token);
    return types.isAssignable(receiver, caller);
  }
  function nestedQuery(member, caller, receiver) {
    let remaining = maxAccessChecks;
    function accessible(target) {
      let current = caller;
      let missing;
      for (;;) {
        budget.check();
        if (!remaining--) rejectMember('CILVM0002', 'nested access checks');
        const result = direct(target, current, receiver);
        if (result.status === 'known' && result.value) return yes;
        if (result.status === 'unknown') missing ??= result;
        const rid = parent(current);
        if (!rid) return missing ?? no;
        const enclosing = types.resolveType(0x02000000 + rid);
        if (enclosing.status === 'unknown') return missing ?? enclosing;
        current = enclosing.value;
      }
    }
    let result = accessible(member);
    if (result.status === 'known' && !result.value) return result;
    let target = member.owner;
    while (parent(target)) {
      const enclosing = types.resolveType(0x02000000 + parent(target));
      if (enclosing.status === 'unknown') return result.status === 'unknown' ? result : enclosing;
      // Nested type visibility behaves like a static member of its enclosing type.
      const visible = accessible({ flags: nestedAccess[visibility[(target.token & 0xffffff) - 1]],
        owner: enclosing.value, token: target.token, isStatic: true });
      if (visible.status === 'known' && !visible.value) return visible;
      if (visible.status === 'unknown') result = visible;
      target = enclosing.value;
    }
    return result;
  }
  // The lexical closure and scratch state are created only inside nestedQuery.
  return (member, caller, receiver) => !parent(caller) && !parent(member.owner)
    ? direct(member, caller, receiver) : nestedQuery(member, caller, receiver);
}
