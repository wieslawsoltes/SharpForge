import { KeybindingService, getProfileBindings } from '@sharpforge/editor';

function sameAssignment(left, right) {
  return left.command === right.command && left.scope === right.scope && left.keys.join(' ') === right.keys.join(' ');
}

/** Scoped bindings share command identities with menus; custom mappings run before editor defaults. */
export class StudioKeyboard {
  constructor({ commands, getEditor, context, onStatus, onError, platform = 'windows' }) {
    Object.assign(this, { commands, getEditor, context });
    this.configuration = { execute: (id, args) => this.execute(id, args), context, platform, onStatus, onError };
    this.base = new Map();
    this.profileBindings = [];
    this.assigned = [];
    this.removed = [];
    this.editorCommands = new Map();
    this.attachments = new Map();
    this.documents = new Map();
    this.sequence = 0;
    this.disposed = false;
    for (const [id, , shortcut] of commands.list()) {
      if (!shortcut) continue;
      this.base.set(`studio:${id}`, { id: `studio:${id}`, command: id, keys: shortcut.replace(/Ctrl/g, 'Mod'), scope: 'Global' });
    }
    this.commit(this.prepare());
  }

  assertOpen() { if (this.disposed) throw new Error('Studio keyboard is disposed'); }

  execute(id, args) {
    this.assertOpen();
    const editor = this.getEditor();
    if (editor?.keymapAdapter?.commands.has(id)) return editor.keymapAdapter.execute(id, args);
    if (this.editorCommands.has(id)) throw new Error(`Editor command '${id}' has no active editor`);
    return this.commands.execute(id, args);
  }

  /** Prepare all three tables before exposing any new registration, profile or removal. */
  prepare({ base = this.base, profile = this.profileBindings, assigned = this.assigned, removed = this.removed } = {}) {
    const service = new KeybindingService(this.configuration);
    const custom = new KeybindingService(this.configuration);
    const suppressed = new KeybindingService({ ...this.configuration, execute: () => {} });
    try {
      custom.setBindings(assigned.map(binding => ({ ...binding, priority: 100 })));
      suppressed.setBindings(removed);
      const removals = suppressed.list();
      service.setBindings([...base.values(), ...profile, ...custom.list()]);
      service.setBindings(service.list().filter(binding => !removals.some(removal => sameAssignment(binding, removal))));
      return { service, custom, suppressed, base, profile, assigned: custom.list(), removed: removals };
    } catch (error) {
      service.dispose(); custom.dispose(); suppressed.dispose();
      throw error;
    }
  }

  commit(prepared) {
    const old = [this.service, this.custom, this.suppressed];
    this.service = prepared.service;
    this.custom = prepared.custom;
    this.suppressed = prepared.suppressed;
    this.base = prepared.base;
    this.profileBindings = prepared.profile;
    this.assigned = prepared.assigned;
    this.removed = prepared.removed;
    for (const service of old) service?.dispose();
    for (const editor of this.attachments.keys()) editor.keymapAdapter.bindings.cancel();
  }

  register(binding) {
    this.assertOpen();
    const id = binding.id ?? `studio-dynamic:${++this.sequence}`;
    if (this.base.has(id)) throw new Error(`Duplicate binding '${id}'`);
    const base = new Map(this.base);
    base.set(id, { ...binding, id });
    this.commit(this.prepare({ base }));
    let active = true;
    return () => {
      if (!active || this.disposed) return;
      active = false;
      const next = new Map(this.base);
      next.delete(id);
      this.commit(this.prepare({ base: next }));
    };
  }

  list() { return this.service.list(); }
  conflicts(binding) { return this.service.conflicts(binding); }
  bindingsFor(command) { return this.service.bindingsFor(command); }

  profile(id) {
    this.assertOpen();
    const profile = getProfileBindings(id).map((binding, index) => ({
      ...binding, id: `editor-profile:${index}`, scope: 'Text Editor'
    }));
    this.commit(this.prepare({ profile }));
  }

  attach(editor) {
    this.assertOpen();
    if (this.attachments.has(editor)) return this.attachments.get(editor);
    const removeFilter = editor.keymapAdapter.bindings.addFilter(binding =>
      this.disposed || !this.removed.some(removal => sameAssignment(binding, removal)));
    let removeContribution;
    const detach = () => {
      if (!this.attachments.delete(editor)) return;
      removeFilter();
      removeContribution?.();
    };
    this.attachments.set(editor, detach);
    removeContribution = editor.registerContribution?.({ dispose: detach });
    for (const command of editor.keymapAdapter.commands.list()) {
      if (this.editorCommands.has(command.id) || this.commands.describe(command.id)) continue;
      const dispose = this.commands.register({
        id: command.id, title: command.title, label: command.title, category: command.category,
        enabled: () => {
          const active = this.getEditor()?.keymapAdapter?.commands.get(command.id);
          return !!active && active.enabled();
        },
        execute: invocation => this.execute(command.id, invocation.args?.[0])
      });
      this.editorCommands.set(command.id, dispose);
    }
    return detach;
  }

  apply(bindings) {
    this.assertOpen();
    if (!Array.isArray(bindings)) throw new TypeError('Keyboard overrides must be an array');
    this.commit(this.prepare({ assigned: bindings.filter(binding => !binding.removed), removed: bindings.filter(binding => binding.removed) }));
  }

  scope(event) {
    const target = event.target;
    if (target?.closest?.('.sf-editor')) return 'Text Editor';
    if (target?.closest?.('[data-tool="solution"],#solution,.solution-explorer')) return 'Solution Explorer';
    if (target?.closest?.('[data-designer],.designer-shell')) return 'Designer';
    return this.context().debugState === 'paused' ? 'Debugging' : 'Global';
  }

  capture(event) {
    if (this.disposed || event.target?.closest?.('[role="dialog"],dialog')) return false;
    return this.custom.handle(event, { scope: this.scope(event), context: this.context() });
  }

  handle(event) {
    if (this.disposed || event.target?.closest?.('[role="dialog"],dialog')) return false;
    return this.service.handle(event, { scope: this.scope(event), context: this.context() });
  }

  install(document) {
    this.assertOpen();
    if (this.documents.has(document)) return this.documents.get(document);
    const capture = event => this.capture(event);
    const bubble = event => this.handle(event);
    document.addEventListener('keydown', capture, true);
    document.addEventListener('keydown', bubble);
    const dispose = () => {
      if (!this.documents.delete(document)) return;
      document.removeEventListener('keydown', capture, true);
      document.removeEventListener('keydown', bubble);
    };
    this.documents.set(document, dispose);
    return dispose;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of [...this.documents.values(), ...this.attachments.values(), ...this.editorCommands.values()]) dispose();
    this.editorCommands.clear();
    this.service.dispose();
    this.custom.dispose();
    this.suppressed.dispose();
  }
}
