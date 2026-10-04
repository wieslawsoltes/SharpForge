import { KeybindingService, getProfileBindings } from '@sharpforge/editor';

/** Scoped bindings share command identities with menus; custom mappings run before editor defaults. */
export class StudioKeyboard {
  constructor({ commands, getEditor, context, onStatus, onError, platform = 'windows' }) {
    Object.assign(this, { commands, getEditor, context, onError });
    const execute = (id, args) => this.execute(id, args);
    this.service = new KeybindingService({ execute, context, platform, onStatus, onError });
    this.custom = new KeybindingService({ execute, context, platform, onStatus, onError });
    this.suppressed = new KeybindingService({ execute: () => {}, context, platform, onStatus, onError });
    this.scheme = [];
    this.removers = [];
    this.editorCommands = new Map();
    this.disposers = [];
    for (const [id, , shortcut] of commands.list()) {
      if (!shortcut) continue;
      this.service.register({ id: `studio:${id}`, command: id, keys: shortcut.replace(/Ctrl/g, 'Mod'), scope: 'Global' });
    }
  }

  execute(id, args) {
    const editor = this.getEditor();
    if (editor?.keymapAdapter.commands.has(id)) return editor.keymapAdapter.execute(id, args);
    return this.commands.execute(id, args);
  }

  register(binding) { return this.service.register(binding); }
  list() { return this.service.list(); }
  conflicts(binding) { return this.service.conflicts(binding); }
  bindingsFor(command) { return this.service.bindingsFor(command); }

  profile(id) {
    for (const dispose of this.scheme) dispose();
    this.scheme = getProfileBindings(id).map((binding, index) => this.service.register({
      ...binding, id: `editor-profile:${index}`, scope: 'Text Editor'
    }));
  }

  attach(editor) {
    for (const command of editor.keymapAdapter.commands.list()) {
      if (this.editorCommands.has(command.id) || this.commands.describe(command.id)) continue;
      const dispose = this.commands.register({
        id: command.id, title: command.title, label: command.title, category: command.category,
        enabled: () => {
          const active = this.getEditor()?.keymapAdapter.commands.get(command.id);
          return !!active && active.enabled();
        },
        execute: invocation => this.execute(command.id, invocation.args?.[0])
      });
      this.editorCommands.set(command.id, dispose);
    }
  }

  apply(bindings) {
    for (const dispose of this.removers) dispose();
    this.removers = [];
    const assigned = bindings.filter(binding => !binding.removed);
    const removed = bindings.filter(binding => binding.removed);
    this.custom.setBindings(assigned);
    this.suppressed.setBindings(removed);
    for (const binding of assigned) this.removers.push(this.service.register({ ...binding, priority: 100 }));
  }

  scope(event) {
    const target = event.target;
    if (target?.closest?.('.sf-editor')) return 'Text Editor';
    if (target?.closest?.('[data-tool="solution"],#solution,.solution-explorer')) return 'Solution Explorer';
    if (target?.closest?.('[data-designer],.designer-shell')) return 'Designer';
    return this.context().debugState === 'paused' ? 'Debugging' : 'Global';
  }

  capture(event) {
    if (event.target?.closest?.('[role="dialog"],dialog')) return false;
    const options = { scope: this.scope(event), context: this.context() };
    return this.custom.handle(event, options) || this.suppressed.handle(event, options);
  }

  handle(event) {
    return this.service.handle(event, { scope: this.scope(event), context: this.context() });
  }

  install(document) {
    const capture = event => this.capture(event);
    document.addEventListener('keydown', capture, true);
    const dispose = () => document.removeEventListener('keydown', capture, true);
    this.disposers.push(dispose);
    return dispose;
  }

  dispose() {
    for (const dispose of [...this.disposers, ...this.editorCommands.values(), ...this.scheme, ...this.removers]) dispose();
    this.service.dispose();
    this.custom.dispose();
    this.suppressed.dispose();
  }
}
