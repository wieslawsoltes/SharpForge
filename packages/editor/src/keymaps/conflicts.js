export { KeybindingService } from './resolve.js';

/** Stable query facade for Options clients; resolution remains in the shared service. */
export function keybindingConflicts(service) {
  return Object.freeze({
    bindingsFor: command => service.bindingsFor(command),
    commandsFor: keys => service.commandsFor(keys),
    conflicts: candidate => service.conflicts(candidate)
  });
}
