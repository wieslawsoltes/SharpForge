import {validateFrameIndexSnapshot} from './execution/frame-lifetimes.js';
import {validateCilStackSnapshot} from './execution/frame-stack.js';
import {validateSourceStackSnapshot} from './execution/source-stack-admission.js';
import {validateSnapshotFrames} from './execution/snapshot-frame-validation.js';
import {validateSnapshotHeap} from './execution/snapshot-heap-validation.js';
import {validateSnapshotScheduler} from './execution/snapshot-scheduler-validation.js';
import {validateCapturedMemory} from './execution/snapshot-memory-validation.js';
import {validateSnapshotSynchronization} from './execution/snapshot-synchronization.js';
import {validateSnapshotExceptions} from './execution/snapshot-exception-validation.js';
import {validateExceptionEventsSnapshot} from './execution/exception-events-snapshot.js';
import {validateAsyncSnapshot} from './execution/async-snapshot-validation.js';
import {validateSnapshotAsyncContinuations} from './execution/snapshot-async-continuations-validation.js';
import {validateVarargsSnapshot} from './execution/varargs-snapshot-validation.js';
import {validateSnapshotArrayWork} from './execution/snapshot-array-validation.js';
import {validateSnapshotObjectValueWork} from './execution/snapshot-object-value-validation.js';
import {snapshotInteger as integer, invalidSnapshot as fail, snapshotPairs, snapshotFault}
  from './execution/snapshot-validation-helpers.js';

function validatePlatform(snapshot) {
  const platform = snapshot.platform;
  if (!platform || !integer(platform.sequence) || !Array.isArray(platform.pending)) fail('platform');
  snapshotPairs(platform.windows, 'platform windows');
  snapshotPairs(platform.singletons, 'platform singletons');
  const animation = platform.animations;
  if (!animation || !integer(animation.serial)) fail('animation state');
  snapshotPairs(animation.states, 'animation states');
  snapshotPairs(animation.bases, 'animation bases');
}

/** Preflight all captured components before replacing heap, execution state, or scheduler ownership. */
export function validateSnapshotState(vm, snapshot, engine) {
  if (!Array.isArray(snapshot.frames) || !Array.isArray(snapshot.output) ||
      snapshot.output.some(value => typeof value !== 'string') || !integer(snapshot.instructions) ||
      !integer(snapshot.frameId) || !integer(snapshot.outputCharacters) || !Number.isFinite(snapshot.elapsedMs) ||
      snapshot.elapsedMs < 0 || !integer(snapshot.writeRevision) ||
      !['ready', 'running', 'paused', 'waiting', 'terminated', 'faulted'].includes(snapshot.state)) fail('execution state');
  if (snapshot.output.reduce((total, item) => total + item.length, 0) !== snapshot.outputCharacters) fail('output accounting');
  snapshotFault(snapshot.fault);
  snapshotFault(snapshot.pendingFault);
  if (engine === 'source') {
    if (!Array.isArray(snapshot.stack) || !Array.isArray(snapshot.statics)) fail('source storage');
    snapshotPairs(snapshot.constantValues, 'source constant cache');
  } else if (!(snapshot.statics instanceof Map) || !(snapshot.initialized instanceof Map)) fail('CIL storage');
  if (!(snapshot.strings instanceof Map) || snapshot.typeObjects !== undefined && !(snapshot.typeObjects instanceof Map)) fail('type/string caches');
  const referenceRecord = validateSnapshotHeap(vm, snapshot);
  validateSnapshotScheduler(vm, snapshot, engine, referenceRecord);
  const frames = validateSnapshotFrames(vm, snapshot, engine);
  validateFrameIndexSnapshot(snapshot);
  validatePlatform(snapshot);
  const memory = validateCapturedMemory(vm, snapshot, frames, referenceRecord);
  validateSnapshotArrayWork(memory);
  validateSnapshotObjectValueWork(memory);
  validateSnapshotExceptions(vm, snapshot, frames);
  validateSnapshotSynchronization(memory);
  validateExceptionEventsSnapshot(vm, snapshot);
  validateAsyncSnapshot(vm, snapshot);
  validateSnapshotAsyncContinuations(memory);
  validateVarargsSnapshot(vm, snapshot);
  if (engine === 'cil') validateCilStackSnapshot(vm, snapshot);
  else validateSourceStackSnapshot(vm, snapshot);
}
