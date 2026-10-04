import { loadAssembly } from '@sharpforge/cil';
import { verifyImage } from '@sharpforge/bytecode';
import { ManagedHeap } from '../heap.js';
import { ManagedPlatform } from '../platform.js';
import { CooperativeScheduler } from '../scheduler.js';
import { normalizeRuntimeLaunchOptions } from '../launch-options.js';
import { createSourceMethodTables } from './method-table.js';
import { sourceEntryArguments } from './entry-arguments.js';
import { initializeExecutionProfiler } from './profiler.js';
import { initializeSourceNumbers, sourceInitialValue } from './source-numbers.js';
import { installRootProvider } from './frame-roots.js';

/** Initialize each source runtime's heap, state and entry frame from independent host options. */
export function initializeSourceVM(vm, image, options) {
  options = normalizeRuntimeLaunchOptions(options);
  if (image instanceof Uint8Array || image instanceof ArrayBuffer) image = loadAssembly(image, options.assemblyLimits);
  if (image?.outputKind === 'library') {
    throw new Error('Library has no entry point. Invoke a static method with CilVirtualMachine instead.');
  }
  const errors = verifyImage(image);
  if (errors.length) throw new Error('Bytecode verification failed: ' + errors.join('; '));
  vm.image = image;
  vm.options = { maxInstructions: 20_000_000, maxFrames: 512, maxOutputCharacters: 1_000_000, ...options };
  initializeSourceNumbers(vm);
  vm.heap = new ManagedHeap({ ...options, methodTables: createSourceMethodTables(image, vm.options) });
  installRootProvider(vm);
  vm.stack = [];
  vm.frames = [];
  vm.statics = image.statics.map(slot => sourceInitialValue(vm, slot));
  vm.constantValues = new Map();
  vm.strings = new Map();
  vm.output = [];
  vm.outputCharacters = 0;
  vm.snapshotOwner = Object.freeze({});
  vm.state = 'ready';
  vm.instructions = 0;
  vm.writeRevision = 0;
  vm.sourcePause = false;
  vm.elapsedMs = 0;
  vm.frameId = 0;
  vm.currentPoint = null;
  vm.fault = null;
  vm.pendingFault = null;
  vm.exitCode = 0;
  vm.returnValue = null;
  vm.onOutput = options.onOutput ?? (() => {});
  vm.onException = null;
  vm.onWrite = null;
  initializeExecutionProfiler(vm, options.profile);
  vm.platform = new ManagedPlatform(vm, options);
  vm.scheduler = new CooperativeScheduler(vm, options);
  vm.call(image.entryPoint, sourceEntryArguments(vm, options));
}
