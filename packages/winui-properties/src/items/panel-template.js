import {ItemsPanelTemplate} from '../templates/template-factory.js';
import {resourceScopeModel} from '../object-model/resource-adapter-models.js';
import {ResourceFault} from '../resources/errors.js';
import {withUIConstruction} from '../object-model/construction-roots.js';

/** A realized ItemsPanelTemplate supplies layout metadata while the owner's one generator owns item containers. */
export class ItemsPanelHost {
  constructor(context, owner) {
    this.context = context;
    this.owner = owner;
    this.template = null;
    this.instance = null;
  }

  update(template) {
    return withUIConstruction(this.context, () => {
      try { return this.updateTemplate(template); }
      finally { this.context.syncOwner?.(this.owner); }
    }, [this.owner]);
  }

  updateTemplate(template) {
    if (template === this.template) return this.instance?.root ?? null;
    if (template !== null && !(template instanceof ItemsPanelTemplate)) {
      throw new ResourceFault('SFITEM016', 'ItemsPanel requires an ItemsPanelTemplate.');
    }
    const context = this.context;
    const next = template?.instantiate({owner: this.owner, resources: resourceScopeModel(context, this.owner),
      adapter: context.templateHostAdapter}) ?? null;
    try {
      if (next?.root) {
        const type = context.typeOf(next.root);
        if (!context.propertyRegistry.isAssignable('Microsoft.UI.Xaml.Controls.Panel', type)) {
          throw new ResourceFault('SFITEM016', 'The ItemsPanelTemplate root must derive from Panel.');
        }
        context.setVisualParent(next.root, this.owner);
      }
    } catch (error) {
      next?.dispose();
      throw error;
    }
    const previous = this.instance;
    this.template = template;
    this.instance = next;
    previous?.dispose();
    return next?.root ?? null;
  }

  snapshot() {
    return {template: this.template, instance: this.instance, state: this.instance?.snapshot()};
  }

  restore(snapshot) {
    if (this.instance !== snapshot.instance) this.instance?.dispose({preserveValues: true});
    this.template = snapshot.template;
    this.instance = snapshot.instance;
    this.instance?.restore(snapshot.state);
  }

  *retainedValues() {
    yield this.owner;
    if (this.instance) yield* this.instance.retainedValues();
    if (this.template) yield* this.template.retainedValues();
  }

  dispose(options) {
    this.instance?.dispose(options);
    this.instance = null;
    this.template = null;
  }
}

export function updateItemsPanel(context, owner) {
  const reference = context.read(owner, 'ItemsPanel');
  const template = context.unwrapModel(reference) ?? null;
  const host = context.state(owner, 'itemsPanel', template ? () => new ItemsPanelHost(context, owner) : undefined);
  return host?.update(template) ?? null;
}
