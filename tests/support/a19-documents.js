/** Deterministic test adapter exercises buffer/dirty state without pretending to be a browser editor. */
export class TestDocuments {
  constructor(uris = []) {
    this.records = new Map(uris.map(uri => [uri, { uri, text: uri, version: 1, dirty: false }]));
    this.listeners = new Set();
    this.tabs = [];
    this.states = new Map();
    this.saved = [];
    this.closed = [];
  }
  get(uri) { return this.records.get(uri); }
  list() { return [...this.records.values()]; }
  open(uri) {
    const record = this.get(uri);
    if (!record) throw new Error(`Missing ${uri}`);
    if (!this.tabs.includes(uri)) this.tabs.push(uri);
    return record;
  }
  activate(uri) { this.active = uri; }
  setTabs(uris) { this.tabs = [...uris]; }
  save(uri) {
    if (this.failSave === uri) return false;
    this.get(uri).dirty = false;
    this.saved.push(uri);
    this.notify('saved', uri);
    return true;
  }
  close(uri, { discard = false } = {}) {
    if (this.get(uri).dirty && !discard) throw new Error('Dirty document');
    if (this.failClose === uri) throw new Error('Close failed');
    this.tabs = this.tabs.filter(item => item !== uri);
    this.closed.push(uri);
    return true;
  }
  edit(uri, text = 'edited') {
    Object.assign(this.get(uri), { text, dirty: true, version: this.get(uri).version + 1 });
    this.notify('changed', uri);
  }
  getViewState(uri, viewId = 'primary') { return this.states.get(`${uri}:${viewId}`) ?? { start: 0, end: 0, scrollTop: 0, scrollLeft: 0 }; }
  restoreViewState(uri, state, viewId = 'primary') { this.states.set(`${uri}:${viewId}`, { ...state }); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify(type, uri) { for (const listener of this.listeners) listener({ type, uri, record: this.get(uri) }); }
}
