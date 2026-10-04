import { AutomationEvents, AutomationNotificationKind, AutomationNotificationProcessing, enumValue } from './enums.js';
import { getAutomationProperty } from './automation-properties.js';

const secretProperties = new Set(['Password', 'Value', 'Text', 'SelectedText', 'OldValue', 'NewValue']);
const sameValue = (left, right) => Object.is(left, right)
  || (left && right && typeof left === 'object' && typeof right === 'object' && JSON.stringify(left) === JSON.stringify(right));

function propertyValue(value, depth = 0, budget = { count: 0, text: 0 }) {
  if (++budget.count > 4096 || depth > 4) throw new RangeError('SFAX013: Automation property value exceeds the limit');
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && (budget.text += value.length) <= 65536) return value;
  if (Array.isArray(value)) return value.map(item => propertyValue(item, depth + 1, budget));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    const result = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || descriptor.get || descriptor.set) {
        throw new TypeError('SFAX012: Invalid automation property record');
      }
      result[key] = propertyValue(descriptor.value, depth + 1, budget);
    }
    return result;
  }
  throw new TypeError('SFAX012: Automation property events require bounded plain values');
}

function propertyIdentity(property) {
  const name = typeof property === 'string' ? property : property?.name ?? property?.Name;
  if (typeof name !== 'string' || !name || name.length > 256) throw new TypeError('SFAX012: Invalid automation property identity');
  return name;
}

