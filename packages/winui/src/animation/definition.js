import {buildTimelineDefinition, resolveAnimationTarget} from '@sharpforge/rendering';
import {canonicalType, frameworkAssignable, propertiesFor, CONTROLS} from '@sharpforge/framework';
import {ValueSource} from '@sharpforge/winui-properties';

function get(object, name, fallback = null) {
  if (object == null) return fallback;
  if (name === '$forever') return object.kind === 'forever';
  if (name === '$repeatDuration') return !!object.Duration;
  if (name === '$percent') return object.percent ?? null;
  return object[name] ?? fallback;
}

export function javascriptAnimationTarget(animation, objects) {
  let target = animation.$target;
  if (!target) {
    const matches = [...objects.values()].filter(object => object.$values.Name === animation.$targetName);
    if (matches.length !== 1) throw new TypeError('Animation target name is missing or ambiguous');
    target = matches[0];
  }
  if (target.$context !== objects) throw new TypeError('Animation target belongs to another app');
  const kind = animation.$node.type.split('.').at(-1);
  const path = animation.$targetProperty ?? (['FadeInThemeAnimation', 'FadeOutThemeAnimation'].includes(kind) ? 'Opacity' : null);
  return resolveAnimationTarget(target, path, {
    read: (object, name) => object[name],
    property: (object, name) => name.startsWith('$') ? {type: 'double'} : propertiesFor(object.$node.type)[name],
    attached: (object, owner, name) => canonicalType(owner) === CONTROLS + 'Canvas' && ['Left', 'Top'].includes(name) ? '$' + name : null,
    ownerMatches: (object, owner) => frameworkAssignable(canonicalType(owner), object.$node.type)
  });
}

export function javascriptTimelineDefinition(root, objects, styles) {
  return buildTimelineDefinition(root, {
    key: object => {
      if (!object?.$node || object.$context !== objects) throw new TypeError('Timeline belongs to another app');
      return object.$node.id;
    },
    get, native: value => value, type: object => object.$node.type,
    hasValue: (object, name) => {
      if (!styles?.registry || !styles.storeFor) return get(object, name) != null;
      const property = styles.registry.lookup(object.$node.type, name);
      return styles.storeFor(object).getValueSource(property) !== ValueSource.Default
        || propertiesFor(object.$node.type)[name]?.value != null;
    },
    items: value => value ? [...value] : [], time: value => value?.TotalMilliseconds ?? null,
    duration: value => value?.kind === 'forever' ? Infinity : value?.TimeSpan?.TotalMilliseconds ?? null,
    target: object => javascriptAnimationTarget(object, objects), targetKey: object => object.$node.id,
    readValue: value => value, point: value => [value?.X ?? 0, value?.Y ?? 0]
  });
}
