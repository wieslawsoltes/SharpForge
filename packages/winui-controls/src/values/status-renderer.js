import { requestControlEvent } from '../policy/event-requests.js';
import { executeCommand } from '../commands/command.js';
import { createPart, controlName, registerFamily, emitChange } from '../policy/events.js';
import { renderIconSource } from '../icons/index.js';
import { registerColorRenderer } from './color-renderer.js';

function renderInfo(context, node, element) {
  const properties = node.properties;
  if (controlName(node) === 'InfoBadge') {
    if (properties.Value >= 0) element.textContent = String(properties.Value);
    else if (properties.IconSource) renderIconSource(context, properties.IconSource, element);
    else element.textContent = '•';
    element.removeAttribute('aria-hidden');
    element.setAttribute('role', 'status');
    element.setAttribute('aria-label', String(properties.Value >= 0 ? `${properties.Value} notifications` : 'Notification'));
    return;
  }
  const [title, message, content, action, close] = element.children;
  element.hidden = properties.IsOpen === false;
  element.dataset.severity = String(properties.Severity ?? 0);
  element.style.backgroundColor = context.services.environment?.HighContrast ? 'Canvas'
    : ['#f3f3f3', '#dff6dd', '#fff4ce', '#fde7e9'][properties.Severity ?? 0] ?? '#f3f3f3';
  element.setAttribute('role', properties.Severity >= 2 ? 'alert' : 'status');
  title.textContent = String(properties.Title ?? '');
  message.textContent = String(properties.Message ?? '');
  context.content(content, properties.Content);
  context.content(action, properties.ActionButton);
  close.hidden = properties.IsClosable === false;
}

function closeInfo(context, node, element, event) {
  if (event.target.dataset.part !== 'info-close') return false;
  context.emit(node, 'CloseButtonClick', {});
  requestControlEvent(context, node, 'Closing', { Reason: 0, Cancel: false }).then(args => {
    if (args.Cancel || !context.nodes.has(node.id)) return;
    if (node.properties.CloseButtonCommand) executeCommand(context, { ...node, properties: { ...node.properties,
      Command: node.properties.CloseButtonCommand, CommandParameter: node.properties.CloseButtonCommandParameter } });
    node.properties.IsOpen = false;
    emitChange(context, node, 'Closed', { Reason: 0, IsOpen: false });
  }).catch(error => context.host.options.onError?.(error));
  return true;
}

function renderRating(context, node, element) {
  const properties = node.properties;
  const count = Math.max(1, Math.min(100, properties.MaxRating ?? 5));
  const value = properties.Value < 0 ? properties.PlaceholderValue ?? 0 : properties.Value ?? 0;
  element.setAttribute('role', 'radiogroup');
  element.setAttribute('aria-label', properties.Caption ?? 'Rating');
  const children = Array.from({ length: count }, (_, index) => {
    const button = element.children[index] ?? createPart(context.document, 'button', 'rating-value');
    button.dataset.rating = String(index + 1);
    button.textContent = index < value ? '★' : '☆';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(index + 1 === value));
    button.setAttribute('aria-label', `${index + 1} of ${count}`);
    button.disabled = properties.IsReadOnly || properties.IsEnabled === false;
    button.tabIndex = index + 1 === value || value < 1 && index === 0 ? 0 : -1;
    return button;
  });
  context.ordered(element, children);
}

export function registerStatusRenderers(registry) {
  registerColorRenderer(registry);
  registerFamily(registry, ['InfoBar', 'InfoBadge'], { create(context, node) {
    const element = context.document.createElement('div');
    if (controlName(node) === 'InfoBar') {
      const close = createPart(context.document, 'button', 'info-close');
      close.textContent = '×';
      close.setAttribute('aria-label', 'Close notification');
      element.append(createPart(context.document, 'strong', 'info-title'), createPart(context.document, 'span', 'info-message'),
        createPart(context.document, 'div', 'info-content'), createPart(context.document, 'div', 'info-action'), close);
    }
    return element;
  }, render: renderInfo, events: { click: closeInfo } });
  registerFamily(registry, 'RatingControl', { create: context => context.document.createElement('div'), render: renderRating,
    events: { click(context, node, element, event) {
      if (!event.target.dataset.rating || node.properties.IsReadOnly || node.properties.IsEnabled === false) return false;
      const value = Number(event.target.dataset.rating);
      node.properties.Value = node.properties.Value === value && node.properties.IsClearEnabled !== false ? -1 : value;
      emitChange(context, node, 'ValueChanged', { NewValue: node.properties.Value, value: node.properties.Value });
      return true;
    }, keydown: ratingKeyboard }
  });
}

function ratingKeyboard(context, node, element, event) {
  if (node.properties.IsReadOnly || node.properties.IsEnabled === false) return false;
  const maximum = Math.max(1, Math.min(100, node.properties.MaxRating ?? 5));
  const current = Math.max(0, node.properties.Value ?? 0);
  const horizontal = node.properties.FlowDirection === 1 ? -1 : 1;
  const delta = { ArrowUp: 1, ArrowDown: -1, ArrowRight: horizontal, ArrowLeft: -horizontal }[event.key];
  let value = event.key === 'Home' ? 1 : event.key === 'End' ? maximum : delta == null ? null : current + delta;
  if (['Delete', 'Backspace'].includes(event.key) && node.properties.IsClearEnabled !== false) value = -1;
  if (value == null) return false;
  event.preventDefault();
  node.properties.Value = value < 0 ? -1 : Math.max(1, Math.min(maximum, value));
  emitChange(context, node, 'ValueChanged', { NewValue: node.properties.Value, value: node.properties.Value });
  renderRating(context, node, element);
  element.querySelector('[tabindex="0"]')?.focus();
  return true;
}
