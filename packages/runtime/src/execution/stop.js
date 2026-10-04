import {invalidateExecutionCode} from './code-version.js';
import {clearStrings} from './strings.js';
import {clearRuntimeTypes} from './tokens.js';
import {stopCilMethodEvents} from './cil-method-events.js';
import {stopFramePool} from './frame-retirement.js';

/** Dispose live and parked storage before dropping the VM's execution roots. */
export function stopExecution(vm) {
  vm.profiler?.boundary();
  if (vm.inspector) invalidateExecutionCode(vm, 'stop');
  clearStrings(vm);
  clearRuntimeTypes(vm);
  vm.scheduler.cancelAll();
  vm.platform.closeAll();
  stopFramePool(vm);
  vm.state = 'terminated';
  vm.frames = [];
  vm.pendingFault = null;
  if (vm.inspector) stopCilMethodEvents(vm);
  else {
    vm.stack = [];
    vm.currentPoint = null;
  }
}
