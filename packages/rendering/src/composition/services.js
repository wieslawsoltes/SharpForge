import {Compositor} from './compositor.js';
import {WeakModelSet} from './weak-model-set.js';
import {ElementCompositionPreview} from './element-preview.js';
import {CompositionTransport} from './transport.js';
import {IndependentTimelineTransport} from '../animation/independent-timelines.js';
import {ThemeTransitionCoordinator} from '../animation/theme-transitions.js';
import {ImplicitTransitionCoordinator} from '../animation/implicit-transitions.js';
import {ConnectedAnimationService} from '../animation/connected-animation.js';
import {NavigationTransitionCoordinator} from '../animation/navigation-transitions.js';
import {environmentMotionOptions, subscribeCompositionEnvironment} from './environment.js';

/** Application-owned service bundle connects managed adapters, control lifecycle and rendering transport. */
export class CompositionServices {
  constructor({clockFactory, scheduler, emit, session = globalThis.crypto.randomUUID(), elementId = value => value.id, preview = {},
    onRender, onInvalidate, themes = {}, implicit = {}, connected = {}, environment = null} = {}) {
    this.clockFactory = clockFactory;
    this.scheduler = scheduler;
    this.emit = emit;
    this.session = session;
    this.environment = environment;
    themes = environmentMotionOptions(environment, themes);
    implicit = environmentMotionOptions(environment, implicit);
    connected = environmentMotionOptions(environment, connected);
    this.serial = 0;
    this.transports = new WeakModelSet();
    this.compositors = new WeakModelSet();
    this.compositor = new Compositor({clockFactory, scheduler, onRender, onInvalidate});
    this.compositors.add(this.compositor);
    this.createCompositionTransport = compositor => this.createTransport(compositor);
    this.createTransport(this.compositor)?.connect(this.compositor);
    this.compositionPreview = {keyFor: elementId, ...preview, setComposition: (element, entry, identity) => {
      if (element) preview.setComposition?.(element, entry);
      this.compositor.transport?.preview(identity?.key ?? elementId(element), entry);
    }};
    this.elementCompositionPreview = new ElementCompositionPreview(this.compositor, this.compositionPreview);
    const getVisual = element => this.elementCompositionPreview.GetElementVisual(element);
    this.themeTransitions = new ThemeTransitionCoordinator(this.compositor, {keyFor: elementId, ...themes, getVisual});
    this.implicitTransitions = new ImplicitTransitionCoordinator(this.compositor, {keyFor: elementId, ...implicit, getVisual,
      setBrush: this.emit || implicit.setBrush ? (element, property, brush) => {
        implicit.setBrush?.(element, property, brush);
        this.compositor.transport?.brush(elementId(element), property, brush);
      } : undefined});
    this.connectedAnimations = new ConnectedAnimationService(this.compositor, connected);
    this.navigationTransitions = new NavigationTransitionCoordinator(this.themeTransitions,
      {getBounds: connected.getBounds, connectedAnimations: this.connectedAnimations});
    this.independentTimelines = null;
    this.closed = false;
    this.unsubscribeEnvironment = subscribeCompositionEnvironment(environment, this);
  }
  createTransport(compositor) {
    this.compositors.add(compositor);
    if (!this.emit) return null;
    if (compositor.transport) return compositor.transport;
    const transport = new CompositionTransport({emit: this.emit, session: this.session + ':' + ++this.serial});
    this.transports.add(transport);
    return transport;
  }
  createIndependentTimelines(clock, identity) {
    if (!this.emit) return null;
    if (this.independentTimelines) throw new TypeError('An application already owns its independent timeline transport');
    this.independentTimelines = new IndependentTimelineTransport({emit: this.emit, session: this.session + ':xaml', clock, identity});
    return this.independentTimelines;
  }
  propertyChanged(element, property, previous, value) {
    if (!this.implicitTransitions.propertyChanged(element, property, previous, value)) {
      this.elementCompositionPreview.updateProperty(element, property, value);
    }
  }
  complete(value) {
    if (typeof value !== 'string') return this.independentTimelines?.complete(value) ?? false;
    for (const transport of this.transports) if (transport.complete(value)) return true;
    return false;
  }
  *retainedValues() {
    yield this.compositor;
    yield* this.themeTransitions.retainedValues();
    yield* this.implicitTransitions.retainedValues();
    yield* this.connectedAnimations.retainedValues();
    if (this.independentTimelines) yield* this.independentTimelines.retainedValues();
  }
  snapshot() {
    return {compositors: [...this.compositors].map(compositor => [compositor, compositor.snapshot()]),
      preview: this.elementCompositionPreview.snapshot(), themes: this.themeTransitions.snapshot(),
      implicit: this.implicitTransitions.snapshot(), connected: this.connectedAnimations.snapshot(),
      independent: this.independentTimelines?.snapshot(), transports: [...this.transports].map(transport => [transport, transport.snapshot()])};
  }
  restore(snapshot) {
    this.closed = false;
    this.unsubscribeEnvironment?.();
    this.unsubscribeEnvironment = subscribeCompositionEnvironment(this.environment, this);
    for (const [compositor, state] of snapshot.compositors) {
      this.compositors.add(compositor);
      compositor.restore(state);
    }
    this.elementCompositionPreview.restore(snapshot.preview);
    this.themeTransitions.restore(snapshot.themes);
    this.implicitTransitions.restore(snapshot.implicit);
    this.connectedAnimations.restore(snapshot.connected);
    if (snapshot.independent) this.independentTimelines.restore(snapshot.independent);
    for (const [transport, state] of snapshot.transports) {
      this.transports.add(transport);
      transport.restore(state);
    }
  }
  async dispose() {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeEnvironment?.();
    this.unsubscribeEnvironment = null;
    this.independentTimelines?.dispose();
    this.navigationTransitions.dispose();
    this.themeTransitions.dispose();
    this.implicitTransitions.dispose();
    this.connectedAnimations.dispose();
    this.elementCompositionPreview.dispose();
    for (const transport of this.transports) transport.dispose();
    await Promise.all([...this.compositors].map(compositor => compositor.dispose()));
    this.transports.clear();
    this.compositors.clear();
  }
}

export function createCompositionServices(options) { return new CompositionServices(options); }
