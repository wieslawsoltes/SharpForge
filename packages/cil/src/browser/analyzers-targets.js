import { CilOpcodes } from '../opcodes.js';
import { decodeCoded } from '../metadata.js';
import { createMetadataVerificationContext } from '../verify/member-system.js';
import { invalidUsage, usageToken } from './analyzers-input.js';

const tokenTables = { method: [6, 10, 43], field: [4, 10], type: [1, 2, 27], sig: [17], tok: [1, 2, 27, 4, 6, 10, 43] };

/** Reuse canonical member/type caches; retain only scalar target facts in the caller's owned edges. */
export function usageTargets(inspector, counts, options) {
  const cache = new Map();
  let context;
  const binding = () => context ??= createMetadataVerificationContext(inspector, { ...options.metadataLimits, signal: options.signal });
  function resolve(token) {
    if (cache.has(token)) return cache.get(token);
    const table = token >>> 24;
    const result = table === 17 ? { status: 'known', value: { token, kind: 'signature' } }
      : [1, 2, 27].includes(table) ? binding().resolveType(token) : binding().resolveMember(token);
    const facts = result.status === 'known' ? { token: result.value.token, status: 'known', reason: null,
      kind: result.value.kind === 'definition' ? 'type' : result.value.kind,
      owner: result.value.owner?.token ?? null, name: result.value.name, isStatic: result.value.isStatic }
      : { token, status: 'unknown', reason: result.reason, kind: null, owner: null };
    cache.set(token, facts);
    return facts;
  }
  return instruction => {
    const kind = CilOpcodes[instruction.name].tokenKind;
    if (!kind || kind === 'string') return null;
    const operand = usageToken(counts, instruction.operand, tokenTables[kind]);
    const target = resolve(operand);
    if (target.status === 'known' && ['method', 'field', 'type'].includes(kind) && target.kind !== kind)
      invalidUsage('operand kind does not match metadata');
    let instantiatedType = null, declaredType = null;
    if (instruction.name === 'newobj') {
      if (target.status === 'known') {
        if (target.name !== '.ctor' || target.isStatic) invalidUsage('newobj requires instance constructor');
        declaredType = target.owner;
      } else if (operand >>> 24 === 10) {
        const parent = decodeCoded('MemberRefParent', inspector.metadata.row(operand)[0]);
        if ([1, 2, 27].includes(parent >>> 24)) declaredType = usageToken(counts, parent, [1, 2, 27]);
      }
      if (declaredType) instantiatedType = resolve(declaredType).token;
    }
    return { targetToken: target.token, status: target.status, reason: target.reason, declaredType, instantiatedType };
  };
}
