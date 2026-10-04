import {DrawingError} from '../drawing/commands.js';

/** Nominal cmap lookup is used only for fallback coverage; HarfBuzz supplies shaped glyph IDs. */
export class FontCmap {
  constructor(table) {
    const count = table.u16(2);
    if (count > 256) throw new DrawingError('SFRENDER140', 'Font cmap subtable budget exceeded');
    table.range(4, count * 8);
    let choice = null;
    for (let index = 0; index < count; index++) {
      const at = 4 + index * 8;
      const platform = table.u16(at);
      const encoding = table.u16(at + 2);
      if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
      const candidate = table.sub(table.u32(at + 4));
      const format = candidate.u16(0);
      const score = format === 12 ? 3 : format === 4 ? 2 : format === 13 ? 1 : 0;
      if (score && (!choice || score > choice.score)) choice = {candidate, format, score};
    }
    if (!choice) throw new DrawingError('SFRENDER140', 'Font has no supported Unicode cmap (4, 12, or 13)');
    this.format = choice.format;
    this.table = choice.candidate.sub(0, this.format === 4 ? choice.candidate.u16(2) : choice.candidate.u32(4));
    this.count = this.format === 4 ? this.table.u16(6) / 2 : this.table.u32(12);
    if (!Number.isSafeInteger(this.count) || this.count > 1000000) throw new DrawingError('SFRENDER140', 'Invalid cmap group count');
    this.validate();
  }
  validate() {
    const table = this.table;
    table.range(this.format === 4 ? 14 : 16, this.count * (this.format === 4 ? 8 : 12) + (this.format === 4 ? 2 : 0));
    let previous = -1;
    for (let index = 0; index < this.count; index++) {
      const first = this.format === 4 ? table.u16(16 + this.count * 2 + index * 2) : table.u32(16 + index * 12);
      const last = this.format === 4 ? table.u16(14 + index * 2) : table.u32(20 + index * 12);
      if (first > last || first <= previous || last > 0x10ffff) throw new DrawingError('SFRENDER140', 'Overlapping or unsorted cmap groups');
      previous = last;
    }
  }
  glyph(codePoint) {
    const table = this.table;
    let low = 0;
    let high = this.count;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const last = this.format === 4 ? table.u16(14 + middle * 2) : table.u32(20 + middle * 12);
      if (last < codePoint) low = middle + 1;
      else high = middle;
    }
    if (low === this.count) return 0;
    if (this.format !== 4) {
      const at = 16 + low * 12;
      return codePoint < table.u32(at) ? 0 : table.u32(at + 8) + (this.format === 12 ? codePoint - table.u32(at) : 0);
    }
    const first = table.u16(16 + this.count * 2 + low * 2);
    if (codePoint < first || codePoint > 0xffff) return 0;
    const delta = table.i16(16 + this.count * 4 + low * 2);
    const location = 16 + this.count * 6 + low * 2;
    const offset = table.u16(location);
    if (!offset) return (codePoint + delta) & 0xffff;
    const glyph = table.u16(location + offset + (codePoint - first) * 2);
    return glyph ? (glyph + delta) & 0xffff : 0;
  }
}
