import {defaultStringOrdering} from '@sharpforge/bcl-core';

function compare(vm, left, right) {
  const first = vm.value(left), second = vm.value(right);
  if (first === null || second === null) return first === second ? 0 : first === null ? -1 : 1;
  if (typeof first === 'number' && typeof second === 'number') {
    if (Number.isNaN(first)) return Number.isNaN(second) ? 0 : -1;
    if (Number.isNaN(second)) return 1;
    return first < second ? -1 : first > second ? 1 : 0;
  }
  if (typeof first === 'bigint' && typeof second === 'bigint' || typeof first === 'boolean' && typeof second === 'boolean') {
    return first < second ? -1 : first > second ? 1 : 0;
  }
  return defaultStringOrdering(vm.platform ?? vm).compare(String(first), String(second));
}

function swap(data, first, second) {
  const value = data[first];
  data[first] = data[second];
  data[second] = value;
}

export function reverseArrayStep(_vm, state, records) {
  if (state.index >= state.end) return true;
  swap(records.destination.data, state.index++, state.end--);
  return state.index >= state.end;
}

/** One heapsort step performs at most two comparisons and one swap: O(1) space, O(n log n) total. */
export function sortArrayStep(vm, state, records) {
  const data = records.destination.data;
  if (!state.sifting) {
    if (state.phase === 'build') {
      if (state.buildIndex < 0) {
        state.phase = 'extract';
        return false;
      }
      state.root = state.buildIndex--;
      state.sifting = true;
    } else {
      if (state.end <= 0) return true;
      swap(data, 0, state.end--);
      state.root = 0;
      state.sifting = true;
    }
  }
  const child = state.root * 2 + 1;
  if (child > state.end) {
    state.sifting = false;
    return false;
  }
  const greater = child + 1 <= state.end && compare(vm, data[child], data[child + 1]) < 0 ? child + 1 : child;
  if (compare(vm, data[state.root], data[greater]) >= 0) {
    state.sifting = false;
    return false;
  }
  swap(data, state.root, greater);
  state.root = greater;
  return false;
}
