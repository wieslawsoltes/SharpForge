import {memoryRequests} from './dap-memory.js';

const requests = new Map(memoryRequests);

/** Package contributions dispatch through this table after the released core request set. */
export function dispatchDebugExtension(adapter, command, arguments_) {
  const handler = requests.get(command);
  if (!handler) throw new Error(`DAP request '${command}' is not implemented`);
  return handler(adapter, arguments_);
}
