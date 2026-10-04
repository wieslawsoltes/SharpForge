import {color, vector, finite} from '../composition/values.js';

const transitionKinds = Object.freeze({ScalarTransition: 'Scalar', Vector3Transition: 'Vector3', BrushTransition: 'Color'});
const transitionProperties = Object.freeze({Opacity: ['OpacityTransition', 'Scalar'],
  Translation: ['TranslationTransition', 'Vector3'], Background: ['BackgroundTransition', 'Color']});

export class ImplicitTransition {
  constructor(kind, duration = 300) {
    if (!Object.hasOwn(transitionKinds, kind)) throw new TypeError('Unsupported implicit transition');
    this.kind = 'Microsoft.UI.Xaml.' + kind;
    this.valueKind = transitionKinds[kind];
    this.Duration = duration;
  }
  snapshot() { return {duration: this.Duration}; }
  restore(snapshot) { this.Duration = snapshot.duration; }
}

/** Base-property changes create one compositor animation; individual frames never write managed slots. */
export class ImplicitTransitionCoordinator {
  constructor(compositor, {getVisual, getTransition, getColorBrush, setBrush, reducedMotion = () => false, keyFor = value => value} = {}) {
    this.compositor = compositor;
    this.getVisual = getVisual;
    this.getTransition = getTransition;
    this.getColorBrush = getColorBrush;
    this.setBrush = setBrush;
    this.reducedMotion = reducedMotion;
    this.keyFor = keyFor;
    this.active = new Map();
  }

  propertyChanged(element, property, previous, next) {
    const specification = Object.hasOwn(transitionProperties, property) ? transitionProperties[property] : null;
    if (!specification) return false;
    const transition = this.getTransition?.(element, specification[0]);
    if (!transition || this.reducedMotion()) { this.cancel(element, property); return false; }
    if (!(transition instanceof ImplicitTransition) || transition.valueKind !== specification[1]) {
      throw new TypeError('The implicit transition value type does not match its target property');
    }
    const duration = finite(transition.Duration?.TotalMilliseconds ?? transition.Duration, 'transition duration', 0, 60000);
    const visual = this.getVisual?.(element);
    if (!visual) throw new TypeError('Implicit transitions require an element-visual bridge');
    const key = this.keyFor(element), previousRecord = this.active.get(key)?.get(property);
    const prepared = this.prepare(element, property, visual, previous, next);
    if (previousRecord) prepared.from = previousRecord.target.get(previousRecord.property);
    this.cancel(element, property);
    const animation = this.compositor['Create' + transition.valueKind + 'KeyFrameAnimation']();
    animation.Duration = duration;
    animation.InsertKeyFrame(0, prepared.from);
    animation.InsertKeyFrame(1, prepared.to);
    prepared.setBase();
    const properties = this.active.get(key) ?? new Map();
    const record = {...prepared, animation, element};
    properties.set(property, record);
    this.active.set(key, properties);
    animation.add_Completed(() => {
      const current = this.active.get(key);
      if (current?.get(property) !== record) return;
      current.delete(property);
      if (!current.size) this.active.delete(key);
      this.compositor.animations.stop(prepared.target, prepared.property, {restoreBase: true});
      animation.dispose();
      prepared.release?.();
    });
    prepared.target.StartAnimation(prepared.property, animation);
    return true;
  }

  prepare(element, property, visual, previous, next) {
    if (property === 'Opacity') return {target: visual, property: 'Opacity', from: finite(previous, 'opacity', 0, 1),
      to: finite(next, 'opacity', 0, 1), setBase: () => { visual.Opacity = next; }};
    if (property === 'Translation') {
      const from = vector(previous, 3), to = vector(next, 3);
      if (!visual.Properties.values.has('Translation')) visual.Properties.InsertVector3('Translation', from);
      return {target: visual.Properties, property: 'Translation', from, to,
        setBase: () => visual.Properties.InsertVector3('Translation', to)};
    }
    if (!this.getColorBrush || !this.setBrush) throw new TypeError('Brush transitions require retained brush projection callbacks');
    const from = color(this.getColorBrush(previous)), to = color(this.getColorBrush(next));
    const brush = this.compositor.CreateColorBrush(from);
    return {target: brush, property: 'Color', from, to, setBase: () => {
      brush.Color = to;
      this.setBrush(element, 'Background', brush);
    }, release: () => { this.setBrush(element, 'Background', null); brush.dispose(); }};
  }

  cancel(element, property) {
    const key = this.keyFor(element), properties = this.active.get(key);
    const record = properties?.get(property);
    if (!record) return;
    properties.delete(property);
    if (!properties.size) this.active.delete(key);
    this.compositor.animations.stop(record.target, record.property, {restoreBase: true});
    record.animation.dispose();
    record.release?.();
  }
  *retainedValues() {
    yield this.compositor;
    for (const entries of this.active.values()) for (const record of entries.values()) yield record.element;
  }
  snapshot() { return [...this.active].map(([key, entries]) => [key, [...entries]]); }
  restore(snapshot) { this.active = new Map(snapshot.map(([key, entries]) => [key, new Map(entries)])); }
  dispose() {
    for (const entries of this.active.values()) for (const [property, record] of [...entries]) this.cancel(record.element, property);
  }
}
