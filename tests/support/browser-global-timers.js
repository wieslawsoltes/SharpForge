/** Node's timers accept arbitrary receivers; browser timer operations accept their global or an absent receiver only. */
export function browserGlobalTimers(scope = globalThis, { schedule = scope.setTimeout, cancel = scope.clearTimeout } = {}) {
  const check = receiver => {
    if (receiver !== undefined && receiver !== null && receiver !== scope) throw new TypeError('Illegal invocation');
  };
  return {
    setTimeout: function(callback, milliseconds, ...arguments_) {
      check(this);
      return Reflect.apply(schedule, scope, [callback, milliseconds, ...arguments_]);
    },
    clearTimeout: function(handle) {
      check(this);
      return Reflect.apply(cancel, scope, [handle]);
    }
  };
}
