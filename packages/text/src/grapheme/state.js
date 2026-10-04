import { BreakClass as Class, GraphemeProperty as Property, graphemeProperties } from './properties.js';

function control(value) { return value >= Class.CR && value <= Class.Control; }

/** Constant-space UAX #29 extended-grapheme state, including GB9c, GB11 and RI parity. */
export class GraphemeState {
  constructor(state = {}) {
    this.previous = state.previous ?? -1;
    this.regionalParity = state.regionalParity ?? 0;
    this.pictographicExtend = state.pictographicExtend ?? false;
    this.pictographicJoiner = state.pictographicJoiner ?? false;
    this.indic = state.indic ?? 0;
  }
  breaksBefore(code) { return this.breaksBeforeProperties(graphemeProperties(code)); }
  breaksBeforeProperties(properties) {
    const current = properties & 15;
    const previous = this.previous;
    if (previous < 0) return true;
    if (previous === Class.CR && current === Class.LF) return false;
    if (control(previous) || control(current)) return true;
    if (previous === Class.L && (current === Class.L || current === Class.V || current === Class.LV || current === Class.LVT)) return false;
    if ((previous === Class.LV || previous === Class.V) && (current === Class.V || current === Class.T)) return false;
    if ((previous === Class.LVT || previous === Class.T) && current === Class.T) return false;
    if (current === Class.Extend || current === Class.ZWJ || current === Class.SpacingMark || previous === Class.Prepend) return false;
    if (this.indic === 2 && properties & Property.Consonant) return false;
    if (previous === Class.ZWJ && this.pictographicJoiner && properties & Property.Pictographic) return false;
    return !(previous === Class.Regional && current === Class.Regional && this.regionalParity === 1);
  }
  consume(code) {
    const properties = graphemeProperties(code);
    const current = properties & 15;
    const boundary = this.breaksBeforeProperties(properties);
    this.regionalParity = current === Class.Regional ? this.regionalParity ^ 1 : 0;
    this.pictographicJoiner = current === Class.ZWJ && this.pictographicExtend;
    if (properties & Property.Pictographic) this.pictographicExtend = true;
    else if (current !== Class.Extend) this.pictographicExtend = false;
    if (properties & Property.Consonant) this.indic = 1;
    else if (properties & Property.Linker) this.indic = this.indic ? 2 : 0;
    else if (!(properties & Property.IndicExtend)) this.indic = 0;
    this.previous = current;
    return boundary;
  }
}

export function* unicodeGraphemeSegments(text) {
  const state = new GraphemeState();
  let start = 0;
  for (let offset = 0; offset < text.length;) {
    const code = text.codePointAt(offset);
    if (state.consume(code) && offset > start) {
      yield { segment: text.slice(start, offset), index: start, end: offset };
      start = offset;
    }
    offset += code > 0xffff ? 2 : 1;
  }
  if (start < text.length) yield { segment: text.slice(start), index: start, end: text.length };
}
