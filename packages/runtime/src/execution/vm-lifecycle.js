import {invalidateExecutionCode} from './code-version.js';
import {clearStrings} from './strings.js';
import {clearRuntimeTypes} from './tokens.js';
import {clearFramePool} from './frame-pool.js';

/** Stop both engines through the same code-cache and managed-context lifetime boundary. */
export function stopVM(vm) {
  if (vm.profiler) vm.profiler.flushSample();
  invalidateExecutionCode(vm, 'stop');
  clearStrings(vm);
  clearRuntimeTypes(vm);
  vm.scheduler.cancelAll();
  vm.platform.closeAll();
  vm.state = 'terminated';
  vm.pendingFault = null;
  vm.frames = [];
  clearFramePool(vm);
  if (!vm.inspector) {
    vm.stack = [];
    vm.currentPoint = null;
  }
}
