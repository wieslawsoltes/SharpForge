import {easing, XAML, MEDIA} from '@sharpforge/framework';
import {ManagedFault} from '../heap.js';
import {readEasing, cubicBezier} from '@sharpforge/rendering';
import {managedTimelineDefinition, animationIdentity} from './managed-definition.js';
import {advanceManagedAnimations} from './managed-clock.js';

const A = MEDIA + 'Animation.';
const handled = value => ({handled: true, value});
const missing = Object.freeze({handled: false});
const finite = (value, name, min = 0, max = 1e12) => {
  if (!Number.isFinite(value) || value < min || value > max) throw new ManagedFault('ArgumentOutOfRangeException', name);
  return value;
};
const time = (platform, reference) => reference ? platform.native(platform.get(reference, 'TotalMilliseconds')) : 0;
const span = (platform, value) => platform.make('System.TimeSpan', {TotalMilliseconds: platform.managed(value, 'double')});

function invokeTimeValue(platform, descriptor, args) {
  const owner = descriptor.owner;
  if (owner === 'System.TimeSpan') {
    if (descriptor.name === 'get_Zero') return handled(span(platform, 0));
    if (descriptor.isStatic) {
      const factor = ({FromMilliseconds: 1, FromSeconds: 1000, FromMinutes: 60000})[descriptor.name];
      if (!factor) return missing;
      return handled(span(platform, finite(platform.native(args[0]) * factor, 'TimeSpan', -1e12)));
    }
    if (descriptor.name === 'get_TotalSeconds') return handled(platform.managed(time(platform, args[0]) / 1000, 'double'));
    return missing;
  }
  if (owner === XAML + 'Duration') {
    if (descriptor.isStatic) return handled(platform.make(owner, {$durationKind: descriptor.property === 'Automatic' ? 'auto' : 'forever'}));
    if (descriptor.kind === 'constructor') {
      finite(time(platform, args[0]), 'Duration');
      return handled(platform.make(owner, {TimeSpan: args[0]}));
    }
    if (descriptor.property === 'TimeSpan' && platform.get(args[0], '$durationKind')) throw new TypeError('Automatic/Forever Duration has no finite TimeSpan');
  }
  if (owner === A + 'RepeatBehavior') {
    if (descriptor.isStatic) return handled(platform.make(owner, {$forever: true}));
    if (descriptor.kind !== 'constructor') return missing;
    if (descriptor.parameters[0] === 'double') {
      const count = finite(platform.native(args[0]), 'RepeatBehavior count', 0, 1e6);
      return handled(platform.make(owner, {Count: platform.managed(count, 'double')}));
    }
    finite(time(platform, args[0]), 'RepeatBehavior duration');
    return handled(platform.make(owner, {$repeatDuration: true, Duration: args[0], Count: platform.managed(1, 'double')}));
  }
  if (owner === A + 'KeyTime' && descriptor.name === 'FromTimeSpan') {
    finite(time(platform, args[0]), 'KeyTime');
    return handled(platform.make(owner, {TimeSpan: args[0]}));
  }
  return missing;
}

function invokeStoryboard(platform, descriptor, args) {
  if (descriptor.owner !== A + 'Storyboard' || descriptor.kind !== 'method' || descriptor.isStatic) return missing;
  const reference = args[0];
  const id = animationIdentity(reference);
  const independent = platform.ui?.services?.independentTimelines;
  if (descriptor.name === 'Begin') {
    const definition = managedTimelineDefinition(platform, reference);
    if (independent?.begin(id, definition)) return handled(null);
  } else if (independent?.control(id, descriptor.name, args[1] ? time(platform, args[1]) : undefined)) return handled(null);
  const operations = {
    Begin: () => platform.animations.begin(id, managedTimelineDefinition(platform, reference)),
    Pause: () => platform.animations.pause(id), Resume: () => platform.animations.resume(id),
    Stop: () => platform.animations.stop(id), SkipToFill: () => platform.animations.skipToFill(id),
    Seek: () => platform.animations.seek(id, time(platform, args[1])),
    SeekAlignedToLastTick: () => platform.animations.seek(id, time(platform, args[1])),
    GetCurrentTime: () => span(platform, (independent?.state(id) ?? platform.animations.state(id)).currentTime),
    GetCurrentState: () => (independent?.state(id) ?? platform.animations.state(id)).state
  };
  if (!operations[descriptor.name]) return missing;
  return handled(platform.styleMutation(() => {
    const value = operations[descriptor.name]();
    return descriptor.name.startsWith('Get') ? value : null;
  }));
}

export function invokeAnimation(platform, descriptor, args) {
  try {
    const value = invokeTimeValue(platform, descriptor, args);
    if (value.handled) return value;
    if (descriptor.owner === 'SharpForge.UI.AnimationClock') return handled((advanceManagedAnimations(platform, platform.native(args[0])), null));
    if (descriptor.kind === 'animationTarget') {
      const [reference, target] = args;
      platform.record(reference);
      if (descriptor.property === 'Target' && target !== null) platform.record(target);
      platform.set(reference, '$' + descriptor.property, target);
      return handled(null);
    }
    if (descriptor.kind === 'animationTargetGet') return handled(platform.get(args[0], '$' + descriptor.property));
    if (descriptor.owner === A + 'EasingFunctionBase' && descriptor.name === 'Ease') {
      const definition = readEasing(args[0], {type: ref => platform.record(ref).type,
        get: (ref, name, fallback) => platform.get(ref, name, fallback), native: value => platform.native(value)});
      return handled(platform.managed(easing(platform.native(args[1]), definition), 'double'));
    }
    if (descriptor.owner === A + 'KeySpline' && descriptor.kind === 'constructor') {
      const values = args.length ? args.map(value => platform.native(value)) : [0, 0, 1, 1];
      cubicBezier(0.5, values.slice(0, 2), values.slice(2));
      const first = platform.make('Windows.Foundation.Point', {X: values[0], Y: values[1]});
      return handled(platform.heap.withRoots([first], () => platform.make(descriptor.owner, {ControlPoint1: first,
        ControlPoint2: platform.make('Windows.Foundation.Point', {X: values[2], Y: values[3]})})));
    }
    return invokeStoryboard(platform, descriptor, args);
  } catch (error) {
    if (error instanceof ManagedFault) throw error;
    throw new ManagedFault('InvalidOperationException', error.message);
  }
}
