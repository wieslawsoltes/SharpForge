import { SupportedTextSelection, TextUnit, TextPatternRangeEndpoint, enumValue } from './enums.js';

function rangeOffset(value, length) {
  if (!Number.isInteger(value) || value < 0 || value > length) throw new RangeError('SFAX008: Text range offset is outside the document');
  return value;
}

/** UTF-16 text/selection subset; geometry operations require the real shaping service. */
export class TextProvider {
  constructor(peer) { this.peer = peer; }
  get text() {
    this.peer.assertAlive();
    if (this.peer.IsPassword()) throw new Error('SFAX005: Password text is private');
    const model = this.peer.tree.modelFor(this.peer, 'getTextModel');
    return model?.text ?? String(this.peer.properties.Text ?? this.peer.properties.PlainText ?? '');
  }
  get SupportedTextSelection() { return this.peer.definition.textSelectable === false ? SupportedTextSelection.None : SupportedTextSelection.Single; }
  get DocumentRange() { return new TextRangeProvider(this, 0, this.text.length); }
  GetSelection() {
    if (this.SupportedTextSelection === SupportedTextSelection.None) return [];
    const model = this.peer.tree.modelFor(this.peer, 'getTextModel');
    const start = model?.selectionStart ?? model?.selection?.start ?? this.peer.properties.SelectionStart ?? 0;
    const length = model?.selectionLength ?? model?.selection?.length ?? this.peer.properties.SelectionLength ?? 0;
    return [new TextRangeProvider(this, Math.min(start, this.text.length), Math.min(start + length, this.text.length))];
  }
  GetVisibleRanges() {
    if (this.peer.IsOffscreen()) return [];
    const ranges = this.peer.tree.host.services?.text?.visibleRanges?.(this.peer.id);
    if (!ranges) return [this.DocumentRange];
    return ranges.map(range => new TextRangeProvider(this, range.start, range.end));
  }
  RangeFromChild(child) {
    const value = this.peer.tree.host.services?.text?.rangeForChild?.(this.peer.id, child?.id ?? child);
    if (!value) throw new Error('SFAX009: Inline range mapping requires the shaping service');
    return new TextRangeProvider(this, value.start, value.end);
  }
  RangeFromPoint(point) {
    const offset = this.peer.tree.host.services?.text?.hitTest?.(this.peer.id, point);
    if (!Number.isInteger(offset)) throw new Error('SFAX009: Text hit testing requires the shaping service');
    return new TextRangeProvider(this, offset, offset);
  }
}

