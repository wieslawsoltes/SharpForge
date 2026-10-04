import { NumericRange, CultureNumberFormatter } from './range.js';
import { evaluateNumericExpression } from './expression.js';
import { createPart, controlName, registerFamily, stateFor, emitChange } from '../policy/events.js';

export function getRangeModel(context, node) {
  return stateFor(context, node, 'range', () => {
    const model = new NumericRange({ minimum: node.properties.Minimum ?? 0, maximum: node.properties.Maximum ?? 100,
      value: node.properties.Value ?? 0 });
    model.on('ValueChanged', args => {
      node.properties.Value = args.NewValue;
      emitChange(context, node, 'ValueChanged', { ...args, value: args.NewValue });
    });
    return model;
  });
}

function rangeProperties(context, node, element) {
  const properties = node.properties;
  const model = getRangeModel(context, node);
  model.minimum = properties.Minimum ?? 0;
  model.maximum = properties.Maximum ?? 100;
  model.smallChange = properties.SmallChange ?? properties.StepFrequency ?? 1;
  model.largeChange = properties.LargeChange ?? 10;
  model.wrap = !!properties.IsWrapEnabled;
  model.validate();
  model.silence(() => model.set(properties.Value ?? 0));
  element.setAttribute('aria-valuemin', String(model.minimum));
  element.setAttribute('aria-valuemax', String(model.maximum));
  element.setAttribute('aria-valuenow', String(Number.isNaN(model.value) ? 0 : model.value));
  element.setAttribute('aria-label', String(properties.Header ?? properties.Name ?? controlName(node)));
  return model;
}

function renderNumber(context, node, element) {
  const properties = node.properties;
  const model = rangeProperties(context, node, element);
  const [header, input, minus, plus, description] = element.children;
  const formatter = stateFor(context, node, 'number-format', () => new CultureNumberFormatter(properties.Language ?? 'en-US'));
  header.textContent = String(properties.Header ?? '');
  header.hidden = properties.Header == null;
  description.textContent = String(properties.Description ?? '');
  description.hidden = !properties.Description;
  input.setAttribute('role', 'spinbutton');
  input.readOnly = !!properties.IsReadOnly;
  input.placeholder = properties.PlaceholderText ?? '';
  if (input !== context.document.activeElement) input.value = properties.Text ?? formatter.format(model.value);
  minus.hidden = plus.hidden = properties.SpinButtonPlacementMode === 0;
  minus.disabled = plus.disabled = properties.IsReadOnly || properties.IsEnabled === false;
  input.setAttribute('aria-valuenow', String(model.value));
}

function numberEvent(context, node, element, event) {
  if (node.properties.IsEnabled === false || node.properties.IsReadOnly) return false;
  const model = getRangeModel(context, node);
  const input = element.querySelector('[data-part="number-input"]');
  if (event.type === 'input') { node.properties.Text = input.value; return true; }
  const direction = event.target.dataset.part === 'number-increase' ? 1 : event.target.dataset.part === 'number-decrease' ? -1 : 0;
  if (event.type === 'click' && direction) { model.step(direction); node.properties.Text = null; return true; }
  if (event.type === 'keydown' && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) {
    event.preventDefault();
    model.step(event.key.endsWith('Up') ? 1 : -1, event.key.startsWith('Page'));
    node.properties.Text = null;
    input.value = String(model.value);
    return true;
  }
  if (event.type === 'change' || event.type === 'keydown' && event.key === 'Enter') {
    try {
      const formatter = stateFor(context, node, 'number-format', () => new CultureNumberFormatter(node.properties.Language ?? 'en-US'));
      const value = node.properties.AcceptsExpression ? evaluateNumericExpression(formatter.normalize(input.value)) : formatter.parse(input.value);
      model.set(value);
      node.properties.Text = formatter.format(model.value);
      input.value = node.properties.Text;
      input.removeAttribute('aria-invalid');
    } catch (error) {
      input.setAttribute('aria-invalid', 'true');
      context.emit(node, 'ValidationFailed', { Code: error.code, Message: error.message });
      if ((node.properties.ValidationMode ?? 0) === 0) input.value = Number.isNaN(model.value) ? '' : String(model.value);
    }
    return true;
  }
  return false;
}

function renderSlider(context, node, element) {
  const model = rangeProperties(context, node, element);
  const properties = node.properties;
  const [track, thumb] = element.children;
  element.setAttribute('role', 'slider');
  element.tabIndex = properties.IsEnabled === false ? -1 : properties.TabIndex ?? 0;
  const vertical = properties.Orientation === 0;
  element.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
  Object.assign(element.style, { position: 'relative', touchAction: 'none', minHeight: vertical ? '80px' : '24px' });
  const fraction = Math.max(0, Math.min(1, Number.isFinite(model.fraction) ? model.fraction : 0));
  const position = (properties.IsDirectionReversed ? 1 - fraction : fraction) * 100 + '%';
  Object.assign(track.style, { position: 'absolute', background: 'currentColor', opacity: '0.3', borderRadius: '2px',
    left: vertical ? '50%' : '0', top: vertical ? '0' : '50%', width: vertical ? '4px' : '100%', height: vertical ? '100%' : '4px' });
  Object.assign(thumb.style, { position: 'absolute', background: 'currentColor', borderRadius: '50%', width: '16px', height: '16px',
    left: vertical ? '50%' : position, bottom: vertical ? position : '', top: vertical ? '' : '50%', transform: 'translate(-50%, -50%)' });
  thumb.title = properties.IsThumbToolTipEnabled === false ? '' : String(model.value);
}

