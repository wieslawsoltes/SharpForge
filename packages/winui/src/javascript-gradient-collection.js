import {gradientCollectionType, gradientStopType, gradientFailure} from './gradient-data.js';

/** A bounded identity collection validates each operation before publishing a consumer refresh. */
export function createGradientStopCollection({owned, alive, refresh}) {
  const items = [];
  const index = (value, end = false) => {
    if (!Number.isInteger(value) || value < 0 || value >= items.length + (end ? 1 : 0)) throw new RangeError('Collection index');
    return value;
  };
  const stop = value => {
    if (!owned.has(value) || value.valueType !== gradientStopType) throw gradientFailure('An application GradientStop is required.');
    return value;
  };
  const addition = value => {
    stop(value);
    if (items.length >= 10000) throw new RangeError('GradientStopCollection limit');
    return value;
  };
  const result = {
    valueType: gradientCollectionType,
    get Count() { return items.length; },
    get_Item(value) { return items[index(value)]; },
    Add(value) { alive(); items.push(addition(value)); refresh(result); },
    Insert(at, value) { alive(); index(at, true); addition(value); items.splice(at, 0, value); refresh(result); },
    Remove(value) {
      alive();
      stop(value);
      const at = items.indexOf(value);
      if (at < 0) return false;
      this.RemoveAt(at);
      return true;
    },
    RemoveAt(at) { alive(); items.splice(index(at), 1); refresh(result); },
    Clear() { alive(); items.length = 0; refresh(result); },
    [Symbol.iterator]() { return items[Symbol.iterator](); }
  };
  owned.add(result);
  return Object.freeze(result);
}

export function createMutableGradientValue(type, initial, validators, {owned, alive, refresh}) {
  const data = {...initial};
  const result = {};
  Object.defineProperty(result, 'valueType', {value: type, enumerable: true});
  for (const key of Object.keys(initial)) Object.defineProperty(result, key, {
    enumerable: true,
    get: () => data[key],
    set: value => { alive(); data[key] = validators[key](value); refresh(result); }
  });
  owned.add(result);
  return Object.preventExtensions(result);
}