/** Live ranges clamp after edits; document offsets never expose password storage. */
export class TextRangeProvider {
  constructor(provider, start, end) {
    this.provider = provider;
    this.start = rangeOffset(start, provider.text.length);
    this.end = rangeOffset(end, provider.text.length);
    if (end < start) throw new RangeError('SFAX008: Reversed text range');
  }
  normalize() {
    const length = this.provider.text.length;
    this.start = Math.min(this.start, length);
    this.end = Math.max(this.start, Math.min(this.end, length));
  }
  Clone() { this.normalize(); return new TextRangeProvider(this.provider, this.start, this.end); }
  Compare(other) { this.normalize(); other?.normalize(); return other?.provider === this.provider && other.start === this.start && other.end === this.end; }
  CompareEndpoints(endpoint, other, otherEndpoint) {
    if (other?.provider !== this.provider) throw new TypeError('SFAX008: Text ranges belong to different documents');
    this.normalize();
    other.normalize();
    return this[endpointName(endpoint)] - other[endpointName(otherEndpoint)];
  }
  GetText(maxLength = -1) {
    if (!Number.isInteger(maxLength) || maxLength < -1) throw new RangeError('SFAX008: Invalid text length');
    this.normalize();
    return this.provider.text.slice(this.start, maxLength === -1 ? this.end : Math.min(this.end, this.start + maxLength));
  }
  GetEnclosingElement() { return this.provider.peer; }
  GetChildren() { return []; }
  GetBoundingRectangles() {
    this.normalize();
    const bounds = this.provider.peer.tree.host.services?.text?.rangeBounds?.(this.provider.peer.id, this.start, this.end);
    if (!bounds) throw new Error('SFAX009: Text range geometry requires the shaping service');
    return bounds.flatMap(value => [value.x, value.y, value.width, value.height]);
  }
  FindText(text, backward = false, ignoreCase = false) {
    if (typeof text !== 'string' || !text) throw new TypeError('SFAX008: FindText requires nonempty text');
    const source = this.GetText();
    const folded = ignoreCase ? foldText(source) : null;
    const haystack = folded?.text ?? source;
    const needle = ignoreCase ? foldText(text).text : text;
    const offset = backward ? haystack.lastIndexOf(needle) : haystack.indexOf(needle);
    if (offset < 0) return null;
    const start = folded ? folded.starts[offset] : offset;
    const end = folded ? folded.ends[offset + needle.length - 1] : offset + text.length;
    return new TextRangeProvider(this.provider, this.start + start, this.start + end);
  }
  ExpandToEnclosingUnit(unit) {
    this.normalize();
    const boundaries = unitBoundaries(this.provider, unit);
    let index = boundaryIndex(boundaries, this.start);
    if (index === boundaries.length - 1 && index) index--;
    this.start = boundaries[index];
    this.end = boundaries[Math.min(index + 1, boundaries.length - 1)];
  }
  Move(unit, count) {
    if (!Number.isInteger(count)) throw new TypeError('SFAX008: Text movement count must be an integer');
    this.normalize();
    if (!count) return 0;
    const boundaries = unitBoundaries(this.provider, unit);
    const index = boundaryIndex(boundaries, this.start);
    const next = Math.max(0, Math.min(boundaries.length - 1, index + count));
    const nonempty = this.end > this.start;
    this.start = boundaries[next];
    this.end = nonempty ? boundaries[Math.min(next + 1, boundaries.length - 1)] : this.start;
    return next - index;
  }
  MoveEndpointByUnit(endpoint, unit, count) {
    if (!Number.isInteger(count)) throw new TypeError('SFAX008: Text movement count must be an integer');
    this.normalize();
    const name = endpointName(endpoint);
    const boundaries = unitBoundaries(this.provider, unit);
    const index = boundaryIndex(boundaries, this[name]);
    const next = Math.max(0, Math.min(boundaries.length - 1, index + count));
    this[name] = boundaries[next];
    if (this.start > this.end) this[name === 'start' ? 'end' : 'start'] = this[name];
    return next - index;
  }
  MoveEndpointByRange(endpoint, target, targetEndpoint) {
    if (target?.provider !== this.provider) throw new TypeError('SFAX008: Text ranges belong to different documents');
    this.normalize();
    target.normalize();
    const name = endpointName(endpoint);
    this[name] = target[endpointName(targetEndpoint)];
    if (this.start > this.end) this[name === 'start' ? 'end' : 'start'] = this[name];
  }
  Select() {
    this.normalize();
    const peer = this.provider.peer;
    if (!peer.IsEnabled() || this.provider.SupportedTextSelection === SupportedTextSelection.None) {
      throw new Error('SFAX010: Text selection is unavailable');
    }
    return peer.tree.host.invoke(peer.id, 'SelectText', [this.start, this.end - this.start]);
  }
  AddToSelection() { throw new Error('SFAX010: Multiple text selections are not supported'); }
  RemoveFromSelection() { throw new Error('SFAX010: Removing a text selection is not supported'); }
  ScrollIntoView(alignToTop = true) {
    const callback = this.provider.peer.tree.host.services?.text?.scrollRangeIntoView;
    if (!callback) throw new Error('SFAX009: Text scrolling requires the shaping service');
    return callback(this.provider.peer.id, this.start, this.end, !!alignToTop);
  }
}

const endpointName = value => enumValue(TextPatternRangeEndpoint, value, 'text endpoint') === 0 ? 'start' : 'end';

function boundaryIndex(boundaries, offset) {
  let first = 0;
  let last = boundaries.length;
  while (first < last) {
    const middle = (first + last) >>> 1;
    if (boundaries[middle] <= offset) first = middle + 1;
    else last = middle;
  }
  return Math.max(0, first - 1);
}

function unitBoundaries(provider, unit) {
  const value = enumValue(TextUnit, unit, 'text unit');
  const text = provider.text;
  if (text.length > 1024 * 1024) throw new RangeError('SFAX011: Unit navigation limit; use a smaller text range');
  if (value === TextUnit.Document || value === TextUnit.Page) return [0, text.length];
  if (value === TextUnit.Format || value === TextUnit.Line) {
    const boundaries = provider.peer.tree.host.services?.text?.unitBoundaries?.(provider.peer.id, value);
    if (!boundaries) throw new Error('SFAX009: Text formatting/line units require the shaping service');
    return boundaries;
  }
  const result = [0];
  if (value === TextUnit.Paragraph) {
    for (let index = 0; index < text.length; index++) if (text[index] === '\n') result.push(index + 1);
  } else if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: value === TextUnit.Word ? 'word' : 'grapheme' });
    for (const segment of segmenter.segment(text)) if (segment.index > 0) result.push(segment.index);
  } else if (value === TextUnit.Character) {
    let offset = 0;
    for (const character of text) { offset += character.length; result.push(offset); }
  } else throw new Error('SFAX009: Word navigation requires Intl.Segmenter');
  if (result.at(-1) !== text.length) result.push(text.length);
  return result;
}

/** Keep UTF-16 source offsets when Unicode case mapping expands a character. */
function foldText(value) {
  let text = '', offset = 0;
  const starts = [], ends = [];
  for (const character of value) {
    const folded = character.toLocaleLowerCase('en-US');
    for (let index = 0; index < folded.length; index++) { starts.push(offset); ends.push(offset + character.length); }
    text += folded; offset += character.length;
  }
  return { text, starts, ends };
}
