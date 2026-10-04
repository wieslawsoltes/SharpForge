import {DependencyPropertyRegistry} from '../dependency-property.js';
import {PropertyStore, ValueSource} from './property-store.js';
import {UnsetValue, PropertyFault} from './values.js';
import {registerBuiltInAttachedProperties} from './attached.js';
import {EffectiveValueEmitter} from './change-emitter.js';
import {StyleApplication} from '../styles/style-application.js';
import {Binding, BindingExpression, BindingOperations} from '../binding/index.js';
import {createJavaScriptStyleModels} from './javascript-style-models.js';
import {createJavaScriptTemplateAdapter} from './javascript-template-adapter.js';
import {createBindingServices} from '../binding/context-services.js';
import {getResourceServices} from '../object-model/resource-services.js';
import {styleModel, setterModel, requireMutableStyle} from '../object-model/resource-adapter-models.js';

/** Framework services are injected; the shared property package never imports framework metadata. */
export function createJavaScriptStyleSystem(options) {
  const {objects, classes, send, host, value, framework, context = null} = options;
  const registry = new DependencyPropertyRegistry({
    canonicalType: framework.canonicalType,
    baseType: type => framework.frameworkType(type)?.base,
    isAssignable: framework.frameworkAssignable,
    getDeclaredProperty: (type, name) => framework.frameworkType(type)?.properties[name],
    typeDefinition: framework.frameworkType,
    typeOf: object => object?.$node?.type ?? object?.valueType ?? null
  });
  const stores = new WeakMap();
  const applications = new WeakMap();
  const readOnlyKey = Object.freeze({});
  const attached = registerBuiltInAttachedProperties(registry, framework.contracts ?? []);
  const models = context ? {
    typeName: candidate => context.typeName(candidate),
    assertMutable: object => assertResourceMutable(object),
    compile: wrapper => ({style: wrapper ? styleModel(context, wrapper) : null}),
    applied() {}
  } : createJavaScriptStyleModels({objects, registry, canonicalType: framework.canonicalType, classes});
  const isValue = object => ['value', 'brush'].includes(framework.frameworkType(object?.$node?.type ?? object?.valueType)?.kind);
  const emitter = new EffectiveValueEmitter({isMutableValue: isValue, emit: emitProperty});
  const bindingContext = context ?? {services: {}, storeFor, typeOf: object => object?.$node?.type ?? object?.valueType};
  const bindingServices = createBindingServices(bindingContext, {registry, storeFor, typeDefinition: framework.frameworkType});
  const bindingOperations = new BindingOperations(bindingServices);
  const templates = context ? {
    hostFor: owner => getResourceServices(context).templateHost(owner),
    prepare: (owner, wrapper) => prepareResourceTemplate(owner, wrapper),
    invalidate: object => context.states.get(object)?.delete('template'),
    dispose: object => context.state(object, 'templateHost')?.dispose()
  } : createJavaScriptTemplateAdapter({objects, classes, framework, registry, storeFor, send, disposeObject, typeName: models.typeName});
  let disposed = false;

  function assertObject(object) {
    if (disposed) throw new PropertyFault('ObjectDisposedException', 'The property application has been disposed');
    if (!object?.$node || object.$context !== objects) {
      throw new PropertyFault('ArgumentException', 'Dependency object belongs to another application');
    }
  }

  function propertyFor(object, name) {
    assertObject(object);
    const property = typeof name === 'string' ? registry.lookup(object.$node.type, name)
      : registry.resolve(context?.unwrapModel(name) ?? name);
    if (!property) throw new PropertyFault('ArgumentException', `Unknown dependency property '${name}'`);
    return property;
  }

  function storeFor(object) {
    assertObject(object);
    let store = stores.get(object);
    if (store) { context?.sceneJournal?.captureStore(store); return store; }
    store = new PropertyStore({registry, owner: object, ownerType: object.$node.type, readOnlyKey,
      onChange: change => changed(object, change)});
    stores.set(object, store);
    context?.sceneJournal?.captureStore(store);
    store.transaction(() => {
      for (const name of object.$locals ?? []) {
        const property = registry.lookup(object.$node.type, name) ?? attached.byHostProperty.get(name);
        if (!property) continue;
        if (property.readOnly) store.setReadOnlyValue(property, object.$values[name], readOnlyKey);
        else store.setValue(property, object.$values[name]);
      }
    });
    return store;
  }

  function emitProperty(object, property) {
    if (!objects.has(object.$node.id)) return;
    const name = property.metadata.hostProperty ?? property.name;
    send({op: 'set', id: object.$node.id, property: name, value: value(storeFor(object).getValue(property))});
  }

  function changed(object, change) {
    const name = change.property.metadata.hostProperty ?? change.property.name;
    context?.sceneJournal?.captureObject(object);
    object.$values[name] = change.newValue;
    context?.propertyChanged?.(change);
    if (!context?.valueDependencies) emitter.track(object, change.property, change.newValue);
    else if (!context.propertyChanged) context.valueDependencies.changed(change);
    if (isValue(object)) valueChanged(object);
    else emitProperty(object, change.property);
    if (name === 'Style' || name === 'DefaultStyleKey') applyStyle(object, object.$values.Style);
    if (name === 'Template') templateChanged(object, change.newValue);
    if (name === 'Name') bindingContext.services?.nameChanged?.(object, change.oldValue, change.newValue);
  }

  function applicationFor(object) {
    if (context) return getResourceServices(context).styleApplication(object);
    let application = applications.get(object);
    if (application) return application;
    application = new StyleApplication({target: object, store: storeFor(object), registry, storeFor,
      resources: context?.services?.resourcesFor?.(object) ?? null, namescope: object.$namescope ?? null,
      isBinding: candidate => (context?.unwrapModel(candidate) ?? candidate) instanceof Binding,
      bind: specification => new BindingExpression({...specification,
        binding: context?.unwrapModel(specification.binding) ?? specification.binding, services: bindingServices}).attach()});
    applications.set(object, application);
    return application;
  }

  function applyStyle(object, wrapper) {
    if (context) return getResourceServices(context).applyStyle(object);
    const result = models.compile(wrapper);
    const changed = applicationFor(object).apply(result.style);
    models.applied(result);
    return changed;
  }

  function applyTemplate(object, wrapper = object.$values.Template) {
    if (!registry.lookup(object.$node.type, 'Template')) return false;
    if (context) return getResourceServices(context).applyTemplate(object);
    const template = templates.prepare(object, wrapper);
    const changed = templates.hostFor(object).apply(template);
    object.$appliedTemplate = wrapper;
    return changed;
  }

  function templateChanged(object, wrapper = object.$values.Template) {
    if (context) return getResourceServices(context).templateChanged(object);
    return templates.hostFor(object).initialized ? applyTemplate(object, wrapper) : false;
  }

  function prepareResourceTemplate(object, wrapper) {
    const template = wrapper ? getResourceServices(context).templateModel(wrapper) : null;
    if (template?.targetType && !registry.isAssignable(template.targetType, object.$node.type)) {
      throw new PropertyFault('ArgumentException', 'ControlTemplate.TargetType is incompatible with this control');
    }
    return template;
  }

  function assertResourceMutable(object) {
    const type = object?.$node?.type;
    if (type === framework.XAML + 'Style') requireMutableStyle(styleModel(context, object));
    if (type === framework.XAML + 'Setter') requireMutableStyle(setterModel(context, object));
  }

  function validate(object, name, candidate) {
    const property = propertyFor(object, name);
    storeFor(object).assertProperty(property, true);
    const kind = framework.frameworkType(object.$node.type)?.kind;
    if (kind === 'style' || kind === 'setter') models.assertMutable(object);
    candidate = storeFor(object).validateValue(property, candidate);
    if (property.name === 'Style') applicationFor(object).prepare(models.compile(candidate).style);
    if (property.name === 'Template') templates.prepare(object, candidate);
    return candidate;
  }

  function set(object, name, candidate) {
    const property = propertyFor(object, name);
    candidate = validate(object, property, candidate);
    const local = object.$locals.has(property.name);
    try {
      const action = () => storeFor(object).transaction(() => {
        context?.sceneJournal?.captureObject(object);
        object.$locals.add(property.name);
        if (property.name === 'Style') object.$values['$local:Style'] = true;
        if (!context && property.name === 'Template') templateChanged(object, candidate);
        storeFor(object).setValue(property, candidate);
        if (context && ['Style', 'DefaultStyleKey'].includes(property.name)) applyStyle(object, object.$values.Style);
        if (context && property.name === 'Template') templateChanged(object, candidate);
      });
      if (context?.sceneTransaction && ['Style', 'Template', 'DefaultStyleKey'].includes(property.name)) context.sceneTransaction(action);
      else action();
      if (object.$node.type === framework.CONTROLS + 'ControlTemplate') templates.invalidate(object);
      return candidate;
    } catch (error) {
      if (!local) { object.$locals.delete(property.name); delete object.$values['$local:' + property.name]; }
      throw error;
    }
  }

  function clear(object, property) {
    property = propertyFor(object, property);
    models.assertMutable(object);
    storeFor(object).assertProperty(property, true);
    const action = () => storeFor(object).transaction(() => {
      context?.sceneJournal?.captureObject(object);
      object.$locals.delete(property.name);
      delete object.$values['$local:' + property.name];
      const result = storeFor(object).clearValue(property);
      if (property.name === 'Style' || property.name === 'DefaultStyleKey') applyStyle(object, object.$values.Style);
      if (property.name === 'Template') templateChanged(object, result);
      return result;
    });
    return context?.sceneTransaction && ['Style', 'Template', 'DefaultStyleKey'].includes(property.name)
      ? context.sceneTransaction(action) : action();
  }

  function setSource(object, property, source, candidate) {
    property = propertyFor(object, property);
    if (source === ValueSource.Local) return set(object, property, candidate);
    return storeFor(object).setSource(property, source, candidate);
  }

  function clearSource(object, property, source) {
    property = propertyFor(object, property);
    return source === ValueSource.Local ? clear(object, property) : storeFor(object).clearSource(property, source);
  }

  function setReadOnly(object, name, candidate) {
    return storeFor(object).setReadOnlyValue(propertyFor(object, name), candidate, readOnlyKey);
  }

  function initializeDefault(object, name, candidate) {
    return storeFor(object).setReadOnlyValue(propertyFor(object, name), candidate, readOnlyKey, ValueSource.Default);
  }

  function refresh(object) {
    if (!object) return;
    const kind = framework.frameworkType(object.$node.type)?.kind;
    if (context && (kind === 'style' || kind === 'setter')) {
      getResourceServices(context).refreshStyleModel(object);
      return;
    }
    if (registry.lookup(object.$node.type, 'Style')) applyStyle(object, object.$values.Style);
  }

  function assertCollectionMutable(object) { models.assertMutable(object); }
  function parent(child, owner) { storeFor(child).setParent(owner ? storeFor(owner) : null); }
  function bindings() { /* TemplateBinding subscriptions update only affected slots. */ }
  function valueChanged(object) {
    if (context?.valueDependencies) context.valueDependencies.mutated(object);
    else emitter.mutated(object);
  }

  function disposeObject(object) {
    if (!object?.$node || !objects.has(object.$node.id)) return;
    templates.dispose(object);
    if (context) context.state(object, 'styleApplication')?.dispose();
    applications.get(object)?.dispose();
    applications.delete(object);
    disposeOwner(object);
    send({op: 'remove', id: object.$node.id});
  }

  function disposeOwner(object) {
    const store = stores.get(object);
    if (store) { bindingOperations.ClearAllBindings(store); store.dispose(); }
    stores.delete(object);
    emitter.remove(object);
    context?.valueDependencies?.remove(object);
    objects.delete(object.$node.id);
  }

  function dispose(object) {
    if (object) return disposeObject(object);
    if (disposed) return;
    for (const target of objects.values()) disposeObject(target);
    disposed = true;
  }

  function scene() {
    return {version: 1, windows: [...host.windows], nodes: [...objects.values()].map(object => ({
      id: object.$node.id, type: object.$node.type,
      properties: Object.fromEntries(Object.entries(object.$values).filter(([name]) => !name.startsWith('$'))
        .map(([name, candidate]) => [name, value(candidate)])),
      events: Object.entries(object.$events).filter(([, listeners]) => listeners.length).map(([name]) => name),
      collections: Object.fromEntries(Object.entries(object.$collections).map(([name, items]) => [name, [...items].map(value)])),
      templateRoot: (object.$values.$templateRoot ?? object.$templateRoot)?.$node.id,
      templateOwner: (object.$values.$templateOwner ?? object.$templateOwner)?.$node.id,
      drawing: object.$drawing ?? []
    }))};
  }

  function invoke(object, name, args) {
    if (name === 'GetValue') return {handled: true, value: storeFor(object).getValue(propertyFor(object, args[0]))};
    if (name === 'ReadLocalValue') return {handled: true, value: storeFor(object).readLocalValue(propertyFor(object, args[0]))};
    if (name === 'SetValue') { set(object, args[0], args[1]); return {handled: true}; }
    if (name === 'ClearValue') { clear(object, args[0]); return {handled: true}; }
    if (name === 'ApplyTemplate') return {handled: true, value: applyTemplate(object)};
    if (name === 'GetTemplateChild') return {handled: true, value: templates.hostFor(object).getTemplateChild(args[0])};
    if (!context && object?.$node?.type === framework.CONTROLS + 'ControlTemplate' && name === 'Bind') {
      const [part, target, handle] = args;
      const source = context?.unwrapModel(handle) ?? handle;
      storeFor(part).assertProperty(propertyFor(part, target), true);
      registry.resolve(source);
      part.$bindings = {...part.$bindings, [target]: source.name};
      templates.invalidate(object);
      return {handled: true};
    }
    return {handled: false};
  }

  const dp = (owner, name) => {
    const token = registry.lookup(models.typeName(owner), name);
    return token && context ? context.wrapModel(token, framework.XAML + 'DependencyProperty') : token;
  };
  return {registry, storeFor, dp, unset: UnsetValue,
    set, clear, setSource, clearSource, setReadOnly, initializeDefault, validate, invoke, refresh, bindings, scene, parent,
    dispose, disposeOwner, assertCollectionMutable, bindingOperations, templates, styleModels: models, valueChanged};
}
