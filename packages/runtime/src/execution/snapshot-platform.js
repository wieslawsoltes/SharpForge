import {copyExecution} from './execution-copy.js';
import {ManagedFault} from './managed-fault.js';

/** Capture pending UI work and animation identities through the same execution graph. */
export function snapshotPlatformState(platform, memo) {
  if (platform.styleDepth || platform.transaction || platform.animations.applying) {
    throw new ManagedFault('InvalidOperationException', 'Cannot snapshot during an active platform transaction');
  }
  return copyExecution({animations: {states: [...platform.animations.states], bases: [...platform.animations.bases],
    serial: platform.animations.serial}, singletons: [...platform.singletons], windows: [...platform.windows],
    application: platform.application, sequence: platform.sequence, pending: platform.pending}, memo);
}

/** Commit prepared data without structuredClone losing issued managed-reference identities. */
export function restorePlatformState(platform, snapshot) {
  platform.animations.states = new Map(snapshot.animations.states);
  platform.animations.bases = new Map(snapshot.animations.bases);
  platform.animations.serial = Math.max(platform.animations.serial, snapshot.animations.serial);
  platform.windows = new Map(snapshot.windows);
  platform.singletons = new Map(snapshot.singletons);
  platform.application = snapshot.application;
  platform.sequence = Math.max(platform.sequence, snapshot.sequence);
  platform.pending = snapshot.pending;
}

/** Host rendering runs only after every VM component has committed successfully. */
export function notifyPlatformRestore(platform) {
  if (!platform.transaction && platform.options.onUICommand) platform.command({op: 'reset', snapshot: platform.scene()});
}
