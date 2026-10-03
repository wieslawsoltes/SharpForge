import {Op} from '@sharpforge/bytecode';
import {CilError} from './binary.js';

/** Markers preserve source instruction boundaries; canonical re-emission validates every CLI body. */
export function loadMemorySpan(span, context) {
  if (span.at(-2)?.name !== 'ldstr' || span.at(-1)?.name !== 'pop') return null;
  const text = context.metadata.userString(span.at(-2).operand);
  if (!text.startsWith('SharpForge.Memory:')) return null;
  const parts = text.slice('SharpForge.Memory:'.length).split('|');
  const op = Number(parts[0]), b = Number(parts[2]);
  if (parts.length !== 3 || op < Op.NEWRECT || op > Op.SPANDEFAULT || !Number.isInteger(op) || !Number.isInteger(b)) {
    throw new CilError('Invalid memory instruction marker');
  }
  const a = op === Op.NEWRECT || op === Op.STACKALLOC || op === Op.SPANDEFAULT ? context.intern(parts[1]) : Number(parts[1]);
  if (!Number.isInteger(a)) throw new CilError('Invalid memory instruction operand');
  return [op, a, b];
}
