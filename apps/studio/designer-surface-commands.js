import {childSlot, designerEventSourceAccess, geometryInvariant, reorderDesignSelection, resetDesignLayout} from '@sharpforge/designer';
import {designerInlineTextCapability} from './designer-surface-text.js';
import {defaultDesignerEvent} from './designer-event-actions.js';

/** Context menus and keyboard bindings share one command registry and enablement policy. */
export class DesignerSurfaceCommands {
  constructor(controller) {
    this.controller = controller;
    this.view = controller.view;
    const document = () => this.view.document;
    const selected = () => document().selection;
    const childSelection = () => selected().length > 0 && !selected().includes(document().value.root)
      && selected().every(id => !(this.view.outline?.isLocked(id) ?? false));
    const siblings = () => childSelection() && selected().every(id => document().parent(id)?.id === document().parent(selected()[0])?.id);
    this.actions = new Map();
    const register = (id, enabled, run) => this.actions.set(id, {enabled, run});
    for (const action of ['cut', 'copy', 'delete', 'duplicate']) {
      register(action, action === 'copy' ? () => selected().length > 0 : childSelection, () => this.view.action(action));
    }
    register('paste', () => {
      if (this.view.toolbox?.insertionParent) {
        try { return Boolean(this.view.clipboard && this.view.toolbox.insertionParent()); }
        catch { return false; }
      }
      const node = document().node();
      const parent = childSlot(node?.type) ? node : document().parent(node?.id);
      const slot = parent ? childSlot(parent.type) : null;
      return Boolean(this.view.clipboard && slot && (slot.many || !parent.children.length)
        && !(this.view.outline?.isLocked(parent.id) ?? false));
    }, () => this.view.action('paste'));
    register('undo', () => this.view.canUndo?.(false) ?? document().undoStack.length > 0, () => this.view.undo(false));
    register('redo', () => this.view.canUndo?.(true) ?? document().redoStack.length > 0, () => this.view.undo(true));
    register('reset-layout', childSelection, () => resetDesignLayout(document()));
    register('inline-text', () => selected().length === 1 && childSelection() && designerInlineTextCapability(this.view).editable,
      () => controller.text.begin());
    register('open-component', () => selected().length === 1 && Boolean(this.view.componentDefinition?.(selected()[0])),
      () => this.view.openComponent(selected()[0]));
    for (const direction of ['front', 'back', 'forward', 'backward']) {
      register(`order:${direction}`, siblings, () => reorderDesignSelection(document(), direction));
    }
    for (const type of ['Canvas', 'Grid', 'StackPanel']) {
      register(`group:${type}`, siblings, () => document().group(type));
    }
    register('ungroup', () => childSelection() && selected().length === 1
      && ['Canvas', 'Grid', 'StackPanel'].includes(document().node().type.split('.').at(-1)), () => document().ungroup());
    for (const action of ['left', 'center', 'right', 'top', 'middle', 'bottom', 'distribute-h', 'distribute-v',
      'same-width', 'same-height', 'same-size']) {
      register(`align:${action}`, () => siblings() && document().parent(selected()[0])?.type.endsWith('.Canvas')
        && selected().length >= (action.startsWith('distribute') ? 3 : 2), () => controller.align(action));
    }
    register('properties', () => selected().length > 0, () => this.view.docking.activate('designer-properties'));
    register('layout', () => selected().length > 0, () => this.view.docking.activate('designer-layout'));
    for (const kind of ['style', 'template']) {
      register(`edit-${kind}`, () => selected().length === 1 && Boolean(document().node()[kind]), () => {
        if (this.view.resources) {
          if (kind === 'template') this.view.resources.enterTemplate(document().node()[kind]);
          else {
            this.view.resources.selectedKey = document().node()[kind];
            this.view.resources.render();
          }
          this.view.docking.activate('designer-styles');
          return;
        }
        this.view.resourceKind = kind;
        this.view.styleKey = document().node()[kind];
        this.view.docking.activate('designer-styles');
        this.view.renderResources();
      });
    }
    register('view-code', () => Boolean(this.view.sourceSync.session), () => {
      const analysis = this.view.sourceSync.session.analysis;
      const binding = analysis.bindings[document().selection[0]];
      this.view.openSource(analysis.uri, binding?.declaration?.start ?? analysis.method.start);
    });
    register('go-handler', () => selected().length === 1 && typeof this.view.sourceSync?.navigateEvent === 'function' &&
      this.handlerEvent() !== null,
      () => this.goHandler());
    register('fit-selection', () => selected().length > 0, () => controller.fitSelection());
  }

