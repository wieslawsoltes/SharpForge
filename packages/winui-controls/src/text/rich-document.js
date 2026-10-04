import { ControlEvents, ControlError } from '../policy/events.js';

const allowedFormats = new Set(['bold', 'italic', 'underline', 'size', 'foreground', 'alignment']);
const escapedRtf = value => value.replace(/[\\{}]/g, '\\$&').replace(/\n/g, '\\par\n').replace(/[^\x20-\x7e\n]/g,
  character => `\\u${character.charCodeAt(0) > 32767 ? character.charCodeAt(0) - 65536 : character.charCodeAt(0)}?`);

/** A bounded inline document; RTF accepts formatting/text destinations and rejects embedded objects. */
export class RichTextDocument extends ControlEvents {
  constructor(text = '') {
    super();
    this.runs = [{ text: String(text), format: {} }];
    this.selection = { start: 0, length: 0 };
  }

  get length() { return this.runs.reduce((length, run) => length + run.text.length, 0); }
  get text() { return this.runs.map(run => run.text).join(''); }
  snapshot() { return { version: 1, runs: this.runs.map(run => ({ text: run.text, format: { ...run.format } })), selection: { ...this.selection } }; }
  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.runs)) throw new ControlError('SFUI1622', 'Invalid rich-document snapshot');
    this.runs = snapshot.runs.map(run => ({ text: run.text, format: { ...run.format } }));
    this.selection = { ...snapshot.selection };
  }

  setText(text, format = 'text') {
    if (typeof text !== 'string' || text.length > 16 * 1024 * 1024) throw new ControlError('SFUI1622', 'Invalid document text');
    this.runs = format === 'rtf' ? parseRtf(text) : [{ text, format: {} }];
    this.selection = { start: 0, length: 0 };
    this.emit('TextChanged', {});
  }

  getText(format = 'text') {
    if (format !== 'rtf') return this.text;
    const colors = [...new Set(this.runs.map(run => run.format.foreground).filter(Boolean))];
    const table = colors.map(color => {
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw new ControlError('SFUI1623', 'RTF foreground must be an RGB color');
      return `\\red${parseInt(color.slice(1, 3), 16)}\\green${parseInt(color.slice(3, 5), 16)}\\blue${parseInt(color.slice(5, 7), 16)};`;
    }).join('');
    const content = this.runs.map(run => {
      const value = run.format;
      const prefix = [value.bold ? '\\b' : '', value.italic ? '\\i' : '', value.underline ? '\\ul' : '',
        value.size ? `\\fs${Math.round(value.size * 2)}` : '', value.foreground ? `\\cf${colors.indexOf(value.foreground) + 1}` : '',
        value.alignment ? '\\q' + ({ left: 'l', center: 'c', right: 'r', justify: 'j' }[value.alignment] ?? 'l') : ''].join('');
      return `{${prefix ? prefix + ' ' : ''}${escapedRtf(run.text)}}`;
    }).join('');
    return `{\\rtf1\\ansi\\uc1{\\colortbl;${table}}${content}}`;
  }

  select(start, length = 0) {
    if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > this.length) {
      throw new ControlError('SFUI1624', 'Document selection is outside the text');
    }
    this.selection = { start, length };
    this.emit('SelectionChanged', { ...this.selection });
  }

  replaceSelection(text) {
    if (typeof text !== 'string' || this.length - this.selection.length + text.length > 16 * 1024 * 1024) {
      throw new ControlError('SFUI1622', 'Invalid document insertion');
    }
    const { start, length } = this.selection, end = start + length;
    const result = []; let offset = 0, inserted = false;
    for (const run of this.runs) {
      const next = offset + run.text.length;
      if (next < start || offset > end) result.push(run);
      else {
        if (start > offset) result.push({ text: run.text.slice(0, start - offset), format: { ...run.format } });
        if (!inserted) { result.push({ text, format: { ...run.format } }); inserted = true; }
        if (end < next) result.push({ text: run.text.slice(end - offset), format: { ...run.format } });
      }
      offset = next;
    }
    if (!inserted) result.push({ text, format: {} });
    this.runs = result.filter(run => run.text.length);
    this.selection = { start: start + text.length, length: 0 };
    this.emit('TextChanged', {}); this.emit('SelectionChanged', { ...this.selection });
  }

  formatSelection(format) {
    for (const [key, value] of Object.entries(format)) {
      if (!allowedFormats.has(key)) throw new ControlError('SFUI1625', 'Unsupported rich-text formatting property', { property: key });
      if (key === 'size' && (!Number.isFinite(value) || value < 1 || value > 1000)) {
        throw new ControlError('SFUI1626', 'Font size is outside its supported range');
      }
    }
    const { start, length } = this.selection;
    const result = [];
    let offset = 0;
    for (const run of this.runs) {
      const first = Math.max(0, start - offset);
      const last = Math.min(run.text.length, start + length - offset);
      if (last <= first) result.push(run);
      else {
        if (first) result.push({ text: run.text.slice(0, first), format: { ...run.format } });
        result.push({ text: run.text.slice(first, last), format: { ...run.format, ...format } });
        if (last < run.text.length) result.push({ text: run.text.slice(last), format: { ...run.format } });
      }
      offset += run.text.length;
    }
    this.runs = result;
    this.emit('FormatChanged', { ...format });
  }

  /** Only DOM-created text/format nodes are read; links, handlers, images and style URLs are discarded. */
  readDom(element) {
    const runs = [];
    const pending = [...element.childNodes].reverse().map(node => ({ node, format: {} }));
    let visited = 0;
    while (pending.length) {
      const { node, format } = pending.pop();
      if (++visited > 100_000) throw new ControlError('SFUI1627', 'Rich-text DOM exceeds the node limit');
      if (node.nodeType === 3) { runs.push({ text: node.textContent, format }); continue; }
      if (node.nodeType !== 1 || ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG'].includes(node.tagName)) continue;
      if (node.tagName === 'BR') { runs.push({ text: '\n', format }); continue; }
      if (['DIV', 'P'].includes(node.tagName) && runs.length && !runs.at(-1).text.endsWith('\n')) {
        runs.push({ text: '\n', format });
      }
      const next = { ...format };
      if (['B', 'STRONG'].includes(node.tagName)) next.bold = true;
      if (['I', 'EM'].includes(node.tagName)) next.italic = true;
      if (node.tagName === 'U') next.underline = true;
      if (node.style?.fontWeight === 'bold' || Number(node.style?.fontWeight) >= 600) next.bold = true;
      if (node.style?.fontStyle === 'italic') next.italic = true;
      if (node.style?.textDecoration?.includes('underline')) next.underline = true;
      const size = Number.parseFloat(node.style?.fontSize);
      if (size > 0 && size <= 1000) next.size = size;
      for (const child of [...node.childNodes].reverse()) pending.push({ node: child, format: next });
    }
    this.runs = runs.length ? runs : [{ text: '', format: {} }];
    this.emit('TextChanged', {});
  }
}