/** Bounded per-root queue coalesces property writes while retaining distinct event/notification order. */
export class AutomationEventQueue {
  constructor({ onEvent = () => {}, onError = error => { throw error; }, schedule = queueMicrotask,
    liveRegions = null, maximum = 1024 } = {}) {
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 65536) throw new RangeError('SFAX013: Invalid automation queue limit');
    this.onEvent = onEvent;
    this.onError = onError;
    this.schedule = schedule;
    this.liveRegions = liveRegions;
    this.maximum = maximum;
    this.queue = [];
    this.properties = new Map();
    this.notifications = new Map();
    this.currentNotifications = new Map();
    this.listeners = new Set();
    this.pending = false;
    this.disposed = false;
    this.sequence = 0;
  }
  listen(callback) {
    if (typeof callback !== 'function') throw new TypeError('SFAX012: Automation listener must be a function');
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  raise(peer, event) {
    const kind = enumValue(AutomationEvents, event, 'automation event');
    this.enqueue({ id: peer.id, kind, sequence: ++this.sequence });
    if (kind === AutomationEvents.LiveRegionChanged && !peer.IsPassword()) {
      const level = getAutomationProperty(peer.Owner, 'LiveSetting');
      if (level) this.notify(peer, { text: peer.GetName(), processing: AutomationNotificationProcessing.MostRecent,
        kind: AutomationNotificationKind.Other, activityId: 'live-region', level });
    }
  }
  propertyChanged(peer, property, oldValue, newValue) {
    const name = propertyIdentity(property);
    if (peer.IsPassword() && secretProperties.has(name.split('.').at(-1))) return;
    oldValue = propertyValue(oldValue);
    newValue = propertyValue(newValue);
    if (sameValue(oldValue, newValue)) return;
    const key = peer.id + '\0' + name;
    const previous = this.properties.get(key);
    if (previous) previous.newValue = newValue;
    else {
      const item = { id: peer.id, kind: AutomationEvents.PropertyChanged, property: name, oldValue, newValue, sequence: ++this.sequence };
      this.properties.set(key, item);
      this.enqueue(item);
    }
  }
  notify(peer, { kind = AutomationNotificationKind.Other, processing = AutomationNotificationProcessing.All,
    text, activityId = '', level } = {}) {
    if (peer.IsPassword()) throw new Error('SFAX005: Password peers cannot publish text notifications');
    kind = enumValue(AutomationNotificationKind, kind, 'notification kind');
    processing = enumValue(AutomationNotificationProcessing, processing, 'notification processing');
    if (typeof text !== 'string' || text.length > 65536 || typeof activityId !== 'string' || activityId.length > 256) {
      throw new RangeError('SFAX013: Notification text/activity exceeds the limit');
    }
    const item = { id: peer.id, kind: AutomationEvents.Notification, notificationKind: kind, processing,
      text, activityId, level: level ?? (processing <= 1 ? 2 : 1), sequence: ++this.sequence };
    const key = peer.id + '\0' + activityId;
    if (processing === AutomationNotificationProcessing.CurrentThenMostRecent) {
      const current = this.currentNotifications.get(key);
      if (!current) { this.currentNotifications.set(key, { first: item, last: null }); this.enqueue(item); }
      else if (current.last) Object.assign(current.last, item);
      else { current.last = item; this.enqueue(item); }
      return;
    }
    const replace = [AutomationNotificationProcessing.ImportantMostRecent, AutomationNotificationProcessing.MostRecent].includes(processing);
    const previous = replace && this.notifications.get(key);
    if (previous) Object.assign(previous, item);
    else {
      if (replace) this.notifications.set(key, item);
      this.enqueue(item);
    }
  }
  enqueue(item) {
    if (this.disposed) return;
    if (this.queue.length >= this.maximum) throw new RangeError('SFAX013: Automation queue limit exceeded');
    this.queue.push(item);
    if (!this.pending) {
      this.pending = true;
      this.schedule(() => { if (!this.disposed) this.flush(); });
    }
  }
  flush() {
    if (this.disposed) return [];
    this.pending = false;
    const batch = this.queue.splice(0);
    this.properties.clear();
    this.notifications.clear();
    this.currentNotifications.clear();
    for (const item of batch) {
      if (item.kind === AutomationEvents.PropertyChanged && sameValue(item.oldValue, item.newValue)) continue;
      if (item.kind === AutomationEvents.Notification) this.liveRegions?.announce(item.text, item.level, item.sequence);
      try {
        this.onEvent(Object.freeze({ ...item }));
        for (const listener of this.listeners) listener(item);
      } catch (error) { this.onError(error); }
    }
    return batch;
  }
  remove(id) {
    this.queue = this.queue.filter(item => item.id !== id);
    for (const [key, item] of this.properties) if (item.id === id) this.properties.delete(key);
    for (const [key, item] of this.notifications) if (item.id === id) this.notifications.delete(key);
    for (const [key, item] of this.currentNotifications) if (item.first.id === id) this.currentNotifications.delete(key);
  }
  dispose() {
    this.disposed = true;
    this.queue.length = 0;
    this.properties.clear();
    this.notifications.clear();
    this.currentNotifications.clear();
    this.listeners.clear();
  }
}

/** A notification adds one text node; retained announcements are bounded and never steal focus. */
export class AutomationLiveRegions {
  constructor(document, { maximum = 8 } = {}) {
    this.maximum = maximum;
    this.layer = document.createElement('div');
    this.layer.dataset.sfAutomationLive = '';
    Object.assign(this.layer.style, { position: 'absolute', width: '1px', height: '1px', padding: '0', margin: '-1px',
      overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: '0', pointerEvents: 'none' });
    this.regions = new Map();
    for (const [level, name] of [[1, 'polite'], [2, 'assertive']]) {
      const region = document.createElement('div');
      region.setAttribute('aria-live', name);
      region.setAttribute('aria-relevant', 'additions text');
      region.setAttribute('aria-atomic', 'false');
      this.layer.append(region);
      this.regions.set(level, region);
    }
  }
  announce(text, level = 1, sequence = 0) {
    if (!text) return;
    const region = this.regions.get(level);
    if (!region) throw new RangeError('SFAX012: Invalid live-region politeness');
    const entry = region.ownerDocument.createElement('span');
    entry.dataset.announcement = String(sequence);
    entry.textContent = text;
    region.append(entry);
    while (region.childNodes.length > this.maximum) region.firstChild.remove();
  }
  dispose() { this.regions.clear(); this.layer.remove(); }
}
