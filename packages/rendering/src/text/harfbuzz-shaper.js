import {DrawingError, finite} from '../drawing/commands.js';

/** Normalize explicit OpenType features; malformed or unsupported feature syntax never disappears silently. */
export function fontFeatures(features, letterSpacing = 0) {
  let result = '';
  if (features != null) {
    if (typeof features !== 'string' && (typeof features !== 'object' || Array.isArray(features))) {
      throw new DrawingError('SFRENDER143', 'OpenType features require a string or tag object');
    }
    result = typeof features === 'string' ? features : Object.entries(features).map(([tag, value]) => `${tag}=${Number(value)}`).join(',');
    if (result.length > 4096 || result.trim() && result.split(',').some(value => !/^[A-Za-z0-9]{4}(?:=(?:on|off|[0-9]{1,9}))?$/.test(value.trim()))) {
      throw new DrawingError('SFRENDER143', 'OpenType features require comma-separated four-character tags and optional integer values');
    }
    result = result.replace(/\s/g, '');
  }
  return letterSpacing && !/(?:^|,)liga(?:=|,|$)/.test(result) ? `liga=0,clig=0${result ? ',' + result : ''}` : result;
}

/** Reuse one HarfBuzz buffer and one owned UTF-16 input allocation across all items in a layout.
 * Line-local context preserves joining while avoiding a full input copy for every style span.
 */
export class HarfBuzzShaper {
  constructor({hb, module, maxGlyphs = 200000, maxWorkGlyphs = 8000000}) {
    this.hb = hb;
    this.module = module;
    this.buffer = hb.createBuffer();
    this.maxGlyphs = maxGlyphs;
    this.maxWorkGlyphs = maxWorkGlyphs;
    this.input = 0;
    this.work = 0;
  }
  begin(text) {
    if (this.closed || this.input) throw new DrawingError('SFRENDER144', 'HarfBuzz layout lifetime is invalid');
    this.input = this.module.wasmExports.malloc(Math.max(2, text.length * 2));
    if (!this.input) throw new DrawingError('SFRENDER144', 'HarfBuzz input allocation failed');
    const words = new Uint16Array(this.module.wasmMemory.buffer, this.input, text.length);
    for (let index = 0; index < text.length; index++) words[index] = text.charCodeAt(index);
    this.length = text.length;
    this.work = 0;
  }
  shape(item, {start, end, signal}) {
    signal?.throwIfAborted();
    const buffer = this.buffer;
    buffer.reset();
    this.module.wasmExports.hb_buffer_add_utf16(buffer.ptr, this.input + start * 2, end - start, item.start - start, item.end - item.start);
    buffer.setDirection(item.rtl ? 'rtl' : 'ltr');
    buffer.setScript(item.script);
    if (item.style.language) buffer.setLanguage(item.style.language);
    buffer.setClusterLevel(0);
    buffer.setFlags([...(item.start === start ? ['BOT'] : []), ...(item.end === end ? ['EOT'] : [])]);
    buffer.guessSegmentProperties();
    this.hb.shape(item.font.font, buffer, item.features);
    const count = buffer.getLength();
    this.work += count;
    if (count > this.maxGlyphs || this.work > this.maxWorkGlyphs) throw new DrawingError('SFRENDER082', 'HarfBuzz glyph work budget exceeded');
    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();
    const scale = item.style.fontSize / item.font.unitsPerEm;
    const glyphs = [];
    let advance = 0;
    for (let index = 0; index < count; index++) {
      const info = infos[index];
      const position = positions[index];
      if (!position || info.codepoint >= item.font.face.data.glyphCount || info.cluster + start < item.start
        || info.cluster + start >= item.end) throw new DrawingError('SFRENDER144', 'HarfBuzz returned invalid glyph data');
      const xAdvance = finite(position.x_advance * scale, 'glyph advance');
      const yAdvance = finite(position.y_advance * scale, 'glyph advance');
      const xOffset = finite(position.x_offset * scale, 'glyph offset');
      const yOffset = finite(position.y_offset * scale, 'glyph offset');
      glyphs.push({glyphId: info.codepoint, fontId: item.font.id, fontSize: item.style.fontSize,
        cluster: info.cluster + start, x: advance + xOffset, y: -yOffset,
        xAdvance, yAdvance, xOffset, yOffset, advanceStart: advance});
      advance += xAdvance;
      if (infos[index + 1]?.cluster !== info.cluster) advance += item.style.letterSpacing;
    }
    if (glyphs.length) advance -= item.style.letterSpacing;
    return {...item, glyphs, width: Math.max(0, advance), scale,
      ascent: Math.max(0, item.font.metrics.ascender * scale), descent: Math.max(0, -item.font.metrics.descender * scale),
      lineGap: Math.max(0, item.font.metrics.lineGap * scale)};
  }
  end() {
    if (this.input) this.module.wasmExports.free(this.input);
    this.input = 0;
    this.length = 0;
  }
  dispose() {
    if (this.closed) return;
    this.end();
    this.buffer.destroy();
    this.closed = true;
    this.buffer = null;
    this.module = null;
    this.hb = null;
  }
}
