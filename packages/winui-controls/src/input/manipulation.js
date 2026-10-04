import { ManipulationInertia } from './inertia.js';
import { pointerDeviceType } from './pointer-events.js';

export const ManipulationModes = Object.freeze({ None: 0, TranslateX: 1, TranslateY: 2, TranslateRailsX: 4, TranslateRailsY: 8,
  Rotate: 16, Scale: 32, TranslateInertia: 64, RotateInertia: 128, ScaleInertia: 256, All: 65535, System: 65536 });

function geometry(points) {
  let x = 0;
  let y = 0;
  for (const point of points) { x += point.x; y += point.y; }
  x /= Math.max(1, points.length);
  y /= Math.max(1, points.length);
  const first = points[0];
  const second = points[1];
  return { x, y, distance: second ? Math.hypot(second.x - first.x, second.y - first.y) : 0,
    angle: second ? Math.atan2(second.y - first.y, second.x - first.x) : 0 };
}
const emptyDelta = () => ({ Translation: { X: 0, Y: 0 }, Scale: 1, Rotation: 0, Expansion: 0 });
const copyDelta = delta => ({ ...delta, Translation: { ...delta.Translation } });
const emptyVelocity = () => ({ Linear: { X: 0, Y: 0 }, Angular: 0, Expansion: 0 });

/** Pointer count changes rebase geometry; each manipulation owns cancellable bounded inertial continuation. */
export class ManipulationRecognizer {
  constructor({ emit = () => {}, now = () => performance.now(), requestFrame = callback => setTimeout(() => callback(now()), 16),
    cancelFrame = clearTimeout } = {}) {
    Object.assign(this, { emit, now, requestFrame, cancelFrame });
    this.sessions = new Map();
  }
  down(id, pointer, mode = ManipulationModes.All) {
    if (mode === 0 || mode === ManipulationModes.System) return;
    let session = this.sessions.get(id);
    if (session?.inertia) { this.complete(id); session = null; }
    if (!session) {
      const args = { Mode: mode, Container: id, Cancel: false };
      this.emit(id, 'ManipulationStarting', args);
      if (args.Cancel || !args.Mode) return;
      session = { points: new Map(), mode: args.Mode, container: args.Container ?? id, previous: null, time: this.now(),
        pointerDeviceType: pointerDeviceType(pointer.pointerType), cumulative: emptyDelta(), delta: emptyDelta(),
        velocities: emptyVelocity(), frame: null };
      this.sessions.set(id, session);
    }
    session.points.set(pointer.pointerId, { ...pointer });
    session.previous = geometry([...session.points.values()]);
    session.time = this.now();
    session.velocities = emptyVelocity();
    if (session.points.size === 1) this.publish(id, 'ManipulationStarted', session);
  }
  move(id, pointer) {
    const session = this.sessions.get(id);
    if (!session?.points.has(pointer.pointerId)) return;
    session.points.set(pointer.pointerId, { ...pointer });
    const next = geometry([...session.points.values()]);
    const previous = session.previous;
    let rotation = (next.angle - previous.angle) * 180 / Math.PI;
    if (rotation > 180) rotation -= 360;
    if (rotation < -180) rotation += 360;
    const delta = { Translation: { X: session.mode & 1 ? next.x - previous.x : 0, Y: session.mode & 2 ? next.y - previous.y : 0 },
      Scale: session.mode & 32 && previous.distance > 0 ? next.distance / previous.distance : 1,
      Rotation: session.mode & 16 ? rotation : 0, Expansion: session.mode & 32 ? next.distance - previous.distance : 0 };
    if ((session.mode & 12) === 4) delta.Translation.Y = 0;
    if ((session.mode & 12) === 8) delta.Translation.X = 0;
    const timestamp = this.now();
    const elapsed = Math.max(1, timestamp - session.time);
    session.velocities = { Linear: { X: delta.Translation.X / elapsed, Y: delta.Translation.Y / elapsed },
      Angular: delta.Rotation / elapsed, Expansion: delta.Expansion / elapsed };
    this.accumulate(session, delta);
    session.previous = next;
    session.time = timestamp;
    this.publish(id, 'ManipulationDelta', session);
  }
  accumulate(session, delta) {
    session.delta = delta;
    session.cumulative.Translation.X += delta.Translation.X;
    session.cumulative.Translation.Y += delta.Translation.Y;
    session.cumulative.Scale *= delta.Scale;
    session.cumulative.Rotation += delta.Rotation;
    session.cumulative.Expansion += delta.Expansion;
  }
  publish(id, name, session, extras = {}) {
    const payload = { Container: session.container, PointerDeviceType: session.pointerDeviceType,
      Delta: copyDelta(session.delta), Cumulative: copyDelta(session.cumulative), Velocities: {
        ...session.velocities, Linear: { ...session.velocities.Linear } },
      Position: { X: session.previous?.x ?? 0, Y: session.previous?.y ?? 0 }, IsInertial: !!session.inertia,
      ...extras, Complete: () => this.complete(id), CompleteRequested: false };
    this.emit(id, name, payload);
    if (payload.CompleteRequested && this.sessions.has(id)) this.complete(id);
    return payload;
  }
  up(id, pointerId, canceled = false) {
    const session = this.sessions.get(id);
    if (!session || !session.points.has(pointerId)) return;
    session.points.delete(pointerId);
    if (session.points.size) { session.previous = geometry([...session.points.values()]); session.time = this.now(); return; }
    if (canceled || !(session.mode & (64 | 128 | 256))) { this.complete(id, canceled); return; }
    if (this.now() - session.time > 100) session.velocities = emptyVelocity();
    const behavior = this.publish(id, 'ManipulationInertiaStarting', session, {
      TranslationBehavior: {}, RotationBehavior: {}, ExpansionBehavior: {}, Cancel: false });
    if (!this.sessions.has(id)) return;
    if (behavior.Cancel) { this.complete(id); return; }
    session.inertia = new ManipulationInertia(session.velocities, session.mode, behavior, session.previous.distance);
    if (session.inertia.complete) { this.complete(id); return; }
    session.time = this.now();
    session.frame = this.requestFrame(time => this.advance(id, time));
  }
  advance(id, time = this.now()) {
    const session = this.sessions.get(id);
    if (!session?.inertia) return;
    session.frame = null;
    const delta = session.inertia.advance(Math.max(0, time - session.time));
    session.velocities = session.inertia.velocities;
    session.time = time;
    this.accumulate(session, delta);
    session.previous.x += delta.Translation.X;
    session.previous.y += delta.Translation.Y;
    this.publish(id, 'ManipulationDelta', session);
    if (!this.sessions.has(id)) return;
    if (session.inertia.complete) this.complete(id);
    else session.frame = this.requestFrame(next => this.advance(id, next));
  }
  complete(id, canceled = false) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    if (session.frame != null) this.cancelFrame(session.frame);
    this.publish(id, 'ManipulationCompleted', session, { Canceled: canceled });
  }
  removeNode(id) { this.complete(id, true); }
  dispose() { for (const id of [...this.sessions.keys()]) this.removeNode(id); }
}
