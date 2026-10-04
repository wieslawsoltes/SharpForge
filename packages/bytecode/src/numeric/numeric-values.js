import {isNativeInteger} from './native-int.js';

/** Read an Int32/Int64 stack scalar or the payload of a tagged CLI floating value. */
export const number = value => value?.float || isNativeInteger(value) ? value.value : value;

/** Decimal and managed references are separate value categories. */
export const isNumber = value => typeof value === 'number' || typeof value === 'bigint' || !!value?.float || isNativeInteger(value);
