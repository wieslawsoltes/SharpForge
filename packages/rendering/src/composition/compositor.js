import {ResourceTable} from '../resources/resource-table.js';
import {ContainerVisual, SpriteVisual, ShapeVisual, LayerVisual} from './visual.js';
import {CompositionPropertySet} from './property-set.js';
import * as brushes from './brushes.js';
import * as geometries from './geometries.js';
import {InsetClip, RectangleClip, GeometricClip} from './clips.js';
import {CompositionEffectFactory} from './effects.js';
import {DropShadow} from './shadows.js';
import {createCompositionLight} from './lights.js';
import {matrix2D} from './values.js';
import {encodeCompositionContent, encodeCompositionLayers} from './content.js';
import {CompositionAnimationEngine} from '../animation/composition-engine.js';
import {KeyFrameAnimation, CompositionEasingFunction} from './keyframe-animations.js';
import {ExpressionAnimation} from './expression-animation.js';
import {CompositionAnimationGroup, CompositionScopedBatch, ImplicitAnimationCollection} from './implicit-animations.js';

/** Retained visuals own drawing state independently of XAML layout and managed property slots. */
export class Compositor {
  constructor({clockFactory, scheduler, resources, encodeContent = encodeCompositionContent, onRender, onInvalidate, maxVisuals = 10000} = {}) {
    this.kind = 'Compositor';
    this.clockFactory = clockFactory;
    this.scheduler = scheduler;
    this.resources = resources ?? new ResourceTable();
    this.ownsResources = !resources;
    this.encodeContent = encodeContent;
    this.onRender = onRender;
    this.onInvalidate = onInvalidate;
    this.renderPending = true;
    this.maxVisuals = maxVisuals;
    this.objects = new Map();
    this.resourceHandles = new Map();
    this.layerHandles = new Map();
    this.dependents = new Map();
    this.roots = new Set();
    this.serial = 0;
    this.closed = false;
    this.contentEncodes = 0;
    this.composites = 0;
    this.animations = new CompositionAnimationEngine(this, {clockFactory});
    this.removeAnimation = scheduler?.register('animation', this, context => this.animations.advance(context.delta));
    this.removeBuild = scheduler?.register('build', this, () => {
      if (!this.renderPending) return;
      this.renderPending = false;
      if (this.onRender) this.onRender(this.render());
    });
  }

  allocate(object) {
    if (this.closed || this.objects.size >= this.maxVisuals) throw new RangeError('Compositor object limit exceeded or disposed');
    const id = ++this.serial;
    this.objects.set(id, object);
    this.transport?.changed();
    return id;
  }

  link(owner, previous, value) {
    if (previous?.Compositor === this) {
      const users = this.dependents.get(previous);
      const count = users?.get(owner) ?? 0;
      if (count > 1) users.set(owner, count - 1);
      else users?.delete(owner);
      if (!users?.size) this.dependents.delete(previous);
    }
    if (value?.Compositor === this) {
      const users = this.dependents.get(value) ?? new Map();
      users.set(owner, (users.get(owner) ?? 0) + 1);
      this.dependents.set(value, users);
    }
  }

  invalidate(object, property, {animated = false} = {}) {
    if (this.closed) return;
    const resource = this.resourceHandles.get(object);
    if (resource) this.resources.update(resource.handle, object.descriptor());
    const pending = [...(this.dependents.get(object)?.keys() ?? [])];
    const visited = new Set();
    while (pending.length) {
      const owner = pending.pop();
      if (visited.has(owner)) continue;
      visited.add(owner);
      if (owner.contentVersion !== undefined && (!resource || property?.startsWith('Trim'))) owner.contentVersion++;
      const retained = this.resourceHandles.get(owner);
      if (retained) this.resources.update(retained.handle, owner.descriptor());
      pending.push(...(this.dependents.get(owner)?.keys() ?? []));
    }
    this.renderPending = true;
    this.onInvalidate?.(object, property, animated);
    this.scheduler?.invalidate('build');
    if (!animated) this.transport?.changed();
  }

  resource(object, kind) {
    if (object.Compositor !== this || object.closed) throw new TypeError('Foreign or disposed composition resource');
    const existing = this.resourceHandles.get(object);
    if (existing) return existing.handle;
    const handle = this.resources.register(kind, object.descriptor());
    this.resourceHandles.set(object, {handle, kind});
    return handle;
  }

