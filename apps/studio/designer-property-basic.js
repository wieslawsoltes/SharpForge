import {compoundFields, scrubDesignerNumber} from '../../packages/designer/src/index.js';
import {frameworkType, XAML} from '../../packages/framework/src/index.js';
import {propertyButton, propertyElement, propertyField, propertyInput, propertySelect} from './designer-property-dom.js';

function commitOnChange(input, context, value = () => input.value) {
  input.dataset.property = context.name;
  input.addEventListener('change', () => context.run(() => context.commit(value())));
  return input;
}

export function textPropertyEditor(context) {
  return commitOnChange(propertyInput(context.document, {value: context.mixed ? '' : context.text,
    placeholder: context.mixed ? 'Mixed' : '', label: context.name}), context);
}

export function booleanPropertyEditor(context) {
  const input = propertyInput(context.document, {type: 'checkbox', label: context.name});
  input.checked = !!context.value;
  input.indeterminate = context.mixed;
  return commitOnChange(input, context, () => input.checked);
}

export function enumPropertyEditor(context) {
  const values = frameworkType(context.schema.type).values;
  const choices = Object.entries(values).map(([label, value]) => ({label, value}));
  if (context.mixed) choices.unshift({label: '(Mixed)', value: ''});
  const input = propertySelect(context.document, choices, context.mixed ? '' : context.value, context.name);
  return commitOnChange(input, context, () => Number(input.value));
}

export function flagsPropertyEditor(context) {
  const root = propertyElement(context.document, 'fieldset', '', 'design-flags-editor');
  root.append(propertyElement(context.document, 'legend', context.name));
  const values = frameworkType(context.schema.type).values;
  const inputs = [];
  for (const [name, value] of Object.entries(values)) {
    if (value === 0) continue;
    const input = propertyInput(context.document, {type: 'checkbox', label: name});
    input.checked = !context.mixed && (context.value & value) === value;
    input.indeterminate = context.mixed;
    inputs.push({input, value});
    input.addEventListener('change', () => context.run(() => context.commit(
      inputs.reduce((mask, item) => item.input.checked ? mask | item.value : mask, 0) >>> 0)));
    root.append(propertyField(context.document, name, input));
  }
  return root;
}

/** A scrub changes the draft input only; pointer-up is a single undoable edit, Escape restores the draft. */
export function bindPropertyScrub(handle, input, context) {
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || input.disabled) return;
    event.preventDefault();
    const original = input.value;
    const start = Number(input.value || 0);
    const document = handle.ownerDocument;
    let current = start;
    const cleanup = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
    };
    const move = next => {
      if (next.pointerId !== event.pointerId) return;
      current = scrubDesignerNumber(start, next.clientX - event.clientX, context.schema.constraints,
        {step: context.step ?? 1, fine: next.altKey, coarse: next.shiftKey});
      input.value = String(current);
    };
    const up = next => {
      if (next.pointerId !== event.pointerId) return;
      cleanup();
      if (input.value !== original) context.run(() => context.commit(current));
    };
    const cancel = () => { cleanup(); input.value = original; };
    const key = next => { if (next.key === 'Escape') { next.preventDefault(); cancel(); } };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
  });
}

export function numericPropertyEditor(context) {
  const root = propertyElement(context.document, 'div', '', 'design-numeric-editor');
  const input = propertyInput(context.document, {type: 'number', value: context.mixed ? '' : context.text,
    placeholder: context.mixed ? 'Mixed' : 'Unset', label: context.name});
  const constraints = context.schema.constraints ?? {};
  if (constraints.minimum !== undefined) input.min = constraints.minimum;
  if (constraints.maximum !== undefined) input.max = constraints.maximum;
  input.step = constraints.integer ? '1' : 'any';
  commitOnChange(input, context, () => input.value === '' ? undefined : Number(input.value));
  const scrub = propertyButton(context.document, '↔', () => {}, {title: 'Drag to adjust; Alt for fine, Shift for coarse; Escape to cancel'});
  scrub.setAttribute('aria-label', 'Scrub ' + context.name);
  bindPropertyScrub(scrub, input, context);
  root.append(input, scrub);
  return root;
}

