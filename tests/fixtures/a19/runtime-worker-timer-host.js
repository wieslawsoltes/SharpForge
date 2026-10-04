import {setTimeout as scheduleTimeout, clearTimeout as cancelTimeout} from 'node:timers';

// Node accepts arbitrary receivers; browser worker timers accept only their host or a bare call.
globalThis.setTimeout = function(callback, delay, ...arguments_) {
  if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation: worker timer receiver');
  return scheduleTimeout(callback, delay, ...arguments_);
};

globalThis.clearTimeout = function(timer) {
  if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation: worker timer receiver');
  cancelTimeout(timer);
};
