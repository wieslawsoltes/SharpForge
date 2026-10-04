import {AnimationClock, easing, propertiesFor, frameworkAssignable, XAML, MEDIA} from '@sharpforge/framework';
import {FrameScheduler, cubicBezier, readEasing} from '@sharpforge/rendering';
import {javascriptTimelineDefinition} from './definition.js';

const A = MEDIA + 'Animation.';
const independent = new Set(['Opacity', '$Left', '$Top', 'X', 'Y', 'TranslateX', 'TranslateY', 'ScaleX', 'ScaleY', 'Angle', 'Rotation']);
const nonnegative = new Set(['Width', 'Height', 'MinWidth', 'MinHeight', 'MaxWidth', 'MaxHeight', 'FontSize', 'ItemWidth', 'ItemHeight']);
const kinds = Object.freeze({Double: ['double', 'float'], Color: ['Windows.UI.Color'], Point: ['Windows.Foundation.Point'], Object: null});

/** App-owned clock and scheduling share the host's frame phases and keep DP animation slots separate. */
export function createAnimationSystem({objects, styles, send, host, options = {}, sourceAccess}) {
  const window = host.document.defaultView;
  const supplied = host.services?.scheduler ?? host.scheduler ?? options.scheduler;
  const scheduler = supplied ?? new FrameScheduler({
    requestFrame: callback => (window.requestAnimationFrame ?? (fn => window.setTimeout(() => fn(window.performance.now()), 16))).call(window, callback),
    cancelFrame: id => (window.cancelAnimationFrame ?? window.clearTimeout).call(window, id),
    now: () => window.performance.now(), onError: error => options.onError?.(error)
  });
  const key = {};
  let disposed = false;
  const resolve = id => {
    const object = objects.get(id);
    if (!object) throw new TypeError('Animation target was disposed');
    return object;
  };
  const apply = (object, name, input) => {
    let value = input;
    if (name === 'Opacity') value = Math.max(0, Math.min(1, value));
    if (nonnegative.has(name)) value = Math.max(0, value);
    const projected = independent.has(name) && typeof host.applyCompositionProperty === 'function';
    if (sourceAccess) sourceAccess.write(object, name, value, {independent: projected});
    else object.$values[name] = value;
    if (projected) host.applyCompositionProperty(object.$node.id, name, value);
    else if (!sourceAccess) send({op: 'set', id: object.$node.id, property: name.replace(/^\$/, ''), value});
    if (!projected) styles.bindings(object);
  };
  const clock = new AnimationClock({
    key: id => id, read: (id, name) => sourceAccess?.read(resolve(id), name) ?? resolve(id).$values[name] ?? (name.startsWith('$') ? 0 : null),
    readBase: (id, name) => sourceAccess?.base(resolve(id), name)
      ?? clock.bases.get(clock.key(id, name))?.value ?? resolve(id).$values[name] ?? (name.startsWith('$') ? 0 : null),
    validate: (id, name, kind = 'Double') => {
      const object = resolve(id);
      if (['$Left', '$Top'].includes(name)) {
        if (!frameworkAssignable(XAML + 'UIElement', object.$node.type) || kind !== 'Double') throw new TypeError('Numeric UIElement target required');
        return;
      }
      const property = propertiesFor(object.$node.type)[name];
      if (!property || property.readOnly || (kinds[kind] && !kinds[kind].includes(property.type))) {
        throw new TypeError(`${kind} animation requires a compatible writable property`);
      }
    },
    write: (id, name, value) => apply(resolve(id), name, value),
    clear: (id, name) => {
      const object = resolve(id);
      if (independent.has(name)) host.applyCompositionProperty?.(id, name, undefined);
      if (sourceAccess) sourceAccess.clear(object, name, {independent: false});
      else {
        const value = clock.bases.get(clock.key(id, name))?.value ?? object.$values[name];
        object.$values[name] = value;
        send({op: 'set', id, property: name.replace(/^\$/, ''), value});
        styles.bindings(object);
      }
    },
    completed: id => {
      const object = objects.get(id);
      if (!object) return;
      for (const callback of [...(object.$events.Completed ?? [])]) {
        try { callback(object, {OriginalSource: object, Handled: false}); }
        catch (error) { options.onError?.(error); }
      }
    }
  });
  const schedule = () => scheduler.setContinuous(key, !disposed && !options.animationManual && clock.running);
  const removeAnimation = scheduler.register('animation', key, context => {
    if (disposed || options.animationManual) return;
    try { clock.advance(context.delta); }
    catch (error) { clock.clear(); options.onError?.(error); }
    schedule();
  });
  const invoke = (object, descriptor, args) => invokeTimeline({object, descriptor, args, objects, styles, clock, schedule});
  return {
    clock, scheduler, invoke,
    advance(milliseconds) { clock.advance(milliseconds); host.flush(); schedule(); return clock.running; },
    setBase(object, name, value) { return clock.setBase(object.$node.id, name, value); },
    getBase(object, name) { return clock.getBase(object.$node.id, name); },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeAnimation();
      scheduler.setContinuous(key, false);
      clock.clear();
      if (!supplied) scheduler.dispose();
    }
  };
}

