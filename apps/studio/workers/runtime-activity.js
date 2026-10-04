import {ExecutionOccupancy} from './execution-occupancy.js';

const measuredRequests = Object.freeze({resume: 'debugger', stepBack: 'debugger', reverseContinue: 'debugger',
  evaluateFunction: 'debugger', collect: 'debugger', uiEvent: 'ui', uiAnimationAdvance: 'ui', uiLayout: 'ui', applyDesign: 'ui'});
const runnable = new Set(['ready', 'running', 'waiting']);

/** Explicit owner of worker pump, animation and activity timers. Every callback checks the committed launch serial. */
export class RuntimeActivity {
  constructor({getSession, getSerial, flush, publishState, onError, clock = () => performance.now(),
    setTimer = setTimeout, clearTimer = clearTimeout, intervalMs = 250, sampleLimit = 2000}) {
    Object.assign(this, {getSession, getSerial, flush, publishState, onError, clock, setTimer, clearTimer});
    this.execution = new ExecutionOccupancy({clock, intervalMs, limit: sampleLimit});
    this.pumpTimer = null;
    this.animationTimer = null;
    this.profileTimer = null;
    this.animationLast = null;
    this.manualAnimations = false;
    this.lastSent = 0;
    this.started = false;
  }

  start({manualAnimations = false} = {}) {
    this.stop();
    this.manualAnimations = manualAnimations;
    this.lastSent = 0;
    this.started = true;
    this.execution.reset(this.getSerial());
    this.ensureSampling();
  }

  live() {
    const session = this.getSession();
    return session && (runnable.has(session.vm.state) || session.vm.state === 'paused' || session.vm.platform?.windows?.size > 0);
  }

  ensureSampling() {
    if (!this.started) return;
    if (!this.live()) {
      if (this.profileTimer !== null) this.clearTimer(this.profileTimer);
      this.profileTimer = null;
      this.execution.close();
      return;
    }
    if (this.profileTimer !== null) return;
    const serial = this.getSerial();
    this.profileTimer = this.setTimer(() => {
      if (!this.started || serial !== this.getSerial()) return;
      this.profileTimer = null;
      this.execution.sample();
      this.ensureSampling();
    }, this.execution.intervalMs);
  }

  observeState() {
    this.scheduleAnimations();
    this.ensureSampling();
  }

  schedule() {
    const session = this.getSession();
    if (!this.started || this.pumpTimer !== null || !session || !runnable.has(session.vm.state)) return;
    const serial = this.getSerial(), delay = session.vm.state === 'waiting' ? session.vm.scheduler.nextDelay() : 0;
    if (delay === null) return;
    this.pumpTimer = this.setTimer(() => this.pump(serial), Math.min(50, Math.max(0, delay)));
  }

  pump(serial) {
    const session = this.getSession();
    if (!this.started || !session || serial !== this.getSerial()) return;
    this.pumpTimer = null;
    try { this.execution.measure('managed', () => session.pump({instructionBudget: 15000, timeBudgetMs: 6})); }
    catch (error) {
      session.pause();
      session.reason = {reason: 'error', description: error.message};
      this.onError(error);
      this.publishState();
      return;
    }
    this.scheduleAnimations();
    this.flush();
    if (session.vm.state === 'running' || session.vm.state === 'waiting') {
      if (session.vm.state === 'waiting' || this.clock() - this.lastSent > 150) {
        this.lastSent = this.clock();
        this.publishState();
      }
      this.schedule();
    } else this.publishState();
    this.ensureSampling();
  }

  scheduleAnimations() {
    const session = this.getSession(), platform = session?.vm.platform;
    const active = this.started && !this.manualAnimations && session?.vm.state !== 'paused' &&
      platform?.windows?.size > 0 && platform?.animations?.running;
    if (!active) {
      if (this.animationTimer !== null) this.clearTimer(this.animationTimer);
      this.animationTimer = null;
      this.animationLast = null;
      return;
    }
    if (this.animationTimer !== null) return;
    const serial = this.getSerial();
    this.animationLast ??= this.clock();
    this.animationTimer = this.setTimer(() => this.animate(serial), 16);
  }

  animate(serial) {
    const session = this.getSession();
    if (!this.started || !session || serial !== this.getSerial()) return;
    this.animationTimer = null;
    const now = this.clock(), delta = Math.max(0, now - this.animationLast);
    this.animationLast = now;
    if (session.vm.state !== 'paused') {
      try {
        this.execution.measure('ui', () => session.vm.platform.advanceAnimations(delta));
        this.flush();
        this.schedule();
      } catch (error) {
        session.vm.platform.animations.clear();
        this.onError(error);
      }
    }
    this.scheduleAnimations();
  }

  dispatch(method, params, dispatch) {
    const category = measuredRequests[method];
    return category ? this.execution.measure(category, () => dispatch(method, params)) : dispatch(method, params);
  }

  stop() {
    for (const key of ['pumpTimer', 'animationTimer', 'profileTimer']) {
      if (this[key] !== null) this.clearTimer(this[key]);
      this[key] = null;
    }
    this.animationLast = null;
    this.started = false;
    this.execution.close();
  }
}
