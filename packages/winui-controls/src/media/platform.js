import { ControlEvents, ControlError, registerFamily, stateFor, controlName, createPart } from '../policy/events.js';

/** Platform adapters are explicit capabilities with deterministic ownership and cancellation. */
export class PlatformControlSession extends ControlEvents {
  constructor(kind, { platform = {}, policy } = {}) {
    super(); this.kind = kind; this.platform = platform; this.policy = policy; this.controller = new AbortController();
    this.lease = null;
  }
  async attach(element, properties = {}) {
    this.controller.signal.throwIfAborted();
    const adapter = this.platform[this.kind];
    if (typeof adapter?.attach !== 'function') {
      throw new ControlError('SFUI16B9', `${this.kind} requires an explicit host adapter`, { capability: this.kind });
    }
    if (adapter.permission && !await this.policy?.authorize(adapter.permission, { control: this.kind }, { signal: this.controller.signal })) {
      throw new ControlError('SFUI1632', `${this.kind} permission was denied`, { capability: adapter.permission });
    }
    const lease = await adapter.attach(element, properties, { signal: this.controller.signal,
      emit: (event, args) => this.emit(event, args) });
    if (this.controller.signal.aborted) { lease?.dispose?.(); return false; }
    this.lease = lease;
    return true;
  }
  invoke(name, args = []) {
    if (!this.lease || typeof this.lease[name] !== 'function') {
      throw new ControlError('SFUI16BA', `${this.kind}.${name} is unavailable in the attached host adapter`);
    }
    return this.lease[name](...args);
  }
  snapshot() { throw new ControlError('SFUI16BB', `Snapshot requires a serializable ${this.kind} host adapter`); }
  dispose() { this.controller.abort(); this.lease?.dispose?.(); this.lease = null; super.dispose(); }
}

/** Bounded pressure samples are inspectable; no browser globals are retained by the model. */
export class InkStrokeModel extends ControlEvents {
  constructor({ maximumPoints = 100_000 } = {}) {
    super();
    if (!Number.isSafeInteger(maximumPoints) || maximumPoints < 1 || maximumPoints > 1_000_000) {
      throw new ControlError('SFUI16BD', 'Invalid ink point budget');
    }
    this.maximumPoints = maximumPoints;
    this.strokes = [];
    this.active = new Map();
    this.pointCount = 0;
  }
  begin(id, point) {
    if (!Number.isFinite(point.size ?? 2) || (point.size ?? 2) <= 0 || (point.size ?? 2) > 256) {
      throw new ControlError('SFUI16BC', 'Ink thickness must be between zero and 256');
    }
    if (this.active.has(id)) this.end(id, true);
    const stroke = { points: [], color: point.color ?? '#000000', size: point.size ?? 2 };
    this.active.set(id, stroke); this.append(id, point); return stroke;
  }
  append(id, point) {
    const stroke = this.active.get(id);
    if (!stroke) return false;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.pressure ?? 0.5)) {
      throw new ControlError('SFUI16BC', 'Ink coordinates and pressure must be finite');
    }
    if (this.pointCount >= this.maximumPoints) throw new ControlError('SFUI16BD', 'Ink point budget exceeded');
    stroke.points.push({ x: point.x, y: point.y, pressure: Math.max(0, Math.min(1, point.pressure ?? 0.5)) });
    this.pointCount++;
    return true;
  }
  end(id, cancelled = false) {
    const stroke = this.active.get(id);
    if (!stroke) return false;
    this.active.delete(id);
    if (!cancelled) { this.strokes.push(stroke); this.emit('StrokesCollected', { Strokes: [stroke] }); }
    else this.pointCount -= stroke.points.length;
    return true;
  }
  clear() {
    const removed = this.strokes;
    this.strokes = [];
    this.active.clear();
    this.pointCount = 0;
    this.emit('StrokesErased', { Strokes: removed });
  }
  snapshot() { return { version: 1, strokes: structuredClone(this.strokes), active: structuredClone([...this.active]) }; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI16BC', 'Invalid ink snapshot');
    const strokes = structuredClone(snapshot.strokes);
    const active = new Map(structuredClone(snapshot.active));
    let count = strokes.reduce((total, stroke) => total + stroke.points.length, 0);
    for (const stroke of active.values()) count += stroke.points.length;
    if (count > this.maximumPoints) throw new ControlError('SFUI16BD', 'Ink snapshot exceeds its point budget');
    this.strokes = strokes;
    this.active = active;
    this.pointCount = count;
  }
}

function inkState(context, node) {
  return stateFor(context, node, 'ink', () => {
    const model = new InkStrokeModel();
    for (const name of ['StrokesCollected', 'StrokesErased']) model.on(name, args => context.emit(node, name, args));
    return model;
  });
}