function invokeTimeline({object, descriptor, args, objects, styles, clock, schedule}) {
  if (descriptor.kind === 'animationTarget' || descriptor.kind === 'animationTargetGet') {
    const target = args[0];
    if (target?.$context !== objects) throw new TypeError('Timeline belongs to another app');
    const key = '$target' + (descriptor.property === 'Target' ? '' : descriptor.property.slice(6));
    if (descriptor.kind === 'animationTargetGet') return {handled: true, value: target[key] ?? null};
    const value = args[1];
    if (descriptor.property === 'Target' && value !== null && value?.$context !== objects) throw new TypeError('Cross-app animation target');
    if (descriptor.property !== 'Target' && (typeof value !== 'string' || value.length > 512)) throw new TypeError('Invalid animation target path/name');
    target[key] = value;
    return {handled: true};
  }
  if (descriptor.owner === A + 'EasingFunctionBase' && descriptor.name === 'Ease') {
    const definition = readEasing(object, {type: value => value.$node.type, native: value => value,
      get: (value, name, fallback) => value[name] ?? fallback});
    return {handled: true, value: easing(args[0], definition)};
  }
  if (descriptor.owner === A + 'KeyTime' && descriptor.name === 'FromTimeSpan') {
    if (!(args[0]?.TotalMilliseconds >= 0)) throw new RangeError('Invalid KeyTime');
    return {handled: true, value: Object.freeze({valueType: A + 'KeyTime', TimeSpan: args[0]})};
  }
  if (descriptor.owner === A + 'KeySpline' && descriptor.kind === 'constructor') {
    const values = args.length ? args : [0, 0, 1, 1];
    cubicBezier(0.5, values.slice(0, 2), values.slice(2));
    return {handled: true, value: {ControlPoint1: {X: values[0], Y: values[1]}, ControlPoint2: {X: values[2], Y: values[3]}}};
  }
  if (descriptor.owner !== A + 'Storyboard' || descriptor.isStatic) return {handled: false};
  const id = object.$node.id;
  const operations = {
    Begin: () => clock.begin(id, javascriptTimelineDefinition(object, objects, styles)), Pause: () => clock.pause(id), Resume: () => clock.resume(id),
    Stop: () => clock.stop(id), SkipToFill: () => clock.skipToFill(id),
    Seek: () => clock.seek(id, args[0]?.TotalMilliseconds), SeekAlignedToLastTick: () => clock.seek(id, args[0]?.TotalMilliseconds),
    GetCurrentState: () => clock.state(id).state,
    GetCurrentTime: () => Object.freeze({valueType: 'System.TimeSpan', TotalMilliseconds: clock.state(id).currentTime,
      TotalSeconds: clock.state(id).currentTime / 1000})
  };
  if (!operations[descriptor.name]) return {handled: false};
  const result = operations[descriptor.name]();
  schedule();
  return {handled: true, value: descriptor.name.startsWith('Get') ? result : undefined};
}
