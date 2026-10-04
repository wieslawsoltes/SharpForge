import {buildTimelineDefinition, resolveAnimationTarget} from '@sharpforge/rendering';
import {frameworkAssignable, canonicalType, propertiesFor, frameworkType, CONTROLS} from '@sharpforge/framework';
import {isReference} from '../heap.js';
import {ValueSource} from '@sharpforge/winui-properties';

export const animationIdentity = reference => `${reference.h}:${reference.g}`;

export function animationProperties(platform, reference) {
  const type = platform.record(reference).type;
  return platform.ui?.propertiesFor?.(type) ?? propertiesFor(type);
}

export function animationProperty(platform, reference, name) {
  if (!platform.ui?.properties) return null;
  return name.startsWith('$') ? platform.ui.propertyRegistry.lookup(CONTROLS + 'Canvas', name.slice(1))
    : platform.ui.properties.lookup(reference, name);
}

export function animationNativeValue(platform, value) {
  if (isReference(value) && frameworkType(platform.heap.get(value).type)?.kind === 'value') return platform.exportValue(value);
  return platform.native(value);
}

export function managedAnimationTarget(platform, animation) {
  let object = platform.get(animation, '$Target');
  if (!object) {
    const name = platform.native(platform.get(animation, '$TargetName'));
    const matches = platform.scene().nodes.filter(node => node.properties.Name === name);
    if (matches.length !== 1) throw new TypeError('Animation target name is missing or ambiguous: ' + name);
    const [h, g] = matches[0].id.split(':').map(Number);
    object = {h, g};
  }
  const kind = platform.record(animation).type.split('.').at(-1);
  const path = platform.native(platform.get(animation, '$TargetProperty'))
    ?? (['FadeInThemeAnimation', 'FadeOutThemeAnimation'].includes(kind) ? 'Opacity' : null);
  return resolveAnimationTarget(object, path, {
    read: (reference, name) => platform.get(reference, name),
    property: (reference, name) => name.startsWith('$') ? {type: 'double'} : animationProperties(platform, reference)[name],
    attached: (reference, owner, name) => canonicalType(owner) === CONTROLS + 'Canvas' && ['Left', 'Top'].includes(name) ? '$' + name : null,
    ownerMatches: (reference, owner) => platform.ui?.properties?.assignable?.(canonicalType(owner), platform.record(reference).type)
      ?? frameworkAssignable(canonicalType(owner), platform.record(reference).type)
  });
}

export function managedTimelineDefinition(platform, root) {
  const time = reference => reference ? platform.native(platform.get(reference, 'TotalMilliseconds')) : null;
  return buildTimelineDefinition(root, {
    key: animationIdentity, reference: value => value,
    get: (reference, name, fallback = null) => (platform.ui ? platform.ui.read(reference, name)
      : platform.get(reference, name, fallback)) ?? fallback,
    hasValue: (reference, name) => {
      if (!platform.ui) return platform.get(reference, name) != null;
      const property = animationProperty(platform, reference, name);
      return platform.ui.storeFor(reference).getValueSource(property) !== ValueSource.Default
        || animationProperties(platform, reference)[name]?.value != null;
    },
    native: value => platform.native(value), type: reference => platform.record(reference).type,
    items: reference => reference ? platform.items(reference) : [],
    time, duration: reference => !reference || platform.get(reference, '$durationKind') === 'auto' ? null
      : platform.get(reference, '$durationKind') === 'forever' ? Infinity : time(platform.get(reference, 'TimeSpan')),
    target: reference => managedAnimationTarget(platform, reference),
    readValue: value => animationNativeValue(platform, value),
    point: reference => {
      const value = animationNativeValue(platform, reference);
      return [value?.X ?? 0, value?.Y ?? 0];
    }
  });
}
