import {ObservableVector} from './observable-vector.js';
import {ObservableEventArguments} from './event-arguments.js';
import {propertyValuesEqual} from '../property/value-equality.js';

const eventTypes = Object.freeze({
  PropertyChanged: 'System.ComponentModel.PropertyChangedEventArgs',
  CollectionChanged: 'System.Collections.Specialized.NotifyCollectionChangedEventArgs'
});

/** Managed/JS ObservableCollection events retain delegates only while their owner remains alive. */
export class ObservableCollectionModel extends ObservableVector {
  constructor(context, options = {}) {
    super([], options);
    this.context = context;
    this.receiver = null;
    this.events = new Map();
    this.onDelta = delta => {
      this.context.vectorChanged?.(this.receiver, delta);
      this.context.services?.observableChanged?.(this.receiver, delta);
    };
  }

  addEvent(name, callback) {
    if (!eventTypes[name]) throw new TypeError('Unknown observable event');
    const deliver = change => {
      const values = name === 'PropertyChanged' ? {PropertyName: change.propertyName} : {
        Action: change.Action, NewItems: change.NewItems, OldItems: change.OldItems,
        NewStartingIndex: change.NewStartingIndex, OldStartingIndex: change.OldStartingIndex
      };
      const argument = this.context.wrapModel(new ObservableEventArguments(values), eventTypes[name]);
      this.context.invokeManaged(callback, [this.receiver, argument]);
    };
    const dispose = name === 'PropertyChanged' ? this.subscribePropertyChanged(deliver) : this.subscribe(deliver);
    const entries = this.events.get(name) ?? [];
    entries.push({callback, dispose});
    this.events.set(name, entries);
  }

  removeEvent(name, callback) {
    const entries = this.events.get(name) ?? [];
    for (let index = entries.length - 1; index >= 0; index--) {
      if (!propertyValuesEqual(entries[index].callback, callback)) continue;
      entries[index].dispose();
      entries.splice(index, 1);
      return;
    }
  }

  *retainedValues() {
    yield* super.retainedValues();
    for (const entries of this.events.values()) for (const entry of entries) yield entry.callback;
  }

  snapshot() {
    return {...super.snapshot(), receiver: this.receiver,
      events: [...this.events].map(([name, entries]) => [name, entries.map(entry => ({...entry}))])};
  }

  restore(snapshot) {
    if (!Array.isArray(snapshot.events) || snapshot.events.length > 2) throw new TypeError('Invalid observable event snapshot');
    const events = new Map();
    let count = 0;
    for (const [name, entries] of snapshot.events) {
      if (!eventTypes[name] || events.has(name) || !Array.isArray(entries) || (count += entries.length) > this.maxListeners
        || entries.some(entry => !entry || typeof entry.dispose !== 'function')) throw new TypeError('Invalid observable callback snapshot');
      events.set(name, entries.map(entry => ({...entry})));
    }
    super.restore(snapshot);
    this.events = events;
    this.receiver = snapshot.receiver;
  }

  dispose() {
    super.dispose();
    this.events.clear();
    this.receiver = null;
  }
}
