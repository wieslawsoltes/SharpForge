import { stateFor, registerFamily, createPart, controlName, emitChange } from '../policy/events.js';
import { renderIconSource } from '../icons/index.js';
import { commandCanExecute, executeCommand, commandPresentation } from '../commands/command.js';
import { showControlOverlay } from '../overlay/index.js';

/** Clock injection keeps repeat-button behavior deterministic in tests and cancellable on unload. */
export class RepeatController {
  constructor(invoke, { delay = 500, interval = 100, schedule = setTimeout, cancel = clearTimeout } = {}) {
    this.invoke = invoke;
    this.delay = delay;
    this.interval = interval;
    this.schedule = schedule;
    this.cancel = cancel;
    this.timer = null;
    this.active = false;
  }
  start() {
    if (this.active) return;
    this.active = true;
    this.invoke();
    const tick = () => {
      if (!this.active) return;
      this.invoke();
      this.timer = this.schedule(tick, Math.max(10, this.interval));
    };
    this.timer = this.schedule(tick, Math.max(0, this.delay));
  }
  stop() { this.active = false; if (this.timer !== null) this.cancel(this.timer); this.timer = null; }
  dispose() { this.stop(); }
}

export function nextToggleValue(value, threeState = false) {
  return value === false || value === undefined ? true : value === true ? threeState ? null : false : false;
}

function invokeButton(context, node) {
  if (node.properties.IsEnabled === false || !commandCanExecute(context, node)) return;
  executeCommand(context, node);
  context.emit(node, 'Click', {});
}

function renderButton(context, node, element) {
  const properties = node.properties;
  const kind = controlName(node);
  const split = kind === 'SplitButton' || kind === 'ToggleSplitButton';
  const presenter = split ? element.firstElementChild : element;
  if (node.templateRoot) {
    const template = context.host.ensure(node.templateRoot);
    context.ordered(presenter, template ? [template] : []);
    presenter.style.padding = '0';
  } else {
    if (kind === 'AppBarButton' || kind === 'AppBarToggleButton') {
      const presentation = commandPresentation(context, node);
      const icon = createPart(context.document, 'span', 'appbar-icon');
      const label = createPart(context.document, 'span', 'appbar-label');
      if (presentation.icon) renderIconSource(context, presentation.icon, icon);
      else icon.hidden = true;
      context.content(label, properties.Content ?? presentation.label);
      label.hidden = properties.IsCompact === true || properties.LabelPosition === 1 || properties.LabelPosition === 'Collapsed';
      context.ordered(presenter, [icon, label]);
      presenter.setAttribute('aria-label', presentation.label || label.textContent || presentation.description);
      presenter.style.flexDirection = properties.LabelPosition === 2 || properties.LabelPosition === 'Right' ? 'row' : 'column';
      presenter.style.gap = '4px';
    } else context.content(presenter, properties.Content ?? properties.Label);
    if (context.getState(node).familyTemplate) presenter.style.padding = '0';
    else if (properties.Padding && typeof properties.Padding === 'object') {
      const padding = properties.Padding;
      presenter.style.padding = `${padding.Top ?? 0}px ${padding.Right ?? 0}px ${padding.Bottom ?? 0}px ${padding.Left ?? 0}px`;
    } else presenter.style.padding = Number.isFinite(properties.Padding) ? properties.Padding + 'px' : '0px 11px';
  }
  Object.assign(presenter.style, { display: 'inline-flex', alignItems: ['flex-start', 'center', 'flex-end', 'stretch']
    [properties.VerticalContentAlignment ?? 1], justifyContent: ['flex-start', 'center', 'flex-end', 'stretch']
    [properties.HorizontalContentAlignment ?? 1], boxSizing: 'border-box', minHeight: '0', minWidth: '0', lineHeight: '1' });
  const disabled = properties.IsEnabled === false || !commandCanExecute(context, node);
  presenter.disabled = disabled;
  element.setAttribute('aria-disabled', String(disabled));
  if (['ToggleButton', 'ToggleSplitButton', 'AppBarToggleButton'].includes(kind)) {
    presenter.setAttribute('aria-pressed', properties.IsIndeterminate ? 'mixed' : String(properties.IsChecked ?? false));
  }
  if (kind === 'HyperlinkButton') {
    presenter.setAttribute('role', 'link');
    presenter.tabIndex = disabled ? -1 : properties.TabIndex ?? 0;
  }
  if (kind === 'DropDownButton' || split) presenter.setAttribute('aria-haspopup', 'menu');
  if (kind === 'DropDownButton') {
    const chevron = createPart(context.document, 'span', 'dropdown-chevron');
    chevron.textContent = '▾';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.style.marginInlineStart = '8px';
    presenter.append(chevron);
  }
}

