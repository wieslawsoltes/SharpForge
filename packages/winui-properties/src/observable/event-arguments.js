/** Immutable event payload with explicit managed-reference retention and rewind support. */
export class ObservableEventArguments {
  constructor(values) { this.values = Object.freeze({...values}); }
  snapshot() { return {version: 1, values: this.values}; }
  restore(snapshot) {
    if (snapshot?.version !== 1 || !snapshot.values) throw new TypeError('Invalid observable event snapshot');
    this.values = Object.freeze({...snapshot.values});
  }
  *retainedValues() {
    for (const value of Object.values(this.values)) {
      if (Array.isArray(value)) yield* value;
      else yield value;
    }
  }
}

export function collectionChangedArguments(action, args) {
  if (!Number.isInteger(action) || action < 0 || action > 4) throw new TypeError('Invalid collection change action');
  const values = {Action: action, NewItems: null, OldItems: null, NewStartingIndex: -1, OldStartingIndex: -1};
  if (action === 4) {
    if (args.length !== 1) throw new TypeError('Reset requires only a collection change action');
    return new ObservableEventArguments(values);
  }
  const index = args.at(-1);
  if (action === 0 || action === 1) {
    if (args.length !== 3 || !Number.isInteger(index) || index < -1) throw new TypeError('Invalid Add/Remove notification arguments');
    values[action === 0 ? 'NewItems' : 'OldItems'] = Object.freeze([args[1]]);
    values[action === 0 ? 'NewStartingIndex' : 'OldStartingIndex'] = index;
  } else if (action === 2) {
    if (args.length !== 4 || !Number.isInteger(index) || index < -1) throw new TypeError('Invalid Replace notification arguments');
    values.NewItems = Object.freeze([args[1]]);
    values.OldItems = Object.freeze([args[2]]);
    values.NewStartingIndex = values.OldStartingIndex = index;
  } else {
    if (args.length !== 4 || !Number.isInteger(args[2]) || !Number.isInteger(index) || args[2] < 0 || index < 0) {
      throw new TypeError('Invalid Move notification arguments');
    }
    values.NewItems = values.OldItems = Object.freeze([args[1]]);
    values.NewStartingIndex = args[2];
    values.OldStartingIndex = index;
  }
  return new ObservableEventArguments(values);
}