function renderInk(context, node, element) {
  const model = inkState(context, node);
  const ratio = context.document.defaultView?.devicePixelRatio || 1;
  const width = Math.max(1, element.clientWidth || node.properties.Width || 320);
  const height = Math.max(1, element.clientHeight || node.properties.Height || 200);
  if (width * height * ratio * ratio > 16_777_216) throw new ControlError('SFUI16B1', 'Ink canvas exceeds its pixel budget');
  element.width = Math.ceil(width * ratio); element.height = Math.ceil(height * ratio);
  element.style.touchAction = 'none';
  const draw = element.getContext('2d');
  draw.setTransform(ratio, 0, 0, ratio, 0, 0); draw.lineCap = draw.lineJoin = 'round';
  for (const stroke of [...model.strokes, ...model.active.values()]) {
    draw.strokeStyle = stroke.color;
    for (let index = 1; index < stroke.points.length; index++) {
      const a = stroke.points[index - 1], b = stroke.points[index];
      draw.lineWidth = stroke.size * Math.max(0.1, b.pressure * 2);
      draw.beginPath(); draw.moveTo(a.x, a.y); draw.lineTo(b.x, b.y); draw.stroke();
    }
  }
}

function inkPointer(context, node, element, event) {
  if (node.properties.IsEnabled === false) return false;
  const model = inkState(context, node), bounds = element.getBoundingClientRect();
  const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top, pressure: event.pressure || 0.5,
    color: node.properties.InkColor, size: node.properties.InkSize };
  if (event.type === 'pointerdown') { element.setPointerCapture?.(event.pointerId); model.begin(event.pointerId, point); }
  else if (event.type === 'pointermove') model.append(event.pointerId, point);
  else model.end(event.pointerId, event.type === 'pointercancel');
  context.invalidate(node.id); return true;
}

export function registerPlatformRenderers(registry) {
  registerInkToolbar(registry);
  registerFamily(registry, 'InkCanvas', { create: context => context.document.createElement('canvas'), render: renderInk,
    invoke(context, node, element, method) {
      if (method !== 'Clear') return undefined;
      inkState(context, node).clear();
      context.invalidate(node.id);
      return true;
    },
    events: { pointerdown: inkPointer, pointermove: inkPointer, pointerup: inkPointer, pointercancel: inkPointer } });
  for (const kind of ['MapControl', 'CaptureElement', 'AnimatedVisualPlayer', 'AnimatedIcon']) {
    registerFamily(registry, kind, { create(context) {
      if (['MapControl', 'CaptureElement'].includes(kind) && !context.services.platform?.[kind]?.attach) {
        throw new ControlError('SFUI16B9', `${kind} requires an explicit host adapter`, { capability: kind });
      }
      return context.document.createElement('div');
    }, render(context, node, element) {
      const state = attachPlatform(context, node, element);
      state.session.lease?.update?.(node.properties);
    }, invoke(context, node, element, name, args) {
      const state = attachPlatform(context, node, element);
      return state.ready.then(() => state.session.invoke(name, args));
    } });
  }
}

function attachPlatform(context, node, element) {
  return stateFor(context, node, 'platform', () => {
    const session = new PlatformControlSession(controlName(node), { platform: context.services.platform, policy: context.services.permissions });
    const state = { session, ready: null, dispose: () => session.dispose() };
    state.ready = session.attach(element, node.properties);
    state.ready.catch(error => {
      if (session.controller.signal.aborted) return;
      element.dataset.platformUnavailable = error.code;
      const fallback = node.properties.FallbackContent ?? node.properties.FallbackIconSource;
      if (fallback) context.content(element, fallback);
      else { element.setAttribute('role', 'status'); element.textContent = error.message; }
      context.emit(node, 'PlatformUnavailable', { Code: error.code, Message: error.message });
    });
    return state;
  });
}

function registerInkToolbar(registry) {
  registerFamily(registry, 'InkToolbar', {
    create(context) {
      const root = context.document.createElement('div');
      root.setAttribute('role', 'toolbar');
      const color = createPart(context.document, 'input', 'ink-color');
      color.type = 'color';
      color.setAttribute('aria-label', 'Ink color');
      const size = createPart(context.document, 'input', 'ink-size');
      size.type = 'range';
      size.min = '1';
      size.max = '32';
      size.setAttribute('aria-label', 'Ink thickness');
      const clear = createPart(context.document, 'button', 'ink-clear');
      clear.textContent = 'Clear ink';
      root.append(color, size, clear);
      return root;
    }, render(context, node, element) {
      element.children[0].value = node.properties.InkColor ?? '#000000';
      element.children[1].value = String(node.properties.InkSize ?? 2);
      for (const child of element.children) child.disabled = node.properties.IsEnabled === false;
    }, events: { change: toolbarEvent, click: toolbarEvent }
  });
}

function toolbarEvent(context, node, element, event) {
  if (node.properties.IsEnabled === false) return false;
  const target = context.nodes.get(node.properties.TargetInkCanvas?.$ref);
  if (!target) throw new ControlError('SFUI16BC', 'InkToolbar requires a target InkCanvas');
  if (event.type === 'click' && event.target.dataset.part === 'ink-clear') inkState(context, target).clear();
  else if (event.type === 'change') {
    target.properties.InkColor = node.properties.InkColor = element.children[0].value;
    target.properties.InkSize = node.properties.InkSize = Number(element.children[1].value);
  } else return false;
  context.invalidate(target.id);
  return true;
}
