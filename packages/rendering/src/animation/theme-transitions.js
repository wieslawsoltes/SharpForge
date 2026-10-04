const definitions = Object.freeze({
  EntranceThemeTransition: {duration: 250, horizontal: 0, vertical: 24, fade: true},
  ContentThemeTransition: {duration: 180, horizontal: 0, vertical: 12, fade: true},
  RepositionThemeTransition: {duration: 250, horizontal: 0, vertical: 0, fade: false},
  AddDeleteThemeTransition: {duration: 180, horizontal: 0, vertical: 16, fade: true},
  PopupThemeTransition: {duration: 150, horizontal: 0, vertical: 8, fade: true},
  FadeInThemeAnimation: {duration: 180, horizontal: 0, vertical: 0, fade: true},
  FadeOutThemeAnimation: {duration: 180, horizontal: 0, vertical: 0, fade: true, exit: true}
});

export class ThemeTransition {
  constructor(kind, options = {}) {
    if (!Object.hasOwn(definitions, kind)) throw new TypeError(`Unsupported theme transition: ${kind}`);
    this.kind = 'Microsoft.UI.Xaml.Media.Animation.' + kind;
    this.definition = {...definitions[kind], ...options};
    this.FromHorizontalOffset = this.definition.horizontal;
    this.FromVerticalOffset = this.definition.vertical;
    this.IsStaggeringEnabled = true;
  }
  snapshot() {
    return {definition: {...this.definition}, horizontal: this.FromHorizontalOffset, vertical: this.FromVerticalOffset,
      staggering: this.IsStaggeringEnabled};
  }
  restore(snapshot) {
    this.definition = {...snapshot.definition};
    this.FromHorizontalOffset = snapshot.horizontal;
    this.FromVerticalOffset = snapshot.vertical;
    this.IsStaggeringEnabled = snapshot.staggering;
  }
}

/** Control lifecycle calls this coordinator after layout; motion never changes layout properties. */
export class ThemeTransitionCoordinator {
  constructor(compositor, {getVisual, transitionsFor = (element, name) => element?.[name] ?? [],
    reducedMotion = () => false, durationScale = 1, keyFor = value => value} = {}) {
    this.compositor = compositor;
    this.getVisual = getVisual;
    this.transitionsFor = transitionsFor;
    this.reducedMotion = reducedMotion;
    this.durationScale = durationScale;
    this.keyFor = keyFor;
    this.active = new Map();
  }

  start(element, transitions, {previousOffset, removing = false, index = 0} = {}) {
    if (!transitions?.length || this.reducedMotion()) { this.cancel(element); return null; }
    if (typeof this.getVisual !== 'function') throw new TypeError('Theme transitions require an element-visual bridge');
    for (const transition of transitions) {
      if (!(transition instanceof ThemeTransition)) throw new TypeError('A supported theme transition is required');
      const duration = transition.definition.duration * this.durationScale;
      if (!Number.isFinite(duration) || duration < 0 || duration > 60000) throw new RangeError('Invalid theme transition duration');
    }
    const key = this.keyFor(element), visual = this.getVisual(element);
    this.cancel(element);
    const batch = this.compositor.CreateScopedBatch();
    const properties = new Set();
    const animations = [];
    for (const transition of transitions) {
      if (!(transition instanceof ThemeTransition)) throw new TypeError('A supported theme transition is required');
      const definition = transition.definition;
      const duration = definition.duration * this.durationScale;
      if (!Number.isFinite(duration) || duration < 0 || duration > 60000) throw new RangeError('Invalid theme transition duration');
      const delay = transition.IsStaggeringEnabled ? Math.min(index, 10) * 20 : 0;
      const offset = visual.Offset;
      const from = previousOffset ?? [offset[0] + transition.FromHorizontalOffset, offset[1] + transition.FromVerticalOffset, offset[2]];
      if (from.some((value, component) => value !== offset[component])) {
        const animation = this.compositor.CreateVector3KeyFrameAnimation();
        animation.Duration = duration;
        animation.DelayTime = delay;
        animation.InsertKeyFrame(0, from);
        animation.InsertKeyFrame(1, offset);
        animations.push(animation);
        visual.StartAnimation('Offset', animation);
        properties.add('Offset');
      }
      if (definition.fade) {
        const animation = this.compositor.CreateScalarKeyFrameAnimation();
        animation.Duration = duration;
        animation.DelayTime = delay;
        animation.InsertKeyFrame(0, removing || definition.exit ? visual.Opacity : 0);
        animation.InsertKeyFrame(1, removing || definition.exit ? 0 : visual.Opacity);
        animations.push(animation);
        visual.StartAnimation('Opacity', animation);
        properties.add('Opacity');
      }
    }
    const record = {visual, properties, batch, animations, element};
    this.active.set(key, record);
    batch.add_Completed(() => {
      if (this.active.get(key) !== record) return;
      this.cancel(element);
    });
    batch.End();
    return batch;
  }
  childAdded(panel, element, index = 0) { return this.start(element, [...(this.transitionsFor(panel, 'ChildrenTransitions').length
      ? this.transitionsFor(panel, 'ChildrenTransitions') : this.transitionsFor(element, 'Transitions'))], {index}); }
  contentChanged(element) { return this.start(element, [...this.transitionsFor(element, 'Transitions')]); }
  repositioned(element, previousOffset) { return this.start(element, [...this.transitionsFor(element, 'Transitions')], {previousOffset}); }
  childRemoved(panel, element) { return this.start(element, [...(this.transitionsFor(panel, 'ChildrenTransitions').length
      ? this.transitionsFor(panel, 'ChildrenTransitions') : this.transitionsFor(element, 'Transitions'))], {removing: true}); }
  cancel(element) {
    const key = this.keyFor(element), record = this.active.get(key);
    if (!record) return;
    this.active.delete(key);
    for (const property of record.properties) this.compositor.animations.stop(record.visual, property, {restoreBase: true});
    record.batch.dispose();
    for (const animation of record.animations) animation.dispose();
  }
  *retainedValues() {
    yield this.compositor;
    for (const record of this.active.values()) yield record.element;
  }
  snapshot() { return [...this.active]; }
  restore(snapshot) { this.active = new Map(snapshot); }
  dispose() { for (const record of this.active.values()) this.cancel(record.element); }
}

export const themeTransitionKinds = Object.freeze(Object.keys(definitions));
