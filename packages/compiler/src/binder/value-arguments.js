import {frameworkType} from '@sharpforge/framework';
import {BoundConversion} from '../bound/nodes.js';
import {needsPrimitiveBox} from '../primitive-boxing.js';

/** Bind a target-typed value, optionally preserving primitive identity across an object boundary. */
export function bindValueArgument(binder, syntax, target, boxPrimitives = false) {
  if (frameworkType(target)?.kind === 'delegate' && binder.delegateMethod(syntax, target)) {
    return binder.bindDelegate(syntax, target);
  }
  const value = binder.bindTyped(syntax, target);
  binder.checkAssign(target, value.legacyType, syntax);
  return boxPrimitives ? boxPrimitiveValue(binder, value, target) : value;
}

/** Represent a required primitive box as the conversion consumed by existing local lowering. */
export function boxPrimitiveValue(binder, value, target) {
  if (!needsPrimitiveBox(target, value.legacyType)) return value;
  return binder.node(BoundConversion, null, {
    operand: value,
    conversion: {kind: 'Boxing', from: value.legacyType, to: 'object'},
    isExplicit: false,
    isChecked: false,
  }, 'object');
}
