import {XAML, MEDIA} from '@sharpforge/framework';

function timeSpan(type, args) {
  const milliseconds = args[0] ?? 0;
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || Math.abs(milliseconds) > 1e12) {
    throw new RangeError('TimeSpan range');
  }
  return Object.freeze({valueType: type, TotalMilliseconds: milliseconds, TotalSeconds: milliseconds / 1000});
}

function duration(type, args) {
  const value = args[0];
  if (value?.valueType !== 'System.TimeSpan' || value.TotalMilliseconds < 0) throw new TypeError('Nonnegative TimeSpan required');
  return Object.freeze({valueType: type, TimeSpan: value});
}

function repeat(type, args) {
  const value = args[0];
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e6) {
    return Object.freeze({valueType: type, Count: value});
  }
  if (value?.valueType === 'System.TimeSpan' && value.TotalMilliseconds >= 0) {
    return Object.freeze({valueType: type, Duration: value});
  }
  throw new TypeError('RepeatBehavior requires count or TimeSpan');
}

function solidBrush(type, args, context) {
  let color = args[0] ?? {valueType: 'Windows.UI.Color', A: 0, R: 0, G: 0, B: 0};
  const brush = {
    valueType: type,
    get Color() { return color; },
    set Color(value) {
      if (value?.valueType !== 'Windows.UI.Color') throw new TypeError('Color required');
      color = value;
      context.styles.valueChanged(brush);
    }
  };
  return brush;
}

/** Instance-owned constructor table; additions register without extending the facade dispatcher. */
export class JavaScriptValueFactories {
  constructor(context) {
    this.context = context;
    this.factories = new Map([
      ['System.TimeSpan', timeSpan],
      [XAML + 'Duration', duration],
      [XAML + 'Media.Animation.RepeatBehavior', repeat],
      [XAML + 'RepeatBehavior', repeat],
      [XAML + 'Thickness', (type, args) => {
        const [left = 0, top = left, right = left, bottom = top] = args;
        return Object.freeze({valueType: type, Left: left, Top: top, Right: right, Bottom: bottom});
      }],
      [XAML + 'CornerRadius', (type, args) => {
        const [topLeft = 0, topRight = topLeft, bottomRight = topLeft, bottomLeft = topLeft] = args;
        return Object.freeze({valueType: type, TopLeft: topLeft, TopRight: topRight, BottomRight: bottomRight, BottomLeft: bottomLeft});
      }],
      [XAML + 'GridLength', (type, args) => Object.freeze({valueType: type, Value: args[0] ?? 1, GridUnitType: args[1] ?? 1})],
      ['Windows.UI.Color', (type, args) => Object.freeze({valueType: type, A: args[0] ?? 255, R: args[1] ?? 0, G: args[2] ?? 0, B: args[3] ?? 0})],
      [MEDIA + 'SolidColorBrush', solidBrush]
    ]);
  }

  register(type, factory) {
    if (this.factories.has(type) || typeof factory !== 'function') throw new TypeError('Duplicate or invalid value constructor');
    this.factories.set(type, factory);
  }

  create(type, args) {
    const factory = this.factories.get(type);
    if (!factory) throw new TypeError('Unsupported value constructor ' + type);
    return factory(type, args, this.context);
  }
}

export function colorChannels(css) {
  const hex = css.slice(1);
  const value = Number.parseInt(hex, 16);
  return hex.length === 8 ? [value & 255, value >>> 24, value >>> 16 & 255, value >>> 8 & 255]
    : [255, value >>> 16 & 255, value >>> 8 & 255, value & 255];
}