function showFlyout(context, node, element) {
  const reference = node.properties.AttachedFlyout ?? node.properties.Flyout;
  if (!reference) return;
  const flyout = context.nodes.get(reference.$ref);
  if (flyout) showControlOverlay(context, flyout, { target: element }).catch(error => context.host.options.onError?.(error));
}

function buttonEvent(context, node, element, event) {
  const properties = node.properties;
  const kind = controlName(node);
  if (properties.IsEnabled === false || !commandCanExecute(context, node)) return false;
  if (event.type === 'keydown' || event.type === 'keyup') {
    if (event.type === 'keydown' && (event.key === 'F4' || event.altKey && event.key === 'ArrowDown')) {
      if (kind === 'DropDownButton' || kind === 'SplitButton' || kind === 'ToggleSplitButton') {
        event.preventDefault();
        showFlyout(context, node, element);
        return true;
      }
    }
    if (event.key !== ' ' && event.key !== 'Enter') return false;
    if (kind === 'RepeatButton') {
      event.preventDefault();
      const repeat = stateFor(context, node, 'repeat', () => new RepeatController(() => invokeButton(context, node)));
      repeat.delay = properties.Delay ?? 500;
      repeat.interval = properties.Interval ?? 100;
      if (event.type === 'keydown') repeat.start();
      else repeat.stop();
      return true;
    }
    if (properties.ClickMode === 1) {
      event.preventDefault();
      if (event.type === 'keydown' && !event.repeat) invokeButton(context, node);
      return true;
    }
    return false;
  }
  if (event.type === 'pointerdown') {
    properties.IsPressed = true;
    if (kind === 'RepeatButton') {
      stateFor(context, node, 'repeat', () => new RepeatController(() => invokeButton(context, node),
        { delay: properties.Delay ?? 500, interval: properties.Interval ?? 100 })).start();
      element.setPointerCapture?.(event.pointerId);
    } else if (properties.ClickMode === 1) invokeButton(context, node);
    return true;
  }
  if (['pointerup', 'pointercancel', 'lostpointercapture', 'focusout'].includes(event.type)) {
    properties.IsPressed = false;
    stateFor(context, node, 'repeat', () => new RepeatController(() => invokeButton(context, node))).stop();
    return true;
  }
  if (event.type === 'pointerover') {
    properties.IsPointerOver = true;
    if (properties.ClickMode === 2) invokeButton(context, node);
    return true;
  }
  if (event.type === 'pointerout') {
    properties.IsPointerOver = false;
    if (!element.contains(event.relatedTarget)) stateFor(context, node, 'repeat', () => new RepeatController(() => invokeButton(context, node))).stop();
    return true;
  }
  if (event.type !== 'click') return false;
  if (properties.IsEnabled === false || !commandCanExecute(context, node)) return true;
  const secondary = event.target.closest?.('[data-part="split-secondary"]');
  if (!secondary && ['ToggleButton', 'ToggleSplitButton', 'AppBarToggleButton'].includes(kind)) {
    properties.IsChecked = nextToggleValue(properties.IsIndeterminate ? null : properties.IsChecked, properties.IsThreeState);
    properties.IsIndeterminate = properties.IsChecked === null;
    emitChange(context, node, properties.IsChecked === null ? 'Indeterminate' : properties.IsChecked ? 'Checked' : 'Unchecked',
      { value: properties.IsChecked });
    if (kind === 'ToggleSplitButton') context.emit(node, 'IsCheckedChanged', { IsChecked: properties.IsChecked });
  }
  if (kind === 'DropDownButton' || secondary) showFlyout(context, node, element);
  else if (kind !== 'RepeatButton' && !properties.ClickMode) {
    invokeButton(context, node);
    if (kind === 'HyperlinkButton' && properties.NavigateUri) {
      context.services?.launcher?.launchUri(properties.NavigateUri).catch(error => context.host.options.onError?.(error));
    } else showFlyout(context, node, element);
  }
  return true;
}

