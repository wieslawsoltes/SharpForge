import {float, number} from '@sharpforge/bytecode';

const negative = value => value < 0 || Object.is(value, -0);

function operand(value, kind) {
  const raw = number(value);
  const canonical = typeof raw === 'number' && (kind === 'r8' || Object.is(Math.fround(raw), raw));
  return value?.float === kind && Object.isFrozen(value) && canonical ? value : float(raw, kind);
}

function selectFirst(name, a, b) {
  if (name !== 'Min' && name !== 'Max') throw new TypeError('Floating extremum requires Min or Max');
  if (a !== b) return Number.isNaN(a) || (name === 'Min' ? a < b : b < a);
  return name === 'Min' ? negative(a) : negative(b);
}

/** Select raw Numbers for legacy source wires without allocating or changing their carrier. */
export function floatingNumberExtremum(name, left, right) {
  return selectFirst(name, left, right) ? left : right;
}

/** Select the CoreLib floating operand, preserving its width, NaN payload and zero sign. */
export function floatingMathExtremum(name, type, left, right) {
  if (type !== 'float' && type !== 'double') throw new TypeError('Floating extremum requires Single or Double');
  const kind = type === 'float' ? 'r4' : 'r8';
  const first = operand(left, kind), second = operand(right, kind);
  return selectFirst(name, first.value, second.value) ? first : second;
}
