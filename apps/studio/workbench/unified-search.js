import {fuzzyMatch} from './search-service.js';
import {VirtualTable} from './tools/virtual-table.js';
import {element, input, select, runAction} from './ui.js';

export class UnifiedSearch {
  constructor({registry, options, symbols, documents, recent, context, navigate, execute}) {
    Object.assign(this, {registry, options, symbols, documents, recent, context, navigate, execute});
    this.generation = 0;
  }
  async query(text, {tab = 'all', signal, onBatch = () => {}, goTo = false} = {}) {
    const generation = ++this.generation;
    const prefix = goTo ? /^(?:(f|t|m|recent)(?:\s+|$)|([#:])\s*)(.*)$/u.exec(text) : null;
    const kind = prefix?.[1] ?? prefix?.[2], query = prefix?.[3] ?? text;
    const matches = [];
    const add = values => {
      signal?.throwIfAborted();
      if (generation !== this.generation) return;
      matches.push(...values);
      onBatch([...matches]);
    };
    if (kind === ':') {
      const [line, character = 1] = query.split(':').map(Number);
      if (Number.isInteger(line) && line >= 1 && Number.isInteger(character) && character >= 1) {
        add([{id: 'line:' + query, title: 'Go to line ' + line, kind: 'Line', location: {
          uri: this.context().uri, line: line - 1, character: character - 1
        }}]);
      }
      return matches;
    }
    if (kind === 'recent') {
      add(this.recent.list('file').filter(item => fuzzyMatch(item.uri, query)).map(item => ({id: 'recent:' + item.uri,
        title: item.uri, kind: 'Recent file', location: {uri: item.uri}})));
      return matches;
    }
    if (tab !== 'code' && !goTo) {
      add(this.registry.search(query).map(command => ({id: command.id, title: command.label,
        kind: command.category ?? 'Command', shortcut: command.shortcut, enabled: command.enabled, command: command.id})));
      add(this.options.list(query).map(page => ({id: 'option:' + page.id, title: page.category + ' / ' + page.title,
        kind: 'Options', page: page.id})));
    }
    if (tab !== 'features' && !['t', 'm', '#'].includes(kind)) {
      add(this.documents.list().filter(document => fuzzyMatch(document.uri, query)).slice(0, 2000).map(document => ({
        id: 'file:' + document.uri, title: document.uri, kind: 'File', location: {uri: document.uri, version: document.version}
      })));
    }
    if (tab !== 'features' && kind !== 'f') {
      await this.symbols.query(query, {signal, onBatch: symbols => add(symbols.filter(symbol =>
        !kind || kind === '#' || kind === 't' && ['class', 'interface', 'struct', 'enum', 'record'].includes(symbol.kind) ||
        kind === 'm' && ['method', 'property', 'field', 'event'].includes(symbol.kind)).map(symbol => ({
        id: 'symbol:' + symbol.id, title: symbol.detail ?? symbol.name, kind: symbol.kind, location: symbol
      })))});
    }
    return generation === this.generation ? matches : [];
  }
  activate(item) {
    if (item.enabled === false) throw new Error('Command unavailable in the active context');
    if (item.command) return this.execute(item.command);
    if (item.page) return this.options.open(item.page);
    if (item.location) return this.navigate({...item.location, preview: true});
  }
  open(dialogs, {goTo = false, query = '', initialTab = 'all', onError} = {}) {
    let controller;
    let debounce;
    let tab = initialTab;
    return dialogs.open({title: goTo ? 'Go To All' : 'Search Features and Code', render: (host, dialog) => {
      const document = host.ownerDocument;
      const area = element(document, 'div', {className: 'wb-search-results'});
      const status = element(document, 'p', {role: 'status'});
      const grid = new VirtualTable(area, {label: 'Search results', columns: [
        {id: 'title', title: 'Result', width: 'minmax(240px, 3fr)'}, {id: 'kind', title: 'Kind', width: '120px'},
        {id: 'shortcut', title: 'Shortcut', width: '130px'}
      ], onActivate: runAction(async item => { dialog.close(true); await this.activate(item); }, onError)});
      const search = input(document, 'Search', query, () => schedule(), {placeholder: goTo ? 'f files · t types · m members · # symbols · :line' : 'Search'});
      const run = async () => {
        controller?.abort();
        controller = new AbortController();
        try {
          await this.query(search.value, {goTo, tab, signal: controller.signal, onBatch: rows => {
            grid.setRows(rows); status.textContent = rows.length + ' results';
          }});
        } catch (error) { if (error.name !== 'AbortError') status.textContent = error.message; }
      };
      const schedule = () => { clearTimeout(debounce); debounce = setTimeout(run, 120); };
      search.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); grid.root.focus(); }
        if (event.key === 'Enter' && grid.rows[0]) runAction(async () => {
          dialog.close(true); await this.activate(grid.rows[0]);
        }, onError)();
      });
      host.append(search);
      if (!goTo) host.append(select(document, 'Search category', [{value: 'all', label: 'All'}, {value: 'code', label: 'Code'},
        {value: 'features', label: 'Features'}], tab, value => { tab = value; run(); }));
      host.append(area, status);
      run();
      return () => { clearTimeout(debounce); controller?.abort(); grid.dispose(); };
    }, actions: []});
  }
}
