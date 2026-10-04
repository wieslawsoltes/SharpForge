import {StackCategory} from './numeric-stack-types.js';
import {SmallLongSlotTag} from './typed-stack.js';

const canonicalInt = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 && !Object.is(value, -0);

export function acceptsNumericSlot(slots, index, category) {
  return category === StackCategory.i8 ? slots.tags[index] === SmallLongSlotTag
    : slots.tags[index] === 0 && canonicalInt(slots.values[index]);
}

export function readNumericSlot(slots, index, category) {
  return category === StackCategory.i8 ? slots.numbers[index] : slots.values[index];
}

export function writeNumericSlot(slots, index, category, value) {
  if (category === StackCategory.i8) slots.setLong(index, value);
  else {
    slots.setPlain(index, value);
  }
}

/** Clear both private planes and boundary caches before trimming the observable Array length. */
export function shrinkNumericStack(slots, length) {
  slots.resize(length);
}
