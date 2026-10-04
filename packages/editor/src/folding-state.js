/** Per-document folding persistence, scoped to a caller-owned session/storage adapter. */
export class FoldingStateStore {
  constructor({storage = null, key = 'sharpforge.folds', limit = 200} = {}) {
    this.storage = storage;
    this.key = key;
    this.limit = limit;
    this.documents = new Map();
    const saved = storage?.getItem(key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) this.documents = new Map(parsed.slice(-limit));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
  }

  save(uri, folding) {
    this.documents.delete(uri);
    this.documents.set(uri, folding.regions.filter(region => region.collapsed).map(({startLine, endLine}) => ({startLine, endLine})));
    if (this.documents.size > this.limit) this.documents.delete(this.documents.keys().next().value);
    this.storage?.setItem(this.key, JSON.stringify([...this.documents]));
  }

  restore(uri, folding) {
    const saved = this.documents.get(uri) ?? [];
    const keys = new Set(saved.map(region => `${region.startLine}:${region.endLine}`));
    for (const region of folding.regions) region.collapsed = keys.has(`${region.startLine}:${region.endLine}`);
    folding.changed();
  }
}
