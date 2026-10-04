import {applyControlStateFeedback} from '@sharpforge/winui-controls';
import {assertUIHostData} from './ui-data.js';

export function registerControlStateHandler(handlers, {current, flush, schedule}) {
  handlers.registerHandler('uiControlStateChanges', params => {
    const {vm} = current();
    if (vm.state === 'paused') return false;
    assertUIHostData(params.changes);
    const count = applyControlStateFeedback(vm.platform.ui, params.changes);
    flush();
    schedule();
    return count;
  });
}
