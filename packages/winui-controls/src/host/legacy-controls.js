import { makeElement, number, safeUrl, renderButtonContent, radioScope, shortType } from './dom-properties.js';
import { registerLegacyExtended } from './legacy-extended.js';
import { registerVirtualRenderers } from './virtual-renderer.js';
import { registerPanelRenderers } from './panel-renderers.js';
import { registerScrollRenderers } from './scroll-renderer.js';

const div = context => makeElement(context);
const content = (context, node, element) => context.content(element, node.properties.Content);
const panel = (context, node, element) => {
  const surface = context.host.surfaces.get(node.id);
  const layer = surface?.canvas ?? surface?.domLayer;
  context.ordered(element, [...(layer ? [layer] : []), ...context.children(node, 'Children')]);
};
const emitClick = (context, node) => context.emit(node, 'Click');

/** Extracted compatibility renderers are independently replaceable by completed control families. */
export function registerLegacyRenderers(registry) {
  registry.register('*', { create: div, render: content });
  registry.register(['Panel', 'StackPanel', 'Grid', 'Canvas', 'WrapGrid', 'VariableSizedWrapGrid', 'ItemsWrapGrid', 'RelativePanel'],
    { create: div, render: panel });
  registry.register(['ContentControl', 'Page', 'UserControl', 'ContentPresenter', 'Viewbox', 'ComboBoxItem', 'ListViewItem',
    'NavigationViewItem', 'TabViewItem'], { create: div, render: content });
  registry.register('Window', { create: div, render(context, node, element) {
    element.setAttribute('aria-label', node.properties.Title ?? 'Application window');
    element.setAttribute('role', 'group');
    element.style.padding = '0px';
    content(context, node, element);
  } });
  registry.register('Border', { create: div, render: (context, node, element) => context.content(element, node.properties.Child) });
  registry.register('TextBlock', { create: div, render(context, node, element) {
    context.content(element, node.properties.Text);
    element.style.whiteSpace = node.properties.TextWrapping === 0 ? 'pre' : 'pre-wrap';
    element.style.overflowWrap = node.properties.TextWrapping === 0 ? 'normal' : 'anywhere';
    element.style.textAlign = ['left', 'center', 'right', 'justify', 'start'][node.properties.TextAlignment ?? 0];
    element.style.userSelect = node.properties.IsTextSelectionEnabled === false ? 'none' : 'text';
  } });
  registry.register(['Button', 'AppBarButton'], { create: context => makeElement(context, 'button', { type: 'button' }),
    render: renderButtonContent, events: { click: emitClick } });
  registry.register('ToggleButton', { create: context => makeElement(context, 'button', { type: 'button' }),
    render(context, node, element) { renderButtonContent(context, node, element); element.setAttribute('aria-pressed', String(!!node.properties.IsChecked)); },
    events: { click(context, node) {
      node.properties.IsChecked = !node.properties.IsChecked;
      context.emit(node, 'Click');
      context.emit(node, node.properties.IsChecked ? 'Checked' : 'Unchecked', { value: node.properties.IsChecked });
      context.invalidate(node.id, 'render');
    } } });
  registry.register('HyperlinkButton', { create: context => makeElement(context, 'a'), render(context, node, element) {
    renderButtonContent(context, node, element);
    const uri = safeUrl(node.properties.NavigateUri);
    if (uri) { element.href = uri; element.target = '_blank'; element.rel = 'noopener noreferrer'; }
    else element.removeAttribute('href');
  }, events: { click: emitClick } });
  registry.register(['TextBox', 'AutoSuggestBox'], {
    renderKey: node => !!node.properties.AcceptsReturn,
    create: (context, node) => makeElement(context, node.properties.AcceptsReturn ? 'textarea' : 'input', { type: 'text' }),
    render(context, node, element) {
      const value = String(node.properties.Text ?? '');
      if (element.value !== value) element.value = value;
      element.placeholder = node.properties.PlaceholderText ?? '';
      element.readOnly = !!node.properties.IsReadOnly;
      element.style.whiteSpace = node.properties.TextWrapping === 0 ? 'pre' : 'pre-wrap';
      if (node.properties.MaxLength > 0) element.maxLength = node.properties.MaxLength;
      else element.removeAttribute('maxlength');
    }, events: {
      input(context, node, element, event) {
        if (event.isComposing) return;
        node.properties.Text = element.value;
        context.emit(node, 'TextChanged', { value: element.value });
        context.invalidate(node.id);
      }, keydown(context, node, element, event) {
        if (shortType(node.type) === 'AutoSuggestBox' && event.key === 'Enter') context.emit(node, 'QuerySubmitted', { QueryText: element.value });
      }
    }
  });
  registry.register('PasswordBox', { create: context => makeElement(context, 'input', { type: 'password' }),
    render(context, node, element) { element.placeholder = node.properties.PlaceholderText ?? ''; },
    setPrivateValue(context, node, element, property, value) { if (property === 'Password' && element) element.value = value ?? ''; },
    getPrivateValue: (context, node, element, property) => property === 'Password' ? element?.value : undefined,
    events: { input(context, node, element) { context.privateInput(node, 'Password', element.value); } } });
  registry.register(['CheckBox', 'RadioButton', 'ToggleSwitch'], {
    create(context, node) {
      const element = makeElement(context, 'label');
      const type = shortType(node.type);
      const input = makeElement(context, 'input', { type: type === 'RadioButton' ? 'radio' : 'checkbox' });
      input.dataset.part = 'check';
      if (type === 'ToggleSwitch') input.setAttribute('role', 'switch');
      element.append(input, makeElement(context, 'span'));
      return element;
    }, render(context, node, element) {
      const type = shortType(node.type);
      const checked = type === 'ToggleSwitch' ? node.properties.IsOn : node.properties.IsChecked;
      element.firstChild.checked = !!checked;
      element.firstChild.indeterminate = checked === null;
      if (type === 'RadioButton') element.firstChild.name = radioScope(context, node);
      context.content(element.lastChild, type === 'ToggleSwitch'
        ? node.properties.Header ?? (checked ? node.properties.OnContent : node.properties.OffContent) : node.properties.Content);
    }, events: { click: emitClick, change(context, node, element, event) {
      const type = shortType(node.type);
      const value = event.target.checked;
      if (type === 'RadioButton' && value) {
        const scope = radioScope(context, node);
        for (const other of context.nodes.values()) {
          if (other.id !== node.id && shortType(other.type) === 'RadioButton' && other.properties.IsChecked && radioScope(context, other) === scope) {
            other.properties.IsChecked = false;
            context.emit(other, 'Unchecked', { value: false });
          }
        }
      }
      node.properties[type === 'ToggleSwitch' ? 'IsOn' : 'IsChecked'] = value;
      context.emit(node, type === 'ToggleSwitch' ? 'Toggled' : value ? 'Checked' : 'Unchecked', { value });
      context.invalidate(node.id, 'render');
    } }
  });
  registry.register('Slider', { create: context => makeElement(context, 'input', { type: 'range' }), render(context, node, element) {
    element.min = number(node.properties.Minimum);
    element.max = number(node.properties.Maximum, 100);
    element.step = node.properties.StepFrequency > 0 ? node.properties.StepFrequency : 'any';
    element.value = number(node.properties.Value);
    element.style.writingMode = node.properties.Orientation === 0 ? 'vertical-lr' : '';
    element.setAttribute('aria-valuenow', element.value);
  }, events: { input(context, node, element) {
    node.properties.Value = Number(element.value);
    context.emit(node, 'ValueChanged', { value: node.properties.Value });
  } } });
  registry.register('ProgressBar', { create: context => makeElement(context, 'progress'), render(context, node, element) {
    element.max = number(node.properties.Maximum, 100);
    if (node.properties.IsIndeterminate) element.removeAttribute('value');
    else element.value = number(node.properties.Value);
  } });
  registry.register('ProgressRing', { create: context => makeElement(context, 'div', { role: 'progressbar' }), render(context, node, element) {
    element.hidden = node.properties.IsActive === false;
    element.classList.toggle('indeterminate', node.properties.IsIndeterminate !== false);
    element.setAttribute('aria-valuenow', String(number(node.properties.Value)));
  } });
  registry.register('Image', { create: context => makeElement(context, 'img'), render(context, node, element) {
    const source = safeUrl(node.properties.Source, { image: true });
    if (source) element.src = source;
    else element.removeAttribute('src');
    element.alt = node.properties.AlternativeText ?? '';
  } });
  registry.register(['Rectangle', 'Ellipse', 'Line'], { create: div, render: renderShape });
  registerScrollRenderers(registry);
  registerLegacyExtended(registry);
  registerVirtualRenderers(registry);
  registerPanelRenderers(registry);
  return registry;
}

function renderShape(context, node, element) {
  const properties = node.properties;
  const type = shortType(node.type);
  element.style.background = properties.Fill ? context.color(properties.Fill) : 'transparent';
  element.style.borderColor = properties.Stroke ? context.color(properties.Stroke) : '';
  element.style.borderWidth = number(properties.StrokeThickness, 1) + 'px';
  element.style.borderStyle = properties.Stroke ? 'solid' : 'none';
  element.style.borderRadius = type === 'Ellipse' ? '50%' : `${number(properties.RadiusX)}px / ${number(properties.RadiusY)}px`;
  if (type === 'Line') {
    const svg = element.firstChild ?? context.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const line = svg.firstChild ?? context.document.createElementNS('http://www.w3.org/2000/svg', 'line');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.overflow = 'visible';
    for (const name of ['X1', 'X2', 'Y1', 'Y2']) line.setAttribute(name.toLowerCase(), number(properties[name]));
    line.setAttribute('stroke', context.color(properties.Stroke));
    line.setAttribute('stroke-width', number(properties.StrokeThickness, 1));
    svg.append(line);
    element.append(svg);
    element.style.border = 'none';
    element.style.background = 'transparent';
  }
}
