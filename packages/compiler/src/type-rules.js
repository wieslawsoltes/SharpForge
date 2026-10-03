import {numericTypeNames} from '@sharpforge/bytecode';
import {frameworkType, frameworkAssignable} from '@sharpforge/framework';
import {numeric, implicitNumeric} from './numeric.js';

const scalarTypes = new Set([...numericTypeNames, 'bool', 'string', 'object', 'void', 'var', 'null', 'error', 'Exception']);

export function isReference(type) {
  return ['string', 'object', 'Exception'].includes(type) || type.endsWith('[]') ||
    !scalarTypes.has(type) && frameworkType(type)?.kind !== 'enum';
}

/** Source assignment relation, including the numeric implicit-conversion table. */
export function assignable(target, source) {
  return frameworkAssignable(target, source) || target === 'error' || source === 'error' || target === source ||
    target === 'object' && source !== 'void' || numeric(target) && numeric(source) && implicitNumeric(source, target) ||
    source === 'null' && isReference(target);
}
