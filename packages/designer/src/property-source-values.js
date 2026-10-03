import {MEDIA} from '@sharpforge/framework';
import {authoringError, boundedArray, finiteNumber} from './property-diagnostics.js';
import {normalizeDesignerBrush, normalizeDesignerColor} from './property-values.js';

/** Decode a closed authored value syntax record. The caller supplies its bounded constant reader. */
export function readExtendedDesignerSourceValue(node, read) {
  if (node?.kind !== 'New') return {handled: false};
  if (node.type === 'Windows.Foundation.Point') {
    const args = node.args.map(read);
    if (args.length !== 2) authoringError('SFD1813', 'A gradient point requires two constant coordinates.');
    return {handled: true, value: {X: finiteNumber(args[0]), Y: finiteNumber(args[1])}};
  }
  if (![MEDIA + 'GradientStop', MEDIA + 'LinearGradientBrush'].includes(node.type)) return {handled: false};
  if (node.args.length) authoringError('SFD1813', 'Authored gradient constructors are parameterless.');
  const values = {};
  for (const initializer of node.initializers ?? []) {
    if (initializer.name === 'GradientStops') {
      if (initializer.expression.kind !== 'DesignCollection') authoringError('SFD1813', 'Gradient stops require a closed collection initializer.');
      values.GradientStops = boundedArray(initializer.expression.items, 64, 'Gradient stops').map(read);
    } else values[initializer.name] = read(initializer.expression);
  }
  if (node.type === MEDIA + 'GradientStop') return {handled: true, value: {
    Color: normalizeDesignerColor(values.Color), Offset: finiteNumber(values.Offset, {minimum: 0, maximum: 1, label: 'Stop offset'})
  }};
  return {handled: true, value: normalizeDesignerBrush({valueType: node.type, ...values})};
}
