import { AutomationEvents } from '../automation/enums.js';

/** Remote automation metadata and explicit notifications never enter the UI property scene. */
export function applyAutomationCommand(host, command) {
  if (command.op === 'automationPeer') {
    host.automation?.remote.apply(command.id, command.state);
    return true;
  }
  if (command.op !== 'automationEvent') return false;
  const peer = host.automation?.getPeer(command.id);
  if (!peer) return true;
  const event = command.event;
  if (!event || event.id !== command.id || !Number.isInteger(event.kind)) throw new TypeError('SFAX018: Invalid automation event packet');
  if (event.kind === AutomationEvents.PropertyChanged) {
    host.automation.events.propertyChanged(peer, event.property, event.oldValue, event.newValue);
  } else if (event.kind === AutomationEvents.Notification) {
    host.automation.events.notify(peer, { kind: event.notificationKind, processing: event.processing,
      text: event.text, activityId: event.activityId, level: event.level });
  } else host.automation.events.raise(peer, event.kind);
  return true;
}
