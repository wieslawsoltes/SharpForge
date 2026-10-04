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

  prepare(updates) {
    if (!this.nodes) return null;
    const entries = [];
    let characters = this.characters;
    for (const {index, node} of updates) {
      const text = fingerprint(node);
      characters += text.length - this.nodes[index].length;
      entries.push({index, text});
    }
    return characters > this.maxCharacters ? null : {entries, characters};
  }

  /** Publication consumes already validated text; it cannot discover malformed model data after a commit starts. */
  commit(prepared) {
    if (!prepared) {
      this.nodes = null;
      this.header = null;
      this.characters = 0;
      return;
    }
    for (const {index, text} of prepared.entries) this.nodes[index] = text;
    this.characters = prepared.characters;
  }
}
