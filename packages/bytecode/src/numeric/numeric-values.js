import {isNativeInteger} from './native-int.js';

/** Read a stack scalar without discarding its declared tag in storage. */
export const number = value => value?.float || isNativeInteger(value) ? value.value : value;

/** Decimal is a separate value category and deliberately does not satisfy this predicate. */
export const isNumber = value => typeof value === 'number' || typeof value === 'bigint' ||
  !!value?.float || isNativeInteger(value);
