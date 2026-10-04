import {getResourceServices, styleModel, ValueSource} from '@sharpforge/winui-properties';
import {propertiesFor, CONTROLS} from '@sharpforge/framework';
import {ManagedFault} from './heap.js';

/** Released styling entry points delegate to the shared property/template lifetime services. */
export function styleValues(platform, reference, type) {
  if (!reference) return {};
  const style = styleModel(platform.ui, reference);
  if (!platform.ui.properties.assignable(style.targetType, type)) {
    throw new ManagedFault('ArgumentException', 'Style.TargetType is incompatible with the target');
  }
  return Object.fromEntries(style.compile(platform.ui.propertyRegistry).setters.map(setter =>
    [setter.property.name, platform.ui.properties.toManaged(setter.value, setter.property.propertyType)]));
}

export function refreshStyle(platform, reference) {
  return platform.styleMutation(() => {
    const resources = getResourceServices(platform.ui);
    resources.applyStyle(reference);
    if (platform.ui.propertiesFor(platform.record(reference).type).Template) resources.templateChanged(reference);
  });
}

/** Applied styles are sealed; mutation preflight is local to the referenced definition. */
export function refreshStyles(platform, reference) {
  if (reference) getResourceServices(platform.ui).refreshStyleModel(reference);
}

export function clearProperty(platform, reference, nameOrProperty) {
  return platform.styleMutation(() => {
    const property = typeof nameOrProperty === 'string'
      ? platform.ui.properties.lookup(reference, nameOrProperty) : platform.ui.propertyRegistry.resolve(nameOrProperty);
    if (property.readOnly) throw new ManagedFault('InvalidOperationException', 'A read-only property cannot be cleared');
    platform.set(reference, '$local:' + property.name, false);
    platform.ui.properties.clearSource(reference, property, ValueSource.Local);
    if (property.name === 'Style') refreshStyle(platform, reference);
    if (property.name === 'Template') templateChanged(platform, reference);
  });
}

export function applyTemplate(platform, owner) {
  return getResourceServices(platform.ui).applyTemplate(owner);
}

export function templateChanged(platform, owner) {
  return getResourceServices(platform.ui).templateChanged(owner);
}

/** TemplateBinding follows store subscriptions; no visual-tree scan is required after a setter. */
export function updateBindings(platform, owner, property) {
  if (!property) return;
  const store = platform.ui.storeFor(owner);
  platform.ui.bindings.notifyTargetChanged(store, property, store.getValue(property));
}

export function invokeStyling(platform, descriptor, args) {
  if (descriptor.owner === CONTROLS + 'ContentDialog' && ['Show', 'Hide'].includes(descriptor.name)) {
    platform.setProperty(args[0], {owner: descriptor.owner, property: 'IsOpen'}, platform.managed(descriptor.name === 'Show', 'bool'));
    return {handled: true, value: null};
  }
  return {handled: false};
}
