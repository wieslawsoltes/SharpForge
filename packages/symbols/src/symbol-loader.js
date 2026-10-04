import { readPE, equalBytes } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { pdbChecksum } from './pdb-checksum.js';
import { readPortablePdb } from './pdb-reader.js';
import { readDebugDirectory } from './debug-directory.js';
import { createHoistedLocalLookup } from './hoisted-locals.js';
import { createClosureLookup } from './closure-map.js';
import { bindConstantTypes } from './constant-binding.js';
export function loadSymbols(assembly, pdbBytes = null, options = {}) {
  if (pdbBytes instanceof ArrayBuffer) pdbBytes = new Uint8Array(pdbBytes);
  const entries = readDebugDirectory(assembly, options),
    embedded = entries.find((e) => e.kind === 17)?.pdb;
  if (!pdbBytes) pdbBytes = embedded;
  if (!pdbBytes) fail('No Portable PDB was selected or embedded');
  const symbols = readPortablePdb(pdbBytes, options),
    codeViews = entries.filter((e) => e.kind === 2 && e.minor === 0x504d);
  if (!codeViews.length && !options.allowUnbound)
    fail('Assembly has no Portable PDB identity; explicit unbound inspection is required');
  if (codeViews.length && !codeViews.some((e) => e.age === 1 && equalBytes(e.id, symbols.id)))
    fail('Portable PDB does not match assembly identity');
  if (embedded && embedded !== pdbBytes && !equalBytes(readPortablePdb(embedded, options).id, symbols.id))
    fail('Embedded and external PDB identities differ');
  for (const e of entries.filter((e) => e.kind === 19)) {
    if (!equalBytes(pdbChecksum(symbols, e.algorithm), e.checksum)) fail('Portable PDB checksum mismatch');
  }
  const pe = readPE(assembly, { inspection: true });
  for (const [t, n] of Object.entries(symbols.metadata.externalCounts))
    if ((pe.metadata.counts[t] ?? 0) !== n) fail('Portable PDB type-system row counts differ');
  for (const m of symbols.methods) {
    if (!m.points.length) continue;
    const body = pe.methodBody(m.token);
    for (const p of m.points) if (p.offset >= body.code.length) fail('Sequence point is outside its method body');
  }
  symbols.bound = codeViews.length > 0;
  if (symbols.bound) bindConstantTypes(symbols.constants, pe.metadata);
  symbols.hoistedLocals = createHoistedLocalLookup(pe, symbols, options);
  symbols.closureInfo = createClosureLookup(pe, symbols, options);
  return symbols;
}
