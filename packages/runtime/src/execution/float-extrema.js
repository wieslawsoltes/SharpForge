import {float, number} from '@sharpforge/bytecode';

const negative = value => value < 0 || Object.is(value, -0);

function operand(value, kind) {
  const raw = number(value);
  const canonical = typeof raw === 'number' && (kind === 'r8' || Object.is(Math.fround(raw), raw));
  return value?.float === kind && Object.isFrozen(value) && canonical ? value : float(raw, kind);
}

/** Select the CoreLib floating operand, preserving its width, NaN payload and zero sign. */
export function floatingMathExtremum(name, type, left, right) {
  if (name !== 'Min' && name !== 'Max') throw new TypeError('Floating extremum requires Min or Max');
  if (type !== 'float' && type !== 'double') throw new TypeError('Floating extremum requires Single or Double');
  const kind = type === 'float' ? 'r4' : 'r8';
  const first = operand(left, kind), second = operand(right, kind);
  const a = first.value, b = second.value;
  if (a !== b) {
    if (Number.isNaN(a)) return first;
    return (name === 'Min' ? a < b : b < a) ? first : second;
  }
  return (name === 'Min' ? negative(a) : negative(b)) ? first : second;
}