  forget(object) {
    const resource = this.resourceHandles.get(object);
    const layer = this.layerHandles.get(object);
    this.resourceHandles.delete(object);
    this.layerHandles.delete(object);
    if (!this.resources.closed) {
      if (resource) this.resources.release(resource.handle);
      if (layer) this.resources.release(layer);
    }
    this.objects.delete(object.id);
    this.roots.delete(object);
    this.dependents.delete(object);
    this.transport?.changed();
  }

  attach(visual) {
    if (visual?.Compositor !== this || visual.parent || visual.closed) throw new TypeError('A parentless visual from this Compositor is required');
    this.roots.add(visual);
    this.invalidate();
  }
  detach(visual) { this.roots.delete(visual); this.invalidate(); }

  layerFor(visual, depth = 0) {
    if (visual?.Compositor !== this) throw new TypeError('Visual belongs to another Compositor');
    if (depth > 256) throw new RangeError('Composition visual depth limit exceeded');
    if (visual.closed || !visual.IsVisible) return null;
    if (visual.encodedVersion !== visual.contentVersion) {
      visual.content = this.encodeContent(visual, this);
      visual.encodedVersion = visual.contentVersion;
      this.contentEncodes++;
      const data = {displayList: visual.content, cacheKey: 'composition:' + visual.id, bounds: visual.content.bounds,
        contentVersion: visual.contentVersion, shadow: visual.Shadow?.descriptor() ?? null};
      const handle = this.layerHandles.get(visual);
      if (handle) this.resources.update(handle, data);
      else this.layerHandles.set(visual, this.resources.register('layer', data));
    }
    return {id: visual.id, transform: matrix2D(visual.matrix()), opacity: visual.Opacity,
      clip: visual.Clip?.descriptor(visual.Size), displayList: visual.content, resource: this.layerHandles.get(visual),
      children: [...(visual.Children ?? [])].map(child => this.layerFor(child, depth + 1)).filter(Boolean)};
  }
  layers() { return [...this.roots].map(visual => this.layerFor(visual)).filter(Boolean); }

  render() { this.renderPending = false; this.composites++; return encodeCompositionLayers(this.layers()); }
  advance(milliseconds) { this.animations.advance(milliseconds); return this.render(); }

