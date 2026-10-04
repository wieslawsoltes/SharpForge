import { known, unknown } from '../metadata-types/results.js';
import { rejectMember, requireMemberToken } from './budget.js';
import { memberSignatures } from './signatures.js';
import { memberLookup } from './lookup.js';

export function memberQueries(snapshot, types, budget) {
  const decode = memberSignatures(types, budget);
  const lookup = memberLookup(snapshot, types, budget);
  const cache = new Map();
  function definition(record) {
    if (cache.has(record.token)) return cache.get(record.token);
    const owner = types.resolveType(record.ownerToken);
    if (owner.status === 'unknown') return owner;
    const signature = decode(record.signature);
    if (signature.status === 'unknown') return signature;
    if (signature.value.kind !== record.kind || (record.flags & 7) > 6) rejectMember('CILVM0001', 'definition signature or access flags');
    const isStatic = !!(record.flags & 0x10);
    if (record.kind === 'method' && signature.value.hasThis === isStatic) rejectMember('CILVM0001', 'method instance convention');
    const member = Object.freeze({ token: record.token, kind: record.kind, owner: owner.value, name: record.name,
      flags: record.flags, isStatic, signature: signature.value });
    const result = known(member);
    cache.set(record.token, result);
    return result;
  }
  function resolveMember(token) {
    budget.check();
    requireMemberToken(token, snapshot.counts);
    if (cache.has(token)) return cache.get(token);
    if (token >>> 24 === 43) return unknown('method-instantiation', token);
    if (snapshot.definitions.has(token)) return definition(snapshot.definitions.get(token));
    const reference = snapshot.references.get(token);
    const ownerTable = reference.ownerToken >>> 24;
    if (ownerTable !== 1 && ownerTable !== 2) return unknown('unresolved-member-owner', reference.ownerToken);
    const owner = types.resolveType(reference.ownerToken);
    if (owner.status === 'unknown') return ownerTable === 1 ? unknown('unresolved-member-owner', reference.ownerToken) : owner;
    const signature = decode(reference.signature);
    if (signature.status === 'unknown') return signature;
    const record = lookup(reference, token, owner.value, signature.value.kind);
    if (record.status === 'unknown') return record;
    // Compiler-controlled definitions cannot be accessed through a MemberRef (ECMA I.8.5.3.2).
    if (!(record.flags & 7)) return unknown('compiler-controlled-reference', token);
    const result = definition(record);
    cache.set(token, result);
    return result;
  }
  return { resolveMember, requireMember(member) {
    budget.check();
    if (!member || cache.get(member.token)?.value !== member) rejectMember('CILVM0004');
    return member;
  } };
}
