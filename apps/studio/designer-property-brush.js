import {
  colorToHsv, designerColorHex, hsvToColor, normalizeDesignerBrush, normalizeDesignerColor
} from '../../packages/designer/src/index.js';
import {MEDIA} from '../../packages/framework/src/index.js';
import {propertyButton, propertyElement, propertyField, propertyInput, propertySelect} from './designer-property-dom.js';

function colorFields(context, initial, commit) {
  const document = context.document;
  const root = propertyElement(document, 'div', '', 'design-color-fields');
  const color = normalizeDesignerColor(initial);
  const picker = propertyInput(document, {type: 'color', value: designerColorHex(color, {alpha: false}), label: 'Pick color'});
  picker.addEventListener('input', () => { hex.value = designerColorHex({...normalizeDesignerColor(picker.value), A: color.A}); });
  picker.addEventListener('change', () => context.run(() => commit({...normalizeDesignerColor(picker.value), A: color.A})));
  const hex = propertyInput(document, {value: designerColorHex(color), label: 'Color hex'});
  hex.addEventListener('change', () => context.run(() => commit(normalizeDesignerColor(hex.value))));
  root.append(picker, hex);
  const channels = propertyElement(document, 'details');
  channels.append(propertyElement(document, 'summary', 'RGBA / HSV'));
  for (const channel of ['R', 'G', 'B', 'A']) {
    const input = propertyInput(document, {type: 'number', value: color[channel], label: channel});
    input.min = '0';
    input.max = '255';
    input.step = '1';
    input.addEventListener('change', () => context.run(() => commit(normalizeDesignerColor({...color, [channel]: Number(input.value)}))));
    channels.append(propertyField(document, channel, input));
  }
  const hsv = colorToHsv(color);
  for (const channel of ['h', 's', 'v']) {
    const input = propertyInput(document, {type: 'number', value: Number(hsv[channel].toFixed(4)), label: channel.toUpperCase()});
    input.min = '0';
    input.max = channel === 'h' ? '360' : '1';
    input.step = channel === 'h' ? '1' : '0.01';
    input.addEventListener('change', () => context.run(() => commit(hsvToColor({...hsv, [channel]: Number(input.value)}))));
    channels.append(propertyField(document, channel.toUpperCase(), input));
  }
  root.append(channels);
  const EyeDropper = document.defaultView?.EyeDropper;
  if (EyeDropper) {
    root.append(propertyButton(document, 'Eyedropper', () => context.run(async () => {
      const result = await new EyeDropper().open();
      return commit({...normalizeDesignerColor(result.sRGBHex), A: color.A});
    })));
  }
  return root;
}

function gradientFields(context, brush) {
  const root = propertyElement(context.document, 'div', '', 'design-gradient-editor');
  const commit = next => context.commit(normalizeDesignerBrush(next));
  for (let index = 0; index < brush.GradientStops.length; index++) {
    const stop = brush.GradientStops[index];
    const row = propertyElement(context.document, 'div', '', 'design-gradient-stop');
    const offset = propertyInput(context.document, {type: 'number', value: stop.Offset, label: `Stop ${index + 1} offset`});
    offset.min = '0';
    offset.max = '1';
    offset.step = '0.01';
    offset.addEventListener('change', () => context.run(() => {
      const next = structuredClone(brush);
      next.GradientStops[index].Offset = Number(offset.value);
      return commit(next);
    }));
    row.append(propertyField(context.document, 'Offset', offset), colorFields(context, stop.Color, color => {
      const next = structuredClone(brush);
      next.GradientStops[index].Color = color;
      return commit(next);
    }), propertyButton(context.document, 'Remove stop', () => context.run(() => {
      const next = structuredClone(brush);
      next.GradientStops.splice(index, 1);
      return commit(next);
    }), {disabled: brush.GradientStops.length <= 2}));
    root.append(row);
  }
  root.append(propertyButton(context.document, 'Add stop', () => context.run(() => {
    const next = structuredClone(brush);
    next.GradientStops.push({Offset: 0.5, Color: normalizeDesignerColor('#ffffff')});
    return commit(next);
  }), {disabled: brush.GradientStops.length >= 64}));
  for (const point of ['StartPoint', 'EndPoint']) {
    for (const axis of ['X', 'Y']) {
      const input = propertyInput(context.document, {type: 'number', value: brush[point][axis], label: point + ' ' + axis});
      input.step = '0.1';
      input.addEventListener('change', () => context.run(() => {
        const next = structuredClone(brush);
        next[point][axis] = Number(input.value);
        return commit(next);
      }));
      root.append(propertyField(context.document, point + ' ' + axis, input));
    }
  }
  return root;
}

export function brushPropertyEditor(context) {
  const document = context.document;
  const root = propertyElement(document, 'div', '', 'design-brush-editor');
  const brush = context.value ? normalizeDesignerBrush(context.value) : normalizeDesignerBrush('#000000');
  const mode = brush.valueType === MEDIA + 'LinearGradientBrush' ? 'gradient' : 'solid';
  const selector = propertySelect(document, [{value: 'solid', label: 'Solid'}, {value: 'gradient', label: 'Linear gradient'},
    {value: 'resource', label: 'Resource'}], mode, 'Brush mode');
  selector.addEventListener('change', () => context.run(() => {
    if (selector.value === 'resource') return context.openReference();
    if (selector.value === 'solid') return context.commit(normalizeDesignerBrush(brush.GradientStops?.[0].Color ?
      designerColorHex(brush.GradientStops[0].Color) : '#000000'));
    return context.commit(normalizeDesignerBrush({valueType: MEDIA + 'LinearGradientBrush', GradientStops: [
      {Color: brush.Color ?? normalizeDesignerColor('#000000'), Offset: 0},
      {Color: normalizeDesignerColor('#ffffff'), Offset: 1}
    ]}));
  }));
  root.append(selector);
  if (context.mixed) root.append(propertyElement(document, 'small', 'Mixed values · choose a color to replace all selected values.'));
  root.append(mode === 'gradient' ? gradientFields(context, brush) : colorFields(context, brush.Color,
    color => context.commit({...brush, Color: color})));
  return root;
}
