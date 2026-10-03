import {propertyButton, propertyElement} from './designer-property-dom.js';
import {openDesignerBindingEditor, openDesignerConvertResource, openDesignerTemplateBinding} from './designer-property-binding.js';

const markers = Object.freeze({local: '●', style: '◆', template: '◇', resource: '◈', binding: '↗', default: '○', mixed: '◐'});

/** Row menus expose only authored local changes; reset leaves style and template setters untouched. */
export function propertySourceMarker(context) {
  const root = propertyElement(context.document, 'details', '', 'design-property-source');
  const summary = propertyElement(context.document, 'summary', markers[context.source.kind] ?? '○');
  summary.title = context.source.label;
  summary.setAttribute('aria-label', context.name + ': ' + context.source.label);
  root.dataset.valueSource = context.source.kind;
  root.append(summary);
  const actions = propertyElement(context.document, 'div', '', 'design-property-source-actions');
  actions.append(propertyElement(context.document, 'small', context.source.label),
    propertyButton(context.document, 'Reset local value', () => context.run(() => context.commands.reset(context.name, context.ids)),
      {disabled: context.protectedSource}),
    propertyButton(context.document, 'Convert to resource…', () => context.run(() => openDesignerConvertResource(context)),
      {disabled: context.protectedSource || context.mixed || context.value === undefined}),
    propertyButton(context.document, context.view.resources?.scope ? 'Edit template binding…' : 'Create / edit binding…',
      () => context.run(() => context.view.resources?.scope ? openDesignerTemplateBinding(context) : openDesignerBindingEditor(context)),
      {disabled: context.protectedSource || context.collection}),
    propertyButton(context.document, 'Choose resource…', () => context.run(() => openDesignerBindingEditor(context, {resource: true})),
      {disabled: context.protectedSource || context.collection}),
    propertyButton(context.document, 'Go to source', () => context.run(() => context.goToSource()), {disabled: !context.hasSource}));
  root.append(actions);
  return root;
}
