import {invalidateExecutionCode} from './code-version.js';
import {clearStrings} from './strings.js';
import {clearRuntimeTypes} from './tokens.js';

/** Stop both engines through the same code-cache and managed-context lifetime boundary. */
export function stopVM(vm) {
  invalidateExecutionCode(vm, 'stop');
  clearStrings(vm);
  clearRuntimeTypes(vm);
  vm.scheduler.cancelAll();
  vm.platform.closeAll();
  vm.state = 'terminated';
  vm.pendingFault = null;
  vm.frames = [];
  if (!vm.inspector) {
    vm.stack = [];
    vm.currentPoint = null;
  }
}