function sliderEvent(context, node, element, event) {
  if (node.properties.IsEnabled === false) return false;
  const model = getRangeModel(context, node);
  const state = stateFor(context, node, 'slider-pointer', () => ({ pointer: null }));
  if (event.type === 'pointerdown') { state.pointer = event.pointerId; element.setPointerCapture?.(event.pointerId); }
  if ((event.type === 'pointermove' || event.type === 'pointerdown') && state.pointer === event.pointerId) {
    const rect = element.getBoundingClientRect();
    let ratio = node.properties.Orientation === 0 ? 1 - (event.clientY - rect.top) / rect.height : (event.clientX - rect.left) / rect.width;
    if (node.properties.IsDirectionReversed) ratio = 1 - ratio;
    let value = model.minimum + Math.max(0, Math.min(1, ratio)) * (model.maximum - model.minimum);
    const step = node.properties.SnapsTo === 1 ? node.properties.TickFrequency : node.properties.StepFrequency;
    if (step > 0) value = model.minimum + Math.round((value - model.minimum) / step) * step;
    model.set(value);
    return true;
  }
  if (event.type === 'pointerup' || event.type === 'pointercancel') { state.pointer = null; return true; }
  if (event.type !== 'keydown') return false;
  if (event.key === 'Home') model.set(model.minimum);
  else if (event.key === 'End') model.set(model.maximum);
  else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(event.key)) {
    const direction = ['ArrowUp', 'ArrowRight', 'PageUp'].includes(event.key) ? 1 : -1;
    model.step(direction * (node.properties.IsDirectionReversed ? -1 : 1), event.key.startsWith('Page'));
  } else return false;
  event.preventDefault();
  return true;
}

function renderProgress(context, node, element) {
  const model = rangeProperties(context, node, element);
  const properties = node.properties;
  element.setAttribute('role', 'progressbar');
  if (properties.IsIndeterminate) element.removeAttribute('aria-valuenow');
  element.dataset.progressState = properties.ShowError ? 'error' : properties.ShowPaused ? 'paused' : 'normal';
  const fraction = Math.max(0, Math.min(1, Number.isFinite(model.fraction) ? model.fraction : 0));
  const ring = controlName(node) === 'ProgressRing';
  const paint = element.firstChild;
  paint.style.color = context.services.environment?.HighContrast ? 'CanvasText'
    : properties.ShowError ? '#c42b1c' : properties.ShowPaused ? '#9d5d00' : '';
  if (ring) {
    element.hidden = properties.IsActive === false;
    Object.assign(paint.style, { width: '100%', height: '100%', borderRadius: '50%',
      background: `conic-gradient(currentColor ${properties.IsIndeterminate ? 100 : fraction * 360}deg, transparent 0deg)`,
      maskImage: 'radial-gradient(transparent 50%, black 53%)' });
  } else {
    element.style.overflow = 'hidden';
    paint.style.width = (properties.IsIndeterminate ? 35 : fraction * 100) + '%';
    paint.style.height = '100%';
    paint.style.background = 'currentColor';
  }
  const state = stateFor(context, node, 'progress-animation', () => ({ animation: null,
    dispose() { this.animation?.cancel(); } }));
  const animated = properties.IsIndeterminate && !element.hidden && !properties.ShowPaused && !properties.ShowError
    && context.services.environment?.AnimationsEnabled !== false;
  const signature = `${!!animated}:${ring}`;
  if (state.signature === signature) return;
  state.signature = signature;
  state.animation?.cancel();
  state.animation = animated && paint.animate ? paint.animate(ring
    ? [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }]
    : [{ transform: 'translateX(-100%)' }, { transform: 'translateX(286%)' }], { duration: 1200, iterations: Infinity }) : null;
}

export function registerRangeRenderers(registry) {
  registerFamily(registry, 'NumberBox', { create(context) {
    const element = context.document.createElement('div');
    const decrease = createPart(context.document, 'button', 'number-decrease');
    const increase = createPart(context.document, 'button', 'number-increase');
    decrease.textContent = '−'; increase.textContent = '+';
    decrease.setAttribute('aria-label', 'Decrease'); increase.setAttribute('aria-label', 'Increase');
    element.append(createPart(context.document, 'label', 'number-header'), createPart(context.document, 'input', 'number-input'),
      decrease, increase, createPart(context.document, 'div', 'number-description'));
    return element;
  }, render: renderNumber, invoke: invokeRange, events: { input: numberEvent, change: numberEvent, keydown: numberEvent, click: numberEvent } });
  registerFamily(registry, 'Slider', { create(context) {
    const element = context.document.createElement('div');
    element.append(createPart(context.document, 'div', 'slider-track'), createPart(context.document, 'div', 'slider-thumb'));
    return element;
  }, render: renderSlider, invoke: invokeRange, events: { pointerdown: sliderEvent, pointermove: sliderEvent, pointerup: sliderEvent,
    pointercancel: sliderEvent, keydown: sliderEvent } });
  registerFamily(registry, ['ProgressBar', 'ProgressRing'], { create(context) {
    const element = context.document.createElement('div');
    element.append(context.document.createElement('div'));
    return element;
  }, render: renderProgress });
}

function invokeRange(context, node, element, method, args) {
  if (method !== 'SetValue') return undefined;
  if (node.properties.IsEnabled === false || node.properties.IsReadOnly) return false;
  return getRangeModel(context, node).set(Number(args[0]));
}
