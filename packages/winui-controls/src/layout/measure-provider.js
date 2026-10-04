import { layoutFontFamily } from './text-format.js';
import { size, finite, typeName } from './geometry.js';

/** Bounded intrinsic measurement. Browser text uses actual canvas font metrics, never DOM layout slots. */
export class MeasureProvider {
  constructor({ document, resolve = () => null, measureText, maximumEntries = 2048, textScale = 1 } = {}) {
    this.document = document;
    this.resolve = resolve;
    this.maximumEntries = maximumEntries;
    this.textScale = textScale;
    this.cache = new Map();
    this.canvas = document?.createElement('canvas');
    this.context = this.canvas?.getContext('2d');
    this.textMeasure = measureText ?? ((text, font) => {
      if (!this.context) throw new Error('Text measurement requires a browser canvas or an injected text measurement provider');
      this.context.font = font;
      return this.context.measureText(text);
    });
  }

  measure(node, available) {
    const properties = node.properties ?? {};
    const type = typeName(node);
    if (type === 'Image') {
      const source = properties.Source?.$ref ? this.resolve(properties.Source.$ref)?.properties : properties.Source;
      return size(finite(properties.NaturalWidth ?? source?.PixelWidth), finite(properties.NaturalHeight ?? source?.PixelHeight));
    }
    if (['Rectangle', 'Ellipse', 'Path', 'Canvas', 'Grid', 'Panel'].includes(type)) return size();
    if (type === 'Line') return size(Math.abs(finite(properties.X2) - finite(properties.X1)),
      Math.abs(finite(properties.Y2) - finite(properties.Y1)));
    if (type === 'Slider' || type === 'ProgressBar') return size(type === 'Slider' ? 100 : 0, type === 'Slider' ? 32 : 6);
    if (type === 'ProgressRing') return size(28, 28);
    const text = properties.Text ?? properties.Content ?? properties.Header ?? properties.Label ?? '';
    if (typeof text === 'object') return size();
    const fontSize = Math.max(1, finite(properties.FontSize, 14)) * (properties.IsTextScaleFactorEnabled === false ? 1 : this.textScale);
    const font = `${properties.FontStyle === 1 ? 'italic ' : ''}${properties.FontWeight?.Weight ?? properties.FontWeight ?? 400} `
      + `${fontSize}px ${layoutFontFamily(properties, this.resolve)}`;
    const width = properties.TextWrapping === 0 ? Infinity : available.width;
    const key = [type, font, width, properties.LineHeight, properties.MaxLines, text].join('\u001f');
    if (this.cache.has(key)) return this.cache.get(key);
    const result = this.measureLines(String(text), { font, fontSize, width, lineHeight: properties.LineHeight, maxLines: properties.MaxLines });
    if (['TextBox', 'PasswordBox', 'AutoSuggestBox', 'NumberBox', 'CalendarDatePicker', 'TimePicker'].includes(type)) {
      result.width = Math.max(64, result.width);
      result.height = Math.max(20, result.height);
    }
    if (['Button', 'ToggleButton', 'AppBarButton', 'HyperlinkButton'].includes(type)) {
      result.width += 22;
      result.height = Math.max(32, result.height);
    }
    if (this.cache.size >= this.maximumEntries) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, result);
    return result;
  }

  setTextScaleFactor(value) {
    if (!Number.isFinite(value) || value < 0.5 || value > 8) throw new RangeError('Text scale must be between 0.5 and 8');
    if (this.textScale === value) return;
    this.textScale = value;
    this.invalidate();
  }

  measureLines(text, { font, fontSize, width, lineHeight, maxLines }) {
    if (text.length > 1000000) throw new RangeError('Text measurement length limit exceeded');
    const height = finite(lineHeight) > 0 ? lineHeight : fontSize * 1.2;
    const paragraphs = text.split(/\r\n|\r|\n/);
    let maximum = 0;
    let lines = 0;
    const lineLimit = maxLines > 0 ? maxLines : Infinity;
    for (const paragraph of paragraphs) {
      let rest = paragraph;
      do {
        const metric = this.textMeasure(rest, font);
        if (!Number.isFinite(metric.width)) throw new TypeError('Text measurement returned an invalid advance');
        let length = rest.length;
        let advance = metric.width;
        if (Number.isFinite(width) && width > 0 && advance > width) {
          let low = 1;
          let high = rest.length;
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (this.textMeasure(rest.slice(0, middle), font).width <= width) low = middle;
            else high = middle - 1;
          }
          length = low;
          const boundary = rest.lastIndexOf(' ', length);
          if (boundary > 0) length = boundary + 1;
          if (length < rest.length && /[\uD800-\uDBFF]/.test(rest[length - 1])) length++;
          advance = this.textMeasure(rest.slice(0, length), font).width;
        }
        maximum = Math.max(maximum, advance);
        lines++;
        rest = rest.slice(length);
      } while (rest && lines < lineLimit);
      if (lines >= lineLimit) break;
    }
    return size(maximum, Math.max(1, lines) * height);
  }

  invalidate() { this.cache.clear(); }
  dispose() { this.cache.clear(); this.context = null; this.canvas = null; }
}

/** OffscreenCanvas and HTMLCanvasElement expose the same real whole-run measurement contract. */
export function createCanvasMeasureProvider(canvas, options = {}) {
  const context = canvas?.getContext?.('2d');
  if (!context?.measureText) throw new TypeError('A canvas text measurement context is required');
  return new MeasureProvider({ ...options, measureText: (text, font) => {
    context.font = font;
    return context.measureText(text);
  } });
}
