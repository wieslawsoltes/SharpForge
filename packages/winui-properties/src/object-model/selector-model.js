import {styleModel} from './resource-adapter-models.js';

/** Native selectors and source-defined virtual selectors share the same invocation and GC boundary. */
export function selectorModel(context, reference, kind = 'template') {
  if (reference === null || reference === undefined) return null;
  const native = context.unwrapModel(reference);
  const method = kind === 'style' ? 'selectStyle' : 'selectTemplate';
  if (typeof native?.[method] === 'function') return native;
  return context.state(reference, 'selector:' + kind, () => ({reconstructible: true,
    [method](item, container) {
      const slot = kind === 'style' ? 'SelectStyleCore' : 'SelectTemplateCore';
      const values = kind === 'template' && context.hasVirtual && !context.hasVirtual(reference, slot, 2) ? [item] : [item, container];
      const result = context.invokeVirtual(reference, slot, values);
      return result === null ? null : kind === 'style' ? styleModel(context, result) : context.unwrapModel(result);
    },
    *retainedValues() { yield reference; }}));
}
