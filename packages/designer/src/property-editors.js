import {frameworkType, MEDIA, XAML} from '@sharpforge/framework';
import {DesignerAuthoringError, authoringError} from './property-diagnostics.js';

/** An instance-scoped registry: disposal and factory failures are isolated to one editor. */
export class PropertyEditorRegistry {
  constructor() {
    this.entries = [];
    this.nextOrder = 0;
  }

  register({id, names = [], types = [], matches, priority = 0, create}) {
    if (!id || typeof create !== 'function' || this.entries.some(entry => entry.id === id)) {
      authoringError('SFD1830', 'Property editors need a unique id and a factory.');
    }
    const entry = {id, names: new Set(names), types: new Set(types), matches, priority, create, order: this.nextOrder++};
    this.entries.push(entry);
    this.entries.sort((left, right) => right.priority - left.priority || left.order - right.order);
    return () => { this.entries = this.entries.filter(candidate => candidate !== entry); };
  }

  resolve(context) {
    return this.entries.find(entry => entry.names.has(context.name) || entry.types.has(context.schema.type) ||
      entry.matches?.(context)) ?? null;
  }

  create(context) {
    try {
      const entry = this.resolve(context);
      if (!entry) return {editor: null, diagnostic: {code: 'SFD1831', severity: 'info', span: null,
        message: `No editor is registered for ${context.name} (${context.schema.type}).`}};
      return {editor: entry.create(context), editorId: entry.id, diagnostic: null};
    } catch (error) {
      return {editor: null, diagnostic: error instanceof DesignerAuthoringError ? error.diagnostic : {
        code: 'SFD1832', severity: 'error', span: null, message: `Could not open ${context.name}: ${error.message ?? String(error)}`
      }};
    }
  }
}

/** The composition layer supplies factories; the package owns type dispatch and extension priority. */
export function createPropertyEditorRegistry(factories) {
  const registry = new PropertyEditorRegistry();
  const add = (id, matcher) => {
    if (typeof factories[id] === 'function') registry.register({id, ...matcher, create: factories[id]});
  };
  add('asset', {names: ['Source', 'IconSource'], priority: 20});
  add('font', {names: ['FontFamily', 'FontWeight'], priority: 20});
  add('brush', {types: [MEDIA + 'Brush', MEDIA + 'SolidColorBrush', MEDIA + 'LinearGradientBrush'], priority: 10});
  add('compound', {types: [XAML + 'Thickness', XAML + 'CornerRadius'], priority: 10});
  add('gridLength', {types: [XAML + 'GridLength'], priority: 10});
  add('flags', {matches: context => frameworkType(context.schema.type)?.kind === 'enum' &&
    !!(context.schema.flags || frameworkType(context.schema.type).flags), priority: 10});
  add('enum', {matches: context => frameworkType(context.schema.type)?.kind === 'enum'});
  add('collection', {matches: context => frameworkType(context.schema.type)?.kind === 'collection'});
  add('boolean', {types: ['bool']});
  add('number', {types: ['double', 'int']});
  add('text', {types: ['string', 'object']});
  return registry;
}