  enabled(id) {
    return this.actions.get(id)?.enabled() ?? false;
  }

  run(id) {
    const command = this.actions.get(id);
    geometryInvariant(command, 'SFD_COMMAND_UNKNOWN', `Unknown surface command '${id}'.`);
    geometryInvariant(command.enabled(), 'SFD_COMMAND_DISABLED', `Command '${id}' is unavailable for this selection.`);
    this.controller.finishKeyboard();
    return command.run();
  }

  goHandler() {
    const node = this.view.document.node();
    return this.view.sourceSync.navigateEvent(node.id, this.handlerEvent());
  }

  handlerEvent() {
    const node = this.view.document.node();
    const analysis = this.view.sourceSync?.session?.analysis;
    if (!node || !analysis) return null;
    const bindings = analysis.bindings?.[node.id]?.events ?? {};
    const preferred = defaultDesignerEvent(this.view, node.id);
    const names = [...new Set([preferred, ...Object.keys(bindings).sort()].filter(Boolean))];
    return names.find(name => designerEventSourceAccess(bindings[name], {uri: analysis.uri}).canNavigate) ?? null;
  }

  item(id, label, shortcut = '') {
    return {label, shortcut, enabled: this.enabled(id), action: () => this.view.safe(() => this.run(id))};
  }

  context(event) {
    const item = (id, label, shortcut) => this.item(id, label, shortcut);
    this.view.menu.show({document: this.view.stage.ownerDocument, anchor: event.target,
      x: event.clientX, y: event.clientY, items: [item('properties', 'Properties'), item('layout', 'Layout'), null,
        {label: 'Order', children: [['front', 'Bring to front'], ['back', 'Send to back'],
          ['forward', 'Bring forward'], ['backward', 'Send backward']].map(([id, label]) => item(`order:${id}`, label))},
        {label: 'Align', children: [['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['top', 'Top'],
          ['middle', 'Middle'], ['bottom', 'Bottom'], ['distribute-h', 'Distribute horizontally'],
          ['distribute-v', 'Distribute vertically'], ['same-width', 'Same width'], ['same-height', 'Same height'],
          ['same-size', 'Same size']].map(([id, label]) => item(`align:${id}`, label))},
        {label: 'Group into', children: ['Canvas', 'Grid', 'StackPanel'].map(type => item(`group:${type}`, type))},
        item('ungroup', 'Ungroup'), item('reset-layout', 'Reset layout'), null,
        ...(this.enabled('open-component') ? [item('open-component', 'Open component document')] : []),
        item('edit-template', 'Edit template'), item('edit-style', 'Edit style'), item('view-code', 'View code'),
        item('go-handler', 'Go to handler'), item('inline-text', 'Edit text', 'F2'), null,
        item('cut', 'Cut', 'Ctrl+X'), item('copy', 'Copy', 'Ctrl+C'), item('paste', 'Paste', 'Ctrl+V'),
        item('duplicate', 'Duplicate', 'Ctrl+D'), item('delete', 'Delete', 'Delete'), null,
        item('undo', 'Undo', 'Ctrl+Z'), item('redo', 'Redo', 'Ctrl+Y'), item('fit-selection', 'Fit selection')
      ]});
  }
}