export function fontPropertyEditor(context) {
  const root = propertyElement(context.document, 'div', '', 'design-font-editor');
  const weights = [['Thin', 100], ['Extra light', 200], ['Light', 300], ['Normal', 400], ['Medium', 500],
    ['Semi bold', 600], ['Bold', 700], ['Extra bold', 800], ['Black', 900]];
  if (context.name === 'FontWeight') {
    const select = propertySelect(context.document, weights.map(([label, value]) => ({label, value})), context.value, context.name);
    root.append(commitOnChange(select, context, () => Number(select.value)));
  } else {
    const names = context.fontFamilies ?? ['Segoe UI', 'Arial', 'Georgia', 'Consolas', 'Courier New', 'system-ui', 'serif', 'monospace'];
    const select = propertySelect(context.document, [...new Set([context.value, ...names].filter(Boolean))], context.value, context.name);
    select.style.fontFamily = context.value ?? 'system-ui';
    root.append(commitOnChange(select, context));
    const preview = propertyElement(context.document, 'span', 'Aa Bb 0123', 'design-font-preview');
    preview.style.fontFamily = context.value ?? 'system-ui';
    root.append(preview);
  }
  return root;
}

export function compoundPropertyEditor(context) {
  const root = propertyElement(context.document, 'div', '', 'design-compound-editor');
  const fields = compoundFields(context.schema.type);
  const current = fields.map(field => context.value?.[field] ?? 0);
  const linked = propertyInput(context.document, {type: 'checkbox', label: 'Uniform ' + context.name});
  linked.checked = !context.mixed && current.every(value => value === current[0]);
  const controls = fields.map((field, index) => {
    const input = propertyInput(context.document, {type: 'number', value: context.mixed ? '' : String(current[index]),
      placeholder: context.mixed ? 'Mixed' : '0', label: context.name + ' ' + field});
    input.step = 'any';
    input.dataset.property = context.name;
    input.addEventListener('change', () => context.run(() => {
      const values = linked.checked ? Number(input.value) : controls.map(control => Number(control.value));
      return context.commit(values);
    }));
    const pair = propertyElement(context.document, 'div', '', 'design-numeric-editor');
    const scrub = propertyButton(context.document, '↔', () => {}, {title: 'Drag ' + field + '; Escape cancels'});
    bindPropertyScrub(scrub, input, {...context, commit: value => {
      if (linked.checked) return context.commit(value);
      return context.commit(controls.map((control, currentIndex) => currentIndex === index ? value : Number(control.value)));
    }});
    pair.append(input, scrub);
    const label = propertyElement(context.document, 'label', '', 'design-editor-field');
    label.append(propertyElement(context.document, 'span', field), pair);
    root.append(label);
    return input;
  });
  linked.addEventListener('change', () => {
    if (linked.checked) context.run(() => context.commit(Number(controls[0].value || 0)));
  });
  root.prepend(propertyField(context.document, 'Uniform', linked));
  return root;
}

export function gridLengthPropertyEditor(context) {
  const root = propertyElement(context.document, 'div', '', 'design-gridlength-editor');
  const unit = propertySelect(context.document, [{label: 'Auto', value: 0}, {label: 'Pixel', value: 1}, {label: 'Star', value: 2}],
    context.value?.GridUnitType ?? 0, 'Grid unit');
  const input = propertyInput(context.document, {type: 'number', value: context.mixed ? '' : context.value?.Value ?? 1, label: 'Grid value'});
  input.min = '0';
  input.step = 'any';
  const change = () => context.run(() => context.commit({valueType: XAML + 'GridLength', Value: Number(input.value), GridUnitType: Number(unit.value)}));
  unit.addEventListener('change', change);
  input.addEventListener('change', change);
  root.append(unit, input);
  return root;
}