function parseRtf(text) {
  if (!text.startsWith('{\\rtf')) throw new ControlError('SFUI1628', 'Invalid RTF document');
  const colors = [];
  const colorTable = text.match(/\{\\colortbl([^{}]*)\}/)?.[1] ?? '';
  for (const match of colorTable.matchAll(/\\red(\d+)\\green(\d+)\\blue(\d+);/g)) {
    colors.push('#' + match.slice(1).map(value => Math.max(0, Math.min(255, +value)).toString(16).padStart(2, '0')).join(''));
  }
  const stack = [];
  const runs = [];
  let state = { format: {}, skip: false, fallback: 1 };
  let offset = 0;
  let lastFormat = null;
  let fallbackRemaining = 0;
  const append = (value, unicode = false) => {
    if (!unicode && fallbackRemaining > 0) { fallbackRemaining--; return; }
    if (state.skip || !value) return;
    if (lastFormat === state.format && runs.length) runs.at(-1).text += value;
    else runs.push({ text: value, format: { ...state.format } });
    lastFormat = state.format;
  };
  while (offset < text.length) {
    const character = text[offset++];
    if (character === '{') {
      if (stack.length >= 128) throw new ControlError('SFUI1628', 'RTF nesting limit exceeded');
      stack.push(state);
      state = { ...state, format: { ...state.format } };
    } else if (character === '}') {
      if (!stack.length) throw new ControlError('SFUI1628', 'Unbalanced RTF groups');
      state = stack.pop();
    } else if (character === '\\') {
      lastFormat = null;
      const match = /^([a-z]+)(-?\d+)? ?|^([^a-z])/i.exec(text.slice(offset));
      if (!match) throw new ControlError('SFUI1628', 'Invalid RTF escape');
      offset += match[0].length;
      const name = match[1];
      const number = match[2] === undefined ? 1 : Number(match[2]);
      if (!name) {
        if (match[3] === '*') state.skip = true;
        else if ('\\{}'.includes(match[3])) append(match[3]);
        else if (match[3] === "'") {
          const encoded = text.slice(offset, offset + 2);
          if (!/^[0-9a-f]{2}$/i.test(encoded)) throw new ControlError('SFUI1628', 'Invalid RTF byte escape');
          append(new TextDecoder('windows-1252').decode(Uint8Array.of(Number.parseInt(encoded, 16))));
          offset += 2;
        } else if (match[3] === '~') append('\u00a0');
        else if (match[3] === '_') append('\u2011');
        else if (match[3] === '-') append('\u00ad');
        continue;
      }
      if (['object', 'pict', 'field', 'htmltag', 'bin'].includes(name)) throw new ControlError('SFUI1629', 'Embedded RTF content is unsupported');
      if (['fonttbl', 'colortbl', 'stylesheet', 'info'].includes(name)) state.skip = true;
      else if (name === 'b') state.format.bold = number !== 0;
      else if (name === 'i') state.format.italic = number !== 0;
      else if (name === 'ul' || name === 'ulnone') state.format.underline = name === 'ul' && number !== 0;
      else if (name === 'fs') {
        if (number < 2 || number > 2000) throw new ControlError('SFUI1626', 'RTF font size is outside its supported range');
        state.format.size = number / 2;
      } else if (name === 'cf') {
        if (number < 0 || number > colors.length) throw new ControlError('SFUI1628', 'RTF color index is outside the color table');
        state.format.foreground = colors[number - 1];
      }
      else if (['ql', 'qc', 'qr', 'qj'].includes(name)) state.format.alignment = { ql: 'left', qc: 'center', qr: 'right', qj: 'justify' }[name];
      else if (name === 'plain') state.format = {};
      else if (name === 'par' || name === 'line') append('\n');
      else if (name === 'tab') append('\t');
      else if (name === 'uc') {
        if (number < 0 || number > 8) throw new ControlError('SFUI1629', 'Unsupported RTF Unicode fallback length');
        state.fallback = number;
      } else if (name === 'u') {
        if (number < -32768 || number > 65535) throw new ControlError('SFUI1628', 'Invalid RTF Unicode value');
        append(String.fromCharCode(number & 65535), true);
        fallbackRemaining = state.fallback;
      } else if (name === 'ansicpg' && number !== 1252) {
        throw new ControlError('SFUI1629', 'This RTF profile supports Unicode and Windows-1252 text');
      } else if (!state.skip && !['rtf', 'ansi', 'deff', 'deflang', 'f', 'pard', 'viewkind', 'lang'].includes(name)) {
        throw new ControlError('SFUI1629', 'Unsupported RTF control word', { control: name });
      }
    } else if (character !== '\r' && character !== '\n') append(character);
  }
  if (stack.length) throw new ControlError('SFUI1628', 'Unbalanced RTF groups');
  return runs;
}
