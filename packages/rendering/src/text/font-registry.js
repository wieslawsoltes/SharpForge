import {DrawingError, finite} from '../drawing/commands.js';
import {OpenTypeFont} from './opentype.js';
import {FontCmap} from './cmap.js';
import {harfBuzzMetrics} from './harfbuzz-metrics.js';

function fontFamilyNames(value) {
  return String(value?.Source ?? value ?? '').split(',').map(name => name.trim().replace(/^['"]|['"]$/g, '').toLowerCase()).filter(Boolean);
}

function descriptorName(value, label) {
  if (typeof value !== 'string' || !value.length || value.length > 512) throw new DrawingError('SFRENDER140', `Invalid font ${label}`);
  return value;
}

/** App-owned immutable faces and bounded variable-font instances; no VM or Wasm state is shared globally. */
export class PortableFontRegistry {
  constructor(hb, descriptors, {module, maxFonts = 128, maxFontBytes = 134217728, maxInstances = 512} = {}) {
    if (!Number.isSafeInteger(maxFonts) || maxFonts < 1 || maxFonts > 128 || !Number.isSafeInteger(maxFontBytes)
      || maxFontBytes < 12 || maxFontBytes > 134217728 || !Number.isSafeInteger(maxInstances) || maxInstances < 1 || maxInstances > 4096) {
      throw new DrawingError('SFRENDER140', 'Invalid portable font collection budget');
    }
    if (!Array.isArray(descriptors) || !descriptors.length || descriptors.length > maxFonts) {
      throw new DrawingError('SFRENDER140', 'A bounded list of font faces is required');
    }
    this.hb = hb;
    this.module = module;
    this.faces = [];
    this.instances = new Map();
    this.byId = new Map();
    this.rankCache = new Map();
    this.maxInstances = maxInstances;
    this.bytes = 0;
    try {
      for (const descriptor of descriptors) {
        const font = new OpenTypeFont(descriptor.bytes, {index: descriptor.index ?? 0, maxBytes: maxFontBytes});
        this.bytes += font.bytes.byteLength;
        if (this.bytes > maxFontBytes) throw new DrawingError('SFRENDER140', 'Font collection byte budget exceeded');
        const id = descriptorName(descriptor.id, 'id');
        if (this.faces.some(face => face.id === id)) throw new DrawingError('SFRENDER140', 'Duplicate font face id');
        const family = descriptorName(descriptor.family, 'family');
        const weight = descriptor.weight ?? 400;
        const weights = Array.isArray(weight) ? weight : [weight];
        if (weights.length > 2 || !weights.length || !weights.every(value => Number.isFinite(value) && value >= 1 && value <= 1000)
          || weights.length === 2 && weights[0] > weights[1] || !['normal', 'italic', 'oblique'].includes(descriptor.style ?? 'normal')) {
          throw new DrawingError('SFRENDER140', 'Invalid font weight or style descriptor');
        }
        if (descriptor.aliases != null && (!Array.isArray(descriptor.aliases) || descriptor.aliases.length > 64)) {
          throw new DrawingError('SFRENDER140', 'Invalid font alias collection');
        }
        const record = {id, family, aliases: [family, ...(descriptor.aliases ?? [])].map(name => descriptorName(name, 'alias').toLowerCase()),
          weight, style: descriptor.style ?? 'normal', color: descriptor.color ?? (font.tables.has('CBDT') || font.tables.has('COLR')),
          version: descriptorName(descriptor.version ?? id, 'version'), data: font, cmap: new FontCmap(font.required('cmap'))};
        record.blob = hb.createBlob(font.bytes.buffer);
        try { record.face = hb.createFace(record.blob, font.index); }
        catch (error) { record.blob.destroy(); throw error; }
        this.faces.push(record);
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  candidates(style, cluster) {
    const families = fontFamilyNames(style.fontFamily);
    const weight = finite(style.fontWeight?.Weight ?? style.fontWeight ?? 400, 'font weight', 1, 1000);
    const emoji = cluster.emoji && !cluster.characters.some(character => character.codePoint === 0xfe0e);
    const key = JSON.stringify([families, weight, style.fontStyle, emoji]);
    const cached = this.rankCache.get(key);
    if (cached) return cached;
    const ordered = this.faces.map((face, index) => {
      const family = families.findIndex(name => face.aliases.includes(name));
      const variable = face.data.axes.find(axis => axis.tag === 'wght');
      const distance = variable ? weight < variable.minimum ? variable.minimum - weight : Math.max(0, weight - variable.maximum)
        : Math.abs(weight - Number(Array.isArray(face.weight) ? face.weight[0] : face.weight));
      return {face, score: (emoji && face.color ? -100000 : 0) + (family < 0 ? 10000 : family * 100)
        + (face.style === (style.fontStyle ?? 'normal') ? 0 : 1000) + distance + index / this.faces.length};
    }).sort((a, b) => a.score - b.score).map(entry => entry.face);
    if (this.rankCache.size >= 512) this.rankCache.delete(this.rankCache.keys().next().value);
    this.rankCache.set(key, ordered);
    return ordered;
  }
  select(style, cluster) {
    if (this.closed) throw new DrawingError('SFRENDER081', 'Font registry is disposed');
    for (const face of this.candidates(style, cluster)) {
      if (cluster.characters.every(character => character.ignorable || ['Control', 'CR', 'LF'].includes(character.grapheme)
        || face.cmap.glyph(character.codePoint))) return this.instance(face, style);
    }
    const points = cluster.characters.map(character => `U+${character.codePoint.toString(16).toUpperCase()}`).join(' ');
    throw new DrawingError('SFRENDER141', `No loaded font covers the complete grapheme ${points}`, cluster.start);
  }
  instance(face, style) {
    const variations = {};
    for (const axis of face.data.axes) {
      const requested = style.variations?.[axis.tag] ?? (axis.tag === 'wght' ? style.fontWeight?.Weight ?? style.fontWeight : null)
        ?? (axis.tag === 'opsz' ? style.fontSize : null) ?? axis.default;
      variations[axis.tag] = Math.max(axis.minimum, Math.min(axis.maximum, finite(requested, 'font variation')));
    }
    const id = `${face.id}@${face.version}:${JSON.stringify(variations)}`;
    if (id.length > 512) throw new DrawingError('SFRENDER142', 'Font face identity and variations exceed the glyph key budget');
    let instance = this.instances.get(id);
    if (instance) return instance;
    if (this.instances.size >= this.maxInstances) throw new DrawingError('SFRENDER142', 'Font instance budget exceeded');
    const font = this.hb.createFont(face.face);
    try {
      font.setScale(face.data.unitsPerEm, face.data.unitsPerEm);
      if (face.data.axes.length) font.setVariations(variations);
      instance = {id, face, font, unitsPerEm: face.data.unitsPerEm, metrics: harfBuzzMetrics(this.module, font), variations};
    } catch (error) { font.destroy(); throw error; }
    this.instances.set(id, instance);
    this.byId.set(id, instance);
    return instance;
  }
  get(id) {
    if (this.closed) throw new DrawingError('SFRENDER081', 'Font registry is disposed');
    const instance = this.byId.get(id);
    if (!instance) throw new DrawingError('SFRENDER142', 'Glyph refers to an unavailable font instance');
    return instance;
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const instance of this.instances.values()) instance.font.destroy();
    for (const face of this.faces) { face.face.destroy(); face.blob.destroy(); }
    this.instances.clear();
    this.module = null;
    this.byId.clear();
    this.rankCache.clear();
    this.faces.length = 0;
    this.bytes = 0;
    this.hb = null;
  }
}
