import {cleanDesignData} from './document-data.js';

function fingerprint(value) {
  cleanDesignData(value, 0, true);
  return JSON.stringify(value);
}

function header(value) {
  const metadata = {...value};
  delete metadata.nodes;
  return fingerprint(metadata);
}

/** Mutable legacy document aliases require an O(n) consistency guard; cached fingerprints are bounded to 4M UTF-16 units. */
export class DesignerPropertyBaseline {
  constructor(value, maxCharacters = 4_000_000) {
    this.maxCharacters = maxCharacters;
    this.reset(value);
  }

  reset(value) {
    this.nodes = null;
    this.header = null;
    this.characters = 0;
    try {
      const metadata = header(value);
      const nodes = [];
      let characters = metadata.length;
      for (const node of value.nodes) {
        const text = fingerprint(node);
        characters += text.length;
        if (characters > this.maxCharacters) return;
        nodes.push(text);
      }
      this.nodes = nodes;
      this.header = metadata;
      this.characters = characters;
    } catch {
      // A full validator owns unusual custom document shapes; no incremental proof is retained for them.
    }
  }

  matches(value, nodesById) {
    if (!this.nodes || value.nodes?.length !== this.nodes.length) return false;
    try {
      if (header(value) !== this.header) return false;
      for (let index = 0; index < this.nodes.length; index++) {
        const node = value.nodes[index];
        if (nodesById.get(node?.id) !== node || fingerprint(node) !== this.nodes[index]) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  advance(updates) {
    if (!this.nodes) return;
    for (const {index, node} of updates) {
      const text = fingerprint(node);
      this.characters += text.length - this.nodes[index].length;
      this.nodes[index] = text;
    }
    if (this.characters > this.maxCharacters) {
      this.nodes = null;
      this.header = null;
      this.characters = 0;
    }
  }
}
