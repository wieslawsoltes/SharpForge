import {RuntimeEventLog} from './runtime-events.js';

/** Export one bounded instruction-clock event window, without delivering subscribers or copying frozen event records. */
export function exportRuntimeTrace(log, options) {
  if (!(log instanceof RuntimeEventLog)) throw new TypeError('Runtime event log required');
  return log.export(options);
}
