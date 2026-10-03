import {numericTypeNames, spanType, arrayType} from '@sharpforge/bytecode';
import {frameworkType, frameworkAssignable} from '@sharpforge/framework';
import {numeric, implicitNumeric} from './numeric.js';

const scalarTypes = new Set([...numericTypeNames, 'bool', 'string', 'object', 'void', 'var', 'null', 'error', 'Exception']);

export function isReference(type) {
  if(spanType(type))return false;
  return ['string', 'object', 'Exception'].includes(type) || !!arrayType(type) ||
    !scalarTypes.has(type) && frameworkType(type)?.kind !== 'enum';
}

/** Source assignment relation, including the numeric implicit-conversion table. */
export function assignable(target, source) {
  if(spanType(target)||spanType(source))return target===source||!!spanType(target)?.readonly&&spanType(target)?.element===spanType(source)?.element;
  return frameworkAssignable(target, source) || target === 'error' || source === 'error' || target === source ||
    target === 'object' && source !== 'void' || numeric(target) && numeric(source) && implicitNumeric(source, target) ||
    source === 'null' && isReference(target);
}