  CreateContainerVisual() { return new ContainerVisual(this); }
  CreateSpriteVisual() { return new SpriteVisual(this); }
  CreateShapeVisual() { return new ShapeVisual(this); }
  CreateLayerVisual() { return new LayerVisual(this); }
  CreatePropertySet() { return new CompositionPropertySet(this); }
  CreateColorBrush(value) { return new brushes.CompositionColorBrush(this, value); }
  CreateLinearGradientBrush() { return new brushes.CompositionLinearGradientBrush(this); }
  CreateRadialGradientBrush() { return new brushes.CompositionRadialGradientBrush(this); }
  CreateColorGradientStop(offset, value) { return new brushes.CompositionColorGradientStop(this, offset, value); }
  CreateSurfaceBrush(surface) { return new brushes.CompositionSurfaceBrush(this, surface); }
  CreateNineGridBrush() { return new brushes.CompositionNineGridBrush(this); }
  CreateBackdropBrush() { return new brushes.CompositionBackdropBrush(this); }
  CreateMaskBrush() { return new brushes.CompositionMaskBrush(this); }
  CreateRectangleGeometry() { return new geometries.CompositionRectangleGeometry(this); }
  CreateRoundedRectangleGeometry() { return new geometries.CompositionRoundedRectangleGeometry(this); }
  CreateEllipseGeometry() { return new geometries.CompositionEllipseGeometry(this); }
  CreateLineGeometry() { return new geometries.CompositionLineGeometry(this); }
  CreatePathGeometry(path) { return new geometries.CompositionPathGeometry(this, path); }
  CreateSpriteShape(geometry) { return new geometries.CompositionSpriteShape(this, geometry); }
  CreateContainerShape() { return new geometries.CompositionContainerShape(this); }
  CreateInsetClip(...args) { return new InsetClip(this, ...args); }
  CreateRectangleClip() { return new RectangleClip(this); }
  CreateGeometricClip(geometry) { return new GeometricClip(this, geometry); }
  CreateEffectFactory(graph, properties) { return new CompositionEffectFactory(this, graph, properties); }
  CreateDropShadow() { return new DropShadow(this); }
  CreateAmbientLight() { return createCompositionLight('AmbientLight'); }
  CreatePointLight() { return createCompositionLight('PointLight'); }
  CreateSpotLight() { return createCompositionLight('SpotLight'); }
  CreateDistantLight() { return createCompositionLight('DistantLight'); }
  CreateScalarKeyFrameAnimation() { return new KeyFrameAnimation(this, 'Scalar'); }
  CreateVector2KeyFrameAnimation() { return new KeyFrameAnimation(this, 'Vector2'); }
  CreateVector3KeyFrameAnimation() { return new KeyFrameAnimation(this, 'Vector3'); }
  CreateVector4KeyFrameAnimation() { return new KeyFrameAnimation(this, 'Vector4'); }
  CreateColorKeyFrameAnimation() { return new KeyFrameAnimation(this, 'Color'); }
  CreateQuaternionKeyFrameAnimation() { return new KeyFrameAnimation(this, 'Quaternion'); }
  CreateExpressionAnimation(expression) { return new ExpressionAnimation(this, expression); }
  CreateLinearEasingFunction() { return new CompositionEasingFunction('Linear'); }
  CreateCubicBezierEasingFunction(first, second) { return new CompositionEasingFunction('CubicBezier', {first, second}); }
  CreateStepEasingFunction(steps = 1) { return new CompositionEasingFunction('Step', {steps}); }
  CreateImplicitAnimationCollection() { return new ImplicitAnimationCollection(this); }
  CreateAnimationGroup() { return new CompositionAnimationGroup(this); }
  CreateScopedBatch() { return new CompositionScopedBatch(this); }

  *retainedValues() { yield* this.roots; yield* this.animations.retainedValues(); }
  snapshot() {
    return {objects: [...this.objects].map(([id, object]) => ({id, object, state: object.snapshot()})),
      roots: [...this.roots], serial: this.serial, animations: this.animations.snapshot()};
  }
  restore(snapshot) {
    const retained = new Set(snapshot.objects.map(entry => entry.object));
    for (const object of this.objects.values()) if (!retained.has(object)) object.dispose();
    this.closed = false;
    this.objects = new Map(snapshot.objects.map(entry => [entry.id, entry.object]));
    this.roots = new Set(snapshot.roots);
    this.serial = Math.max(this.serial, snapshot.serial);
    this.dependents.clear();
    for (const entry of this.resourceHandles.values()) {
      if (!this.resources.closed) this.resources.release(entry.handle);
    }
    this.resourceHandles.clear();
    if (!this.resources.closed) for (const handle of this.layerHandles.values()) this.resources.release(handle);
    this.layerHandles.clear();
    if (this.resources.closed && this.ownsResources) this.resources = new ResourceTable();
    for (const entry of snapshot.objects) entry.object.restore(entry.state);
    for (const object of this.objects.values()) {
      for (const value of Object.values(object.baseValues ?? {})) this.link(object, null, value);
      for (const value of [...(object.Shapes ?? []), ...(object.ColorStops ?? [])]) this.link(object, null, value);
      for (const value of object.sources?.values() ?? []) this.link(object, null, value);
    }
    this.animations.restore(snapshot.animations);
    this.invalidate();
  }

  async dispose() {
    if (this.closed) return;
    this.transport?.dispose();
    this.animations.dispose();
    this.removeAnimation?.();
    this.removeBuild?.();
    this.scheduler?.setContinuous(this, false);
    for (const object of [...this.objects.values()]) object.dispose();
    this.closed = true;
    this.objects.clear();
    this.roots.clear();
    this.dependents.clear();
    if (this.ownsResources) await this.resources.dispose();
    else await Promise.all([...this.resourceHandles.values()].map(entry => this.resources.release(entry.handle))
      .concat([...this.layerHandles.values()].map(handle => this.resources.release(handle))));
    this.resourceHandles.clear();
    this.layerHandles.clear();
  }
}
