import {
  registerNumericTypes
} from './numeric.js';
import {
  registerRuntimeExceptions
} from './runtime-exceptions.js';
import {registerRuntimeDelegates} from './runtime-delegates.js';
import {registerRuntimeControlTypes} from './runtime-control-types.js';

/** A05 owns one stable reservation; type-only numeric contributions allocate no contract IDs. */
export const runtimeControlContribution = Object.freeze({
  name: 'A05',
  register(registry) {
    registerNumericTypes(registry);
    registerRuntimeExceptions(registry);
    registerRuntimeControlTypes(registry);
    registry.member('SharpForge.Runtime.Async', 'StartVoid', ['System.Action'], 'void', {
      isStatic: true,
      kind: 'startAsyncVoid'
    });
    registerRuntimeDelegates(registry);
  }
});