function renderCheck(context, node, element) {
  const properties = node.properties;
  const kind = controlName(node);
  const [input, content] = element.children;
  const value = kind === 'ToggleSwitch' ? properties.IsOn : properties.IsIndeterminate ? null : properties.IsChecked;
  input.type = kind === 'RadioButton' ? 'radio' : 'checkbox';
  input.checked = value === true;
  input.indeterminate = value === null;
  input.disabled = properties.IsEnabled === false || !commandCanExecute(context, node);
  input.setAttribute('aria-checked', value === null ? 'mixed' : String(!!value));
  if (kind === 'RadioButton') input.removeAttribute('name');
  if (kind === 'ToggleSwitch') input.setAttribute('role', 'switch');
  if (kind === 'ToggleSwitch') {
    const header = createPart(context.document, 'span', 'toggle-header');
    const state = createPart(context.document, 'span', 'toggle-state');
    context.content(header, properties.Header);
    header.hidden = properties.Header == null || properties.Header === '';
    context.content(state, value ? properties.OnContent ?? 'On' : properties.OffContent ?? 'Off');
    header.style.display = state.style.display = 'block';
    context.ordered(content, [header, state]);
  } else context.content(content, properties.Content ?? properties.Header);
}

function checkEvent(context, node, element, event) {
  if (event.type !== 'change' || node.properties.IsEnabled === false) return false;
  const properties = node.properties;
  const kind = controlName(node);
  const key = kind === 'ToggleSwitch' ? 'IsOn' : 'IsChecked';
  const value = kind === 'RadioButton' ? true : nextToggleValue(properties.IsIndeterminate ? null : properties[key], properties.IsThreeState);
  if (kind === 'RadioButton') {
    const parent = element.parentElement?.closest('[data-sf-id]');
    for (const otherElement of context.elements.values()) {
      const other = context.nodes.get(otherElement.dataset.sfId);
      if (!other || other.id === node.id || controlName(other) !== 'RadioButton') continue;
      const sameGroup = properties.GroupName ? other.properties.GroupName === properties.GroupName
        : !other.properties.GroupName && otherElement.parentElement?.closest('[data-sf-id]') === parent;
      if (sameGroup && other.properties.IsChecked === true) {
        other.properties.IsChecked = false;
        emitChange(context, other, 'Unchecked', { value: false });
      }
    }
  }
  properties[key] = value;
  properties.IsIndeterminate = value === null;
  emitChange(context, node, kind === 'ToggleSwitch' ? 'Toggled' : value === null ? 'Indeterminate' : value ? 'Checked' : 'Unchecked', { value });
  if (kind === 'ToggleSwitch') executeCommand(context, node);
  else invokeButton(context, node);
  return true;
}

export function registerButtonRenderers(registry) {
  registerFamily(registry, ['Button', 'ButtonBase', 'ToggleButton', 'RepeatButton', 'DropDownButton', 'SplitButton',
    'ToggleSplitButton', 'AppBarButton', 'AppBarToggleButton', 'HyperlinkButton'], {
    create(context, node) {
      const split = ['SplitButton', 'ToggleSplitButton'].includes(controlName(node));
      const element = context.document.createElement(split ? 'div' : 'button');
      if (!split) element.type = 'button';
      else {
        const secondary = createPart(context.document, 'button', 'split-secondary');
        secondary.textContent = '▾';
        secondary.setAttribute('aria-label', 'More options');
        element.append(createPart(context.document, 'button', 'split-primary'), secondary);
      }
      return element;
    }, render: renderButton, invoke: invokeButtonAction, events: { click: buttonEvent, pointerdown: buttonEvent, pointerup: buttonEvent,
      pointercancel: buttonEvent, pointerover: buttonEvent, pointerout: buttonEvent, lostpointercapture: buttonEvent, focusout: buttonEvent,
      keydown: buttonEvent, keyup: buttonEvent }
  });
  registerFamily(registry, ['CheckBox', 'RadioButton', 'ToggleSwitch'], { create(context) {
    const element = context.document.createElement('label');
    element.append(createPart(context.document, 'input', 'toggle-input'), createPart(context.document, 'span', 'toggle-content'));
    return element;
  }, render: renderCheck, invoke: invokeButtonAction, events: { change: checkEvent } });
}

function invokeButtonAction(context, node, element, method) {
  if (!['Invoke', 'Toggle', 'Select'].includes(method)) return undefined;
  if (node.properties.IsEnabled === false || !commandCanExecute(context, node)) return false;
  const input = element.querySelector('[data-part="toggle-input"]');
  if (input) {
    input.checked = controlName(node) === 'RadioButton' || !input.checked;
    checkEvent(context, node, element, { type: 'change', target: input });
  } else buttonEvent(context, node, element, { type: 'click', target: element });
  return true;
}
