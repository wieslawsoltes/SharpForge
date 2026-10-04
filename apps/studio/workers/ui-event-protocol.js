import {serializeRoutedEvent} from '@sharpforge/winui-controls';
import {assertUIHostData} from './ui-data.js';

const requestKeys = new Set(['version', 'sessionId', 'requestId', 'id', 'event', 'payload']);
const cancelKeys = new Set(['version', 'sessionId', 'requestId']);
export const uiEventFailure = (name, message) => Object.assign(new Error(message), {name});

export function validUIEventSession(value) {
  return Number.isSafeInteger(value) && value >= 1 || typeof value === 'string' && value.length > 0 && value.length <= 128;
}

/** Reuse the input channel's depth, collection and text budgets; request payloads never contain native deferral methods. */
export function copyUIEventPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('UI event payload must be an object');
  assertUIHostData(payload);
  return serializeRoutedEvent(payload);
}

/** Version one carries a monotonic request identity in an explicit application session. */
export function validateUIEventRequest(params, {cancellation = false} = {}) {
  assertUIHostData(params);
  if (!params || typeof params !== 'object' || Array.isArray(params) || params.version !== 1
    || !validUIEventSession(params.sessionId) || !Number.isSafeInteger(params.requestId) || params.requestId < 1) {
    throw new TypeError('Invalid UI event request identity');
  }
  const keys = cancellation ? cancelKeys : requestKeys;
  if (Object.keys(params).some(key => !keys.has(key))) throw new TypeError('Unknown UI event request field');
  if (cancellation) return params;
  if (typeof params.id !== 'string' || !params.id || params.id.length > 256
    || typeof params.event !== 'string' || !params.event || params.event.length > 128) {
    throw new TypeError('Invalid UI event target or name');
  }
  return {...params, payload: copyUIEventPayload(params.payload)};
}
