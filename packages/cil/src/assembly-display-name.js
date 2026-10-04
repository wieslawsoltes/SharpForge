/** Split assembly display identity components while respecting the CLR quoting and backslash escape rules. */
export function displayNamePieces(displayName) {
  const pieces = [];
  let current = '';
  let quote = null;
  for (let index = 0; index < displayName.length; index++) {
    const character = displayName[index];
    if (character === '\\' && index + 1 < displayName.length) {
      current += displayName[++index];
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ',') {
      pieces.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  if (quote) return null;
  pieces.push(current);
  return pieces;
}
