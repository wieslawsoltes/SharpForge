function deceleration(velocity, behavior, distanceName, fallback) {
  if (velocity === 0) return fallback;
  const distance = behavior?.[distanceName];
  if (Number.isFinite(distance) && distance > 0) return velocity * velocity / (2 * distance);
  const value = behavior?.DesiredDeceleration;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

class Motion {
  constructor(velocity, acceleration, maximumTime) {
    this.velocity = velocity;
    this.acceleration = acceleration;
    this.duration = velocity === 0 ? 0 : Math.min(maximumTime, Math.abs(velocity) / acceleration);
    this.time = 0;
    this.position = 0;
  }
  advance(elapsed) {
    const previous = this.position;
    this.time = Math.min(this.duration, this.time + elapsed);
    const sign = Math.sign(this.velocity);
    this.position = this.velocity * this.time - sign * this.acceleration * this.time * this.time / 2;
    return this.position - previous;
  }
  get speed() { return this.time >= this.duration ? 0 : this.velocity - Math.sign(this.velocity) * this.acceleration * this.time; }
  get complete() { return this.time >= this.duration; }
}

/** Finite, analytical deceleration in DIPs/degrees per millisecond, driven by the host frame clock. */
export class ManipulationInertia {
  constructor(velocities, mode, behavior = {}, distance = 0, maximumTime = 5000) {
    if (!Number.isFinite(maximumTime) || maximumTime <= 0 || maximumTime > 30000) throw new RangeError('Invalid inertia time limit');
    const linear = velocities.Linear ?? { X: 0, Y: 0 };
    if (![linear.X, linear.Y, velocities.Angular ?? 0, velocities.Expansion ?? 0, distance].every(Number.isFinite)
      || !Number.isInteger(mode) || mode < 0 || mode > 0xffff) throw new TypeError('Invalid manipulation inertia input');
    const speed = mode & 64 ? Math.hypot(linear.X, linear.Y) : 0;
    this.direction = speed ? { X: linear.X / speed, Y: linear.Y / speed } : { X: 0, Y: 0 };
    const angular = mode & 128 ? velocities.Angular ?? 0 : 0;
    const expansion = mode & 256 ? velocities.Expansion ?? 0 : 0;
    this.linear = new Motion(speed, deceleration(speed, behavior.TranslationBehavior, 'DesiredDisplacement', 0.002), maximumTime);
    this.angular = new Motion(angular, deceleration(angular, behavior.RotationBehavior, 'DesiredRotation', 0.002), maximumTime);
    this.expansion = new Motion(expansion, deceleration(expansion, behavior.ExpansionBehavior, 'DesiredExpansion', 0.002), maximumTime);
    this.distance = Math.max(0, distance);
  }
  advance(elapsed) {
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError('Invalid inertia frame duration');
    const translation = this.linear.advance(elapsed);
    const rotation = this.angular.advance(elapsed);
    const expansion = this.expansion.advance(elapsed);
    const previous = this.distance;
    this.distance = Math.max(0.001, previous + expansion);
    return { Translation: { X: translation * this.direction.X, Y: translation * this.direction.Y }, Rotation: rotation,
      Expansion: previous ? this.distance - previous : 0, Scale: previous > 0 ? this.distance / previous : 1 };
  }
  get velocities() {
    return { Linear: { X: this.linear.speed * this.direction.X, Y: this.linear.speed * this.direction.Y },
      Angular: this.angular.speed, Expansion: this.expansion.speed };
  }
  get complete() { return this.linear.complete && this.angular.complete && this.expansion.complete; }
}

/** A callback queue uses the existing scheduler when supplied; disposal cancels only its own callbacks. */
export function inputFrameClock(host) {
  const scheduler = host.options.scheduler ?? host.services.scheduler;
  if (!scheduler) {
    const window = host.document.defaultView;
    return { requestFrame: callback => window.requestAnimationFrame(callback), cancelFrame: handle => window.cancelAnimationFrame(handle),
      dispose() {} };
  }
  const pending = new Map();
  let serial = 0;
  const unregister = scheduler.register('input', host.rootKey + ':inertia', ({ time }) => {
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback(time);
  });
  return { requestFrame(callback) { const key = ++serial; pending.set(key, callback); scheduler.invalidate('input'); return key; },
    cancelFrame: handle => pending.delete(handle), dispose() { pending.clear(); unregister(); } };
}
