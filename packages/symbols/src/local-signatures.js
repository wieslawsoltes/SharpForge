import { decodeSignature, readMethodHeader } from '@sharpforge/cil';
import { fail } from './contracts.js';

export function localSlotLimits(options = {}) {
  const limits = {};
  for (const [name, maximum] of Object.entries({ maxLocalSlotMethods: 65536, maxLocalSlots: 100000 })) {
    const value = options[name] ?? maximum;
    if (!Number.isInteger(value) || value < 0 || value > maximum) fail('Invalid local slot limit');
    limits[name] = value;
  }
  return {
    ...limits,
    check() {
      if (options.signal?.aborted) fail('Local slot inspection cancelled');
    },
  };
}

function countNodes(value) {
  if (!value || typeof value !== 'object') return 0;
  return (Array.isArray(value) ? 0 : 1) + Object.values(value).reduce((total, child) => total + countNodes(child), 0);
}

/** Preflight all referenced signature blobs, then decode once per handle while PE metadata is still owned by load. */
export function readLocalSignatures(pe, symbols, limits) {
  const count = pe.metadata.counts[6] ?? 0;
  limits.check();
  if (count > limits.maxLocalSlotMethods) fail('Local slot method limit exceeded');
  const signatures = new Map(),
    methods = new Map(),
    headers = new Map();
  let bytes = 0;
  for (let row = 1; row <= count; row++) {
    limits.check();
    const method = 0x06000000 + row;
    const signature = symbols.methods[row - 1]?.localSignature ?? 0;
    if (
      !Number.isInteger(signature) ||
      signature < 0 ||
      signature > 0xffffff ||
      signature > (pe.metadata.counts[17] ?? 0)
    )
      fail('Invalid local signature row id');
    let token = signature ? 0x11000000 + signature : 0,
      reason = null;
    if (!token) {
      const definition = pe.metadata.row(method),
        rva = definition[0];
      if (!rva) reason = 'no-method-body';
      else if (definition[1] & 3) reason = 'unsupported-method-body';
      else {
        if (!headers.has(rva)) headers.set(rva, readMethodHeader(pe, method).localSignature);
        token = headers.get(rva);
      }
    }
    methods.set(method, { token, reason });
    if (!token || signatures.has(token)) continue;
    if (token >>> 24 !== 17 || !(token & 0xffffff) || (token & 0xffffff) > (pe.metadata.counts[17] ?? 0))
      fail('Invalid local signature token');
    const value = pe.metadata.blob(pe.metadata.row(token)[0]);
    if (value.length > 4096 || (bytes += value.length) > 128 * 1024) fail('Local signature byte limit exceeded');
    signatures.set(token, value);
  }
  let remainingNodes = 65536;
  for (const [token, value] of signatures) {
    limits.check();
    if (!remainingNodes) fail('Local signature node limit exceeded');
    const signature = decodeSignature(value, { maxDepth: 32, maxNodes: Math.min(4096, remainingNodes) });
    if (signature.kind !== 'locals') fail('Expected local variable signature');
    remainingNodes -= countNodes(signature);
    if (remainingNodes < 0) fail('Local signature node limit exceeded');
    signatures.set(token, signature.types);
  }
  let slots = 0;
  for (const { token } of methods.values()) {
    slots += signatures.get(token)?.length ?? 0;
    if (slots > limits.maxLocalSlots) fail('Local slot aggregate limit exceeded');
  }
  return { signatures, methods };
}
