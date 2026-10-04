import {ControlTemplate} from '../templates/template-factory.js';
import {TemplateHost} from '../templates/template-host.js';
import {PropertyFault} from './values.js';
import {ValueSource} from './property-store.js';

/** Compatibility VisualTree definitions compile once to factories; instances use indexed namescopes. */
export function createJavaScriptTemplateAdapter(context) {
  const {objects, classes, framework, registry, storeFor, send, disposeObject, typeName} = context;
  const factories = new WeakMap();
  const definitions = new WeakMap();
  const hosts = new WeakMap();
  const visual = object => object?.$node && framework.frameworkAssignable(framework.XAML + 'UIElement', object.$node.type);

  function children(object) {
    const result = [];
    for (const name of ['Child', 'Content']) if (visual(object.$values[name])) result.push(object.$values[name]);
    for (const collection of Object.values(object.$collections)) for (const child of collection) if (visual(child)) result.push(child);
    return result;
  }

  function blueprint(root) {
    const seen = new Set();
    const names = new Set();
    function visit(object, depth) {
      if (!visual(object) || object.$context !== objects) throw new PropertyFault('ArgumentException', 'Template parts must be application visuals');
      if (seen.has(object) || seen.size >= 100000 || depth > 512) throw new PropertyFault('InvalidOperationException', 'Template cycle or size limit');
      seen.add(object);
      const name = object.$values.Name;
      if (name && names.has(name)) throw new PropertyFault('InvalidOperationException', 'Duplicate template name');
      if (name) names.add(name);
      const properties = [];
      for (const key of object.$locals) {
        const value = object.$values[key];
        if (!visual(value)) properties.push([key, value]);
      }
      const slots = [];
      for (const key of ['Child', 'Content']) if (visual(object.$values[key])) slots.push([key, visit(object.$values[key], depth + 1)]);
      const collections = [];
      for (const [key, values] of Object.entries(object.$collections)) {
        collections.push([key, [...values].filter(visual).map(child => visit(child, depth + 1))]);
      }
      return Object.freeze({type: object.$node.type, properties, slots, collections, bindings: {...object.$bindings}});
    }
    return visit(root, 0);
  }

  function compile(wrapper) {
    if (wrapper === null || wrapper === undefined || wrapper instanceof ControlTemplate) return wrapper ?? null;
    if (factories.has(wrapper)) return factories.get(wrapper);
    if (wrapper.$context !== objects || wrapper.$node?.type !== framework.CONTROLS + 'ControlTemplate') {
      throw new PropertyFault('ArgumentException', 'ControlTemplate belongs to another application');
    }
    const definition = blueprint(wrapper.$values.VisualTree);
    definitions.set(wrapper, definition);
    const instantiate = templateContext => {
      function build(node) {
        const Constructor = classes.get(node.type);
        if (!Constructor) throw new PropertyFault('TypeLoadException', 'Template visual type is not registered');
        const object = new Constructor();
        templateContext.own(() => disposeObject(object));
        const store = storeFor(object);
        for (const [name, value] of node.properties) store.setSource(registry.lookup(node.type, name), ValueSource.TemplatedParent, value);
        for (const [name, child] of node.slots) object[name] = build(child);
        for (const [name, values] of node.collections) for (const child of values) object[name].Add(build(child));
        for (const [targetName, sourceName] of Object.entries(node.bindings)) {
          const source = registry.lookup(templateContext.owner.$node.type, sourceName);
          const target = registry.lookup(node.type, targetName);
          if (!source || !target || target.readOnly || !registry.isAssignable(target.propertyType, source.propertyType)) {
            throw new PropertyFault('ArgumentException', 'TemplateBinding properties are incompatible');
          }
          templateContext.bind(object, target, source);
        }
        return object;
      }
      return build(definition);
    };
    const template = new ControlTemplate(instantiate, {targetType: typeName(wrapper.$values.TargetType ?? wrapper.$values.TargetTypeName) || null});
    factories.set(wrapper, template);
    return template;
  }

  const adapter = {
    storeFor,
    children,
    typeOf: object => object.$node.type,
    name: object => object.$values.Name,
    setTemplatedParent(object, owner, namescope) {
      object.$templateOwner = owner;
      object.$namescope = namescope;
      send({op: 'templateOwner', id: object.$node.id, owner: owner?.$node.id ?? null});
    },
    attachRoot(owner, root) {
      owner.$templateRoot = root;
      if (root) storeFor(root).setParent(storeFor(owner));
      send({op: 'template', id: owner.$node.id, root: root?.$node.id ?? null});
    },
    setDataContext(object, value) {
      if (value === undefined) return;
      const property = registry.lookup(object.$node.type, 'DataContext');
      if (property) storeFor(object).setSource(property, ValueSource.Inherited, value);
    },
    detach(object) { storeFor(object).setParent(null); },
    dispose: disposeObject
  };

  function hostFor(owner) {
    let host = hosts.get(owner);
    if (!host) {
      host = new TemplateHost({owner, adapter, registry, onApplyTemplate: target => target.OnApplyTemplate?.()});
      hosts.set(owner, host);
    }
    return host;
  }

  function invalidate(wrapper) { factories.delete(wrapper); }
  function prepare(owner, wrapper) {
    const template = compile(wrapper);
    if (!template) return null;
    if (template.targetType && !registry.isAssignable(template.targetType, owner.$node.type)) {
      throw new PropertyFault('ArgumentException', 'ControlTemplate target type is incompatible');
    }
    const definition = definitions.get(wrapper);
    const queue = definition ? [definition] : [];
    while (queue.length) {
      const node = queue.pop();
      for (const [targetName, sourceName] of Object.entries(node.bindings)) {
        const source = registry.lookup(owner.$node.type, sourceName);
        const target = registry.lookup(node.type, targetName);
        if (!source || !target || target.readOnly || !registry.isAssignable(target.propertyType, source.propertyType)) {
          throw new PropertyFault('ArgumentException', 'TemplateBinding properties are incompatible');
        }
      }
      for (const [, child] of node.slots) queue.push(child);
      for (const [, children] of node.collections) queue.push(...children);
    }
    return template;
  }
  return {compile, prepare, hostFor, children, invalidate, dispose: owner => { hosts.get(owner)?.dispose(); hosts.delete(owner); }};
}
