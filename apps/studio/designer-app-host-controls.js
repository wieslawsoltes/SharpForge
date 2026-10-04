import {DesignerAppHostError} from './designer-app-host-errors.js';

/** Idle WinUI windows can outlive Main. Their input/animation pause is separate from a managed debugger stop. */
export class DesignerAppControls {
  constructor(app) {
    this.app = app;
    this.action = null;
    this.idlePaused = false;
    this.acknowledged = true;
    this.manualAnimations = app.runtimeOptions?.manualAnimations === true;
    this.animationsBeforePause = null;
  }

  get inputBlocked() { return this.idlePaused || this.action === 'pause' || this.app.runtimeState === 'paused'; }

  state(value) {
    const runtimeState = this.app.runtimeState;
    return {...value, runtimeState, state: this.idlePaused ? 'paused' : runtimeState,
      pauseKind: this.idlePaused ? 'idle-ui' : runtimeState === 'paused' ? 'debugger' : null,
      pauseAcknowledged: this.acknowledged};
  }

  async run(action, callback) {
    if (this.action) throw new DesignerAppHostError('App pause or continue is already pending', 'SFDA0013');
    this.action = action;
    try {
      await callback();
    } finally {
      this.action = null;
      if (!this.app.disposed) this.app.refreshState();
    }
    return this.app.snapshot();
  }

  pause(parameters, options) {
    return this.run('pause', async () => {
      await this.app.send('pause', parameters, options);
      if (this.app.runtimeState !== 'terminated' || !this.app.state.uiActive) return this.app.snapshot();
      if (this.animationsBeforePause === null) this.animationsBeforePause = this.manualAnimations;
      this.idlePaused = true;
      this.acknowledged = false;
      this.app.refreshState();
      // If cancellation interrupts this request, input stays gated and Continue can restore the saved mode.
      await this.app.send('uiAnimationMode', {manual: true}, options);
      // An animation completion could have queued a managed callback between the first pause and clock suspension.
      await this.app.send('pause', parameters, options);
      this.idlePaused = this.app.runtimeState === 'terminated';
      this.acknowledged = true;
      return this.app.snapshot();
    });
  }

  resume(parameters, options) {
    return this.run('resume', async () => {
      if (this.animationsBeforePause !== null) {
        await this.app.send('uiAnimationMode', {manual: this.animationsBeforePause}, options);
        this.animationsBeforePause = null;
      }
      const wasIdle = this.idlePaused;
      this.idlePaused = false;
      this.acknowledged = true;
      if (!wasIdle || this.app.runtimeState === 'paused') await this.app.send('resume', parameters, options);
      return this.app.snapshot();
    });
  }

  assertInput(method) {
    if (this.inputBlocked && ['uiEvent', 'uiLayout', 'uiAnimationAdvance', 'uiAnimationMode'].includes(method)) {
      throw new DesignerAppHostError('Continue this app before sending managed input or changing its animation clock', 'SFDA0015');
    }
  }
}
