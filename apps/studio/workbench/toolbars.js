import {WorkbenchEvents} from './events.js';
import {button, element, runAction} from './ui.js';

export const defaultToolbars = Object.freeze([
  {id: 'standard', title: 'Standard', visible: true, commands: ['newProject', 'open', 'save', 'undo', 'redo', 'build', 'debug', 'stop']},
  {id: 'debug', title: 'Debug', visible: true, commands: ['pause', 'next', 'stepIn', 'stepOut', 'toggleBreakpoint']},
  {id: 'debug-location', title: 'Debug Location', visible: true, commands: ['threads', 'stack', 'showNext']},
  {id: 'layout', title: 'Layout', visible: false, commands: ['window.saveLayout', 'window.manageLayouts', 'window.fullscreen']},
  {id: 'text-editor', title: 'Text Editor', visible: false, commands: ['find', 'replace', 'format', 'definition', 'references']}
]);

export class Toolbars extends WorkbenchEvents {
  constructor({registry, settings, execute, onError}) {
    super();
    this.registry = registry;
    this.settings = settings;
    this.execute = execute;
    this.onError = onError;
    this.rows = structuredClone(settings.get('toolbars', 'rows').length ? settings.get('toolbars', 'rows') : defaultToolbars);
  }
  setRows(rows) {
    if (!Array.isArray(rows) || rows.length > 32) throw new TypeError('Invalid toolbar rows');
    const ids = new Set();
    for (const row of rows) {
      if (!row.id || ids.has(row.id) || !Array.isArray(row.commands) || row.commands.length > 100) throw new TypeError('Invalid toolbar');
      for (const id of row.commands) if (!this.registry.describe(id)) throw new Error('Unknown toolbar command ' + id);
      ids.add(row.id);
    }
    this.settings.apply({toolbars: {rows}});
    this.rows = structuredClone(rows);
    this.emit({type: 'changed'});
  }
  toggle(id) { this.setRows(this.rows.map(row => row.id === id ? {...row, visible: !row.visible} : row)); }
  reset(id) {
    const definition = defaultToolbars.find(row => row.id === id);
    if (!definition) throw new Error('Unknown default toolbar ' + id);
    this.setRows(this.rows.map(row => row.id === id ? structuredClone(definition) : row));
  }
  mount(host, {customize}) {
    const document = host.ownerDocument;
    const root = element(document, 'div', {className: 'wb-toolbars'});
    host.append(root);
    const render = () => {
      root.replaceChildren();
      for (const row of this.rows.filter(item => item.visible)) {
        const group = element(document, 'div', {className: 'wb-toolbar', role: 'toolbar', 'aria-label': row.title, draggable: 'true'});
        group.addEventListener('dragstart', event => event.dataTransfer?.setData('application/x-sharpforge-toolbar', row.id));
        group.addEventListener('dragover', event => event.preventDefault());
        group.addEventListener('drop', event => {
          event.preventDefault();
          const id = event.dataTransfer?.getData('application/x-sharpforge-toolbar');
          const source = this.rows.find(item => item.id === id);
          if (!source || source === row) return;
          const rows = this.rows.filter(item => item !== source);
          rows.splice(rows.indexOf(row), 0, source);
          this.setRows(rows);
        });
        group.addEventListener('contextmenu', event => { event.preventDefault(); customize?.(row.id); });
        for (const id of row.commands) {
          const command = this.registry.describe(id);
          if (!command) continue;
          group.append(button(document, command.label, runAction(() => this.execute(id), this.onError), {
            disabled: !command.enabled, title: command.label + (command.shortcut ? ' (' + command.shortcut + ')' : ''),
            'aria-pressed': command.checked
          }));
        }
        root.append(group);
      }
    };
    render();
    const unsubscribe = this.subscribe(render), unsubscribeCommands = this.registry.subscribe(render);
    return () => { unsubscribe(); unsubscribeCommands(); root.remove(); };
  }
}
