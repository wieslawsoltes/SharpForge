import {contracts} from '@sharpforge/framework';
import {isReference} from '../heap.js';

// Exact owner opt-ins only: a same-named method or an arbitrary user callback is insufficient.
const overrides = new Map(contracts.filter(member => member.objectToStringOverride).map(member => [member.owner, member]));
const unhandled = Object.freeze({handled: false});
const canceled = Object.freeze({handled: true, value: null, canceled: true});

export function invokeFrameworkObjectToString(platform, receiver) {
  if (!isReference(receiver)) return unhandled;
  const record = platform.heap.get(receiver);
  if (record.kind !== 'host') return unhandled;
  const descriptor = overrides.get(record.methodTable.name);
  if (!descriptor) return unhandled;
  const value = platform.invoke(descriptor, [receiver]);
  return platform.bclHost.isExecutionStopped?.(platform) === true ? canceled : {handled: true, value};
}
