/** Visual markers never replace source text or participate in copy and selection. */
export function whitespaceMarkers(text, layout, {eol = '', enabled = false} = {}) {
  if (!enabled) return [];
  const result = [];
  for (let index = 0; index < layout.offsets.length - 1; index++) {
    const character = text[layout.offsets[index]];
    if (character !== ' ' && character !== '\t') continue;
    result.push({offset: layout.offsets[index], x: layout.pixels[index], glyph: character === '\t' ? '→' : '·', kind: character === '\t' ? 'tab' : 'space'});
  }
  if (eol) result.push({offset: text.length, x: layout.width, glyph: eol === '\r\n' ? '↵' : eol === '\r' ? '←' : '↓', kind: 'eol'});
  return result;
}
