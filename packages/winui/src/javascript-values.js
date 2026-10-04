import {createJavaScriptGradients} from './javascript-gradients.js';
import {gradientColor, gradientNumber} from './gradient-data.js';

/** Registered JavaScript value constructors share the managed portable ranges and detached gradient serialization. */
export function createJavaScriptValues(context) {
  const gradients = createJavaScriptGradients(context);
  const record = (valueType, value) => Object.freeze({valueType, ...value});
  function timespan(args) {
    const milliseconds = args[0] ?? 0;
    if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || Math.abs(milliseconds) > 1e12) {
      throw new RangeError('TimeSpan range');
    }
    return {TotalMilliseconds: milliseconds, TotalSeconds: milliseconds / 1000};
  }
  function duration(args) {
    const time = args[0];
    if (time?.valueType !== 'System.TimeSpan' || time.TotalMilliseconds < 0) throw new TypeError('Nonnegative TimeSpan required');
    return {TimeSpan: time};
  }
  function repeat(args) {
    const value = args[0];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e6) return {Count: value};
    if (value?.valueType === 'System.TimeSpan' && value.TotalMilliseconds >= 0) return {Duration: value};
    throw new TypeError('RepeatBehavior requires count or TimeSpan');
  }
  function solid(type, args) {
    let color = record('Windows.UI.Color', gradientColor(args[0] ?? {valueType: 'Windows.UI.Color', A: 0, R: 0, G: 0, B: 0}));
    let opacity = 1;
    const refresh = () => {
      for (const object of context.objects.values()) {
        for (const [property, value] of Object.entries(object.$values)) {
          if (value === brush) context.send({op: 'set', id: object.$node.id, property, value: brush});
        }
      }
    };
    const brush = {
      valueType: type,
      get Color() { return color; },
      set Color(value) { context.alive(); color = Object.freeze(gradientColor(value)); refresh(); },
      get Opacity() { return opacity; },
      set Opacity(value) { context.alive(); opacity = gradientNumber(value, 0, 1, 'Opacity'); refresh(); }
    };
    return Object.preventExtensions(brush);
  }
  const factories = new Map([
    ['TimeSpan', timespan], ['Duration', duration], ['RepeatBehavior', repeat],
    ['Thickness', args => {
      const [left = 0, top = left, right = left, bottom = top] = args;
      return {Left: left, Top: top, Right: right, Bottom: bottom};
    }],
    ['CornerRadius', args => {
      const [topLeft = 0, topRight = topLeft, bottomRight = topLeft, bottomLeft = topLeft] = args;
      return {TopLeft: topLeft, TopRight: topRight, BottomRight: bottomRight, BottomLeft: bottomLeft};
    }],
    ['GridLength', args => ({Value: args[0] ?? 1, GridUnitType: args[1] ?? 1})],
    ['Color', args => ({A: args[0] ?? 255, R: args[1] ?? 0, G: args[2] ?? 0, B: args[3] ?? 0})]
  ]);
  return {
    supports: gradients.supports,
    export: gradients.export,
    construct(type, args) {
      context.alive();
      if (gradients.supports(type)) return gradients.construct(type, args);
      const name = type.slice(type.lastIndexOf('.') + 1);
      if (name === 'SolidColorBrush') return solid(type, args);
      const factory = factories.get(name);
      if (!factory) throw new Error('Unsupported value constructor ' + type);
      return record(type, factory(args));
    }
  };
}
