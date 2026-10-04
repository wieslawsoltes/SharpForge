const boundaries = new Set(['<', '>', '[', ']', ',', '&', '*', '?', ' ', '\t', '\r', '\n']);

/** A per-runtime trie recognizes registered identities as opaque tokens inside type expressions. */
export class RegisteredTypeNames {
  constructor() {
    this.names = new Set();
    this.root = new Map();
  }

  add(name) {
    this.names.add(name);
    let node = this.root;
    for (const character of name) {
      if (!node.has(character)) node.set(character, new Map());
      node = node.get(character);
    }
    node.set(null, true);
  }

  has(name) { return this.names.has(name); }

  match(text, offset) {
    let node = this.root;
    let end = -1;
    for (let index = offset; index < text.length;) {
      const character = String.fromCodePoint(text.codePointAt(index));
      node = node.get(character);
      if (!node) break;
      index += character.length;
      if (node.has(null) && (index === text.length || boundaries.has(text[index]))) end = index;
    }
    return end;
  }
}
