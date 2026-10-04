import {ControlTemplate} from '../templates/template-factory.js';
import {Style, Setter} from '../styles/style.js';
import {VisualState, VisualStateGroup} from '../visual-states/visual-state.js';
import {themeResource} from '../resources/reference.js';
import {ValueSource} from '../property/property-store.js';
import {visualStateGroups} from './visual-state-resource-adapters.js';
import {ResourceFault} from '../resources/errors.js';
import {defaultStyleSelection} from './default-style-key.js';

const x = 'Microsoft.UI.Xaml.';

/** The control package supplies recipes; this package materializes them without depending on a renderer. */
export class DefaultTemplateCatalog {
  constructor(context, buildStyle, {maxTypes = 10000, maxNodes = 1000} = {}) {
    if (typeof buildStyle !== 'function') throw new TypeError('A registered control-template recipe builder is required.');
    this.context = context; this.buildStyle = buildStyle; this.maxTypes = maxTypes; this.maxNodes = maxNodes;
    this.styles = new Map();
  }

  get(owner) {
    let type = defaultStyleSelection(this.context, owner).type;
    const seen = new Set();
    while (type) {
      if (seen.has(type) || seen.size >= 256) throw new ResourceFault('SFTPL017', 'Default-template ancestry limit exceeded.');
      seen.add(type);
      if (!this.styles.has(type)) {
        if (this.styles.size >= this.maxTypes) throw new ResourceFault('SFTPL017', 'Default-template catalog budget exceeded.');
        this.styles.set(type, this.buildStyle(type, this.factories()));
      }
      const style = this.styles.get(type);
      if (style) return style;
      type = this.context.baseType?.(type) ?? this.context.frameworkRegistry.types.get(type)?.base;
    }
    return null;
  }

  factories() {
    const context = this.context;
    let count = 0;
    return {
      create: (type, properties) => {
        if (++count > this.maxNodes) throw new ResourceFault('SFTPL017', 'Default-template recipe budget exceeded.');
        return {type, properties, bindings: [], resources: [], children: [], child: null};
      },
      hasProperty: (type, property) => !!context.propertiesFor(type)?.[property],
      bind: (part, target, source) => part.bindings.push({target, source}),
      resource: (part, property, key) => part.resources.push({property, key}),
      child: (parent, child) => { parent.child = child; },
      children: (parent, children) => { parent.children = children; },
      template: (type, root, metadata) => this.template(type, root, metadata),
      states: (template, groups) => { template.catalog.groups = groups; },
      style: (type, values) => {
        const setters = Object.entries(values).map(([name, value]) => {
          const property = context.propertyRegistry.lookup(type, name);
          const native = name === 'Template' ? context.wrapModel(value, x + 'Controls.ControlTemplate') : this.materialize(property, value);
          return new Setter(property, native);
        });
        return new Style(type, {setters});
      }
    };
  }

  template(type, recipe, metadata) {
    const catalog = {family: metadata.family, itemsBinding: metadata.itemsBinding, groups: []};
    const factory = templateContext => {
      const created = [];
      try {
        const root = this.build(recipe, templateContext, created);
        const groups = catalog.groups.map(group => new VisualStateGroup(group.name, {states: group.states.map(state =>
          new VisualState(state.name, {setters: state.setters.map(setter => {
            const target = templateContext.namescope.peekName(setter.target);
            const property = this.context.propertyRegistry.lookup(this.context.typeOf(target), setter.property);
            return new Setter(property, this.materialize(property, setter.value), {target: setter.target + '.' + setter.property});
          })}))}));
        visualStateGroups(this.context, root).values = groups;
        this.context.write(root, '$templateFamily', catalog.family);
        return root;
      } catch (error) {
        const failures = [error];
        // Bindings and resource observers must disconnect before their target stores are disposed.
        try { templateContext.lifetime.dispose({templateDisposal: true}); } catch (failure) { failures.push(failure); }
        for (let index = created.length - 1; index >= 0; index--) {
          try { this.context.templateHostAdapter.dispose?.(created[index]); } catch (failure) { failures.push(failure); }
        }
        if (failures.length > 1) throw new AggregateError(failures, 'Default-template creation and cleanup failed.', {cause: error});
        throw error;
      }
    };
    const template = new ControlTemplate(factory, {targetType: type, maxNodes: this.maxNodes});
    template.catalog = catalog;
    return template;
  }

  materialize(property, value) {
    if (!property) throw new ResourceFault('SFTPL017', 'Default template references an unknown dependency property.');
    const context = this.context;
    const materialized = context.materializeResource?.(value, property.propertyType) ??
      context.materializeXamlValue?.(property.propertyType, value) ?? value;
    return context.properties.toNative(materialized, property.propertyType);
  }

  build(recipe, templateContext, created) {
    templateContext.signal?.throwIfAborted();
    const context = this.context, target = context.make(recipe.type);
    created.push(target);
    for (const [name, value] of Object.entries(recipe.properties)) {
      const property = context.propertyRegistry.lookup(recipe.type, name);
      if (property) context.storeFor(target).setSource(property, ValueSource.DefaultStyle, this.materialize(property, value));
      else context.write(target, name, value);
    }
    if (recipe.properties.Name) templateContext.register(recipe.properties.Name, target);
    for (const {target: name, source} of recipe.bindings) {
      templateContext.bind(target, context.propertyRegistry.lookup(recipe.type, name),
        context.propertyRegistry.lookup(context.typeOf(templateContext.owner), source));
    }
    for (const {property: name, key} of recipe.resources) {
      const property = context.propertyRegistry.lookup(recipe.type, name), store = context.storeFor(target);
      templateContext.own(templateContext.resources.observe(themeResource(key), {
        validate: value => store.validateValue(property, this.materialize(property, value), {coerce: false}),
        changed: value => store.setSource(property, ValueSource.DefaultStyle, this.materialize(property, value))
      }));
    }
    if (recipe.child) {
      const child = this.build(recipe.child, templateContext, created);
      const name = context.propertiesFor(recipe.type).Child ? 'Child' : 'Content';
      const property = context.propertyRegistry.lookup(recipe.type, name);
      context.storeFor(target).setSource(property, ValueSource.DefaultStyle, context.properties.toNative(child, property.propertyType));
    }
    if (recipe.children.length) {
      const list = context.read(target, 'Children');
      for (const child of recipe.children) context.addItem(list, this.build(child, templateContext, created));
    }
    return target;
  }

  snapshot() { return [...this.styles].map(([type, style]) => ({type, style, state: style?.snapshot()})); }
  restore(snapshot) {
    this.styles = new Map(snapshot.map(saved => {
      if (saved.style) saved.style.restore(saved.state);
      return [saved.type, saved.style];
    }));
  }
  *retainedValues() { for (const style of this.styles.values()) if (style) yield* style.retainedValues(); }
  dispose() { this.styles.clear(); }
}

export function installDefaultTemplateCatalog(context, buildStyle, options) {
  const catalog = context.state(null, 'defaultTemplateCatalog', () => new DefaultTemplateCatalog(context, buildStyle, options));
  context.defaultStyleFor = owner => catalog.get(owner);
  context.defaultStyleResourceKey = owner => defaultStyleSelection(context, owner).key;
  return catalog;
}
