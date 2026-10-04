import {fail, integer, string, text} from '../host.js';

const owner = 'System.Text.StringBuilder';

/** Register fixed-length UTF-16 edits after the established A07 append point. */
export function registerStringBuilderCharacterEditExtensions({member}) {
  member(owner, 'Replace', ['char', 'char'], owner);
  member(owner, 'Replace', ['char', 'char', 'int', 'int'], owner);
}

/** Append exact character insertion without moving the earlier edit contracts. */
export function registerStringBuilderCharacterInsertExtensions({member}) {
  member(owner, 'Insert', ['int', 'char'], owner);
}

/** Append Boolean insertion after the established ranged replacement contract. */
export function registerStringBuilderBooleanInsertExtensions({member}) {
  member(owner, 'Insert', ['int', 'bool'], owner);
}

function rangeError(platform, parameter) {
  fail(platform, 'ArgumentOutOfRangeException', "Value is outside the builder range. (Parameter '" + parameter + "')");
}

function insertionIndex(platform, reference, index) {
  const length = platform.get(reference, '$length', 0);
  if (!Number.isInteger(index) || index < 0 || index > length) rangeError(platform, 'index');
  return index;
}

/** Convert one Char after native index validation, then reuse the released bounded text insertion. */
export function insertBuilderCharacter(platform, reference, values, insertText) {
  const index = insertionIndex(platform, reference, values[0]);
  const unit = integer(platform, values[1], 0, 65535);
  return insertText(platform, reference, index, String.fromCharCode(unit));
}

/** Format Boolean carriers as invariant True/False after validation, using the existing insertion storage path. */
export function insertBuilderBoolean(platform, reference, values, insertText) {
  const index = insertionIndex(platform, reference, values[0]);
  return insertText(platform, reference, index, text(platform, values[1], 'bool'));
}

function stageChunks(platform, storage, count, range) {
  const items = platform.heap.get(storage).data;
  const changes = [];
  let position = 0;
  for (let slot = 0; slot < count && position < range.end; slot++) {
    const previous = items[slot];
    const value = string(platform, previous);
    const start = Math.max(0, range.start - position);
    const end = Math.min(value.length, range.end - position);
    position += value.length;
    if (start >= end) continue;
    const match = value.indexOf(range.oldUnit, start);
    if (match < 0 || match >= end) continue;
    // Replacement is exactly one UTF-16 unit, so even '$' cannot form a replacement-pattern sequence.
    const text = value.slice(0, start) + value.slice(start, end).replaceAll(range.oldUnit, range.newUnit) + value.slice(end);
    const replacement = platform.heap.string(text);
    platform.heap.pins.push(previous, replacement);
    changes.push({slot, previous, replacement});
  }
  return changes;
}

const sameReference = (first, second) => first?.h === second.h && first?.g === second.g;

function commitChanges(platform, reference, storage, changes) {
  let rootedStorage = storage;
  let wrote = false;
  for (const {slot, previous, replacement} of changes) {
    if (slot >= platform.get(reference, '$count', 0)) continue;
    const liveStorage = platform.get(reference, '$data');
    const items = platform.heap.get(liveStorage).data;
    // Reentrant edits win. Appends may move the array while keeping these original slots intact.
    if (!sameReference(items[slot], previous)) continue;
    if (!sameReference(liveStorage, rootedStorage)) {
      platform.heap.pins.push(liveStorage);
      rootedStorage = liveStorage;
    }
    items[slot] = replacement;
    wrote = true;
    if (platform.vm.notifyWrite) {
      platform.vm.notifyWrite({kind: 'array', handle: liveStorage.h, generation: liveStorage.g,
        index: slot, oldValue: previous, value: replacement});
    } else {
      platform.heap.mutationRevision++;
    }
  }
  if (wrote) platform.set(reference, '$version', platform.get(reference, '$version', 0) + 1);
  return reference;
}

/** Validate native range order, then replace only changed chunks; staging faults leave the builder untouched. */
export function replaceBuilderCharacters(platform, reference, values) {
  const length = platform.get(reference, '$length', 0);
  const start = values.length === 4 ? values[2] : 0;
  const count = values.length === 4 ? values[3] : length;
  if (!Number.isInteger(start) || start < 0 || start > length) rangeError(platform, 'startIndex');
  if (!Number.isInteger(count) || count < 0 || count > length - start) rangeError(platform, 'count');
  const oldUnit = integer(platform, values[0], 0, 65535);
  const newUnit = integer(platform, values[1], 0, 65535);
  if (count === 0 || oldUnit === newUnit) return reference;
  const storage = platform.get(reference, '$data');
  const range = {start, end: start + count, oldUnit: String.fromCharCode(oldUnit), newUnit: String.fromCharCode(newUnit)};
  return platform.heap.withRoots([storage], () => {
    const changes = stageChunks(platform, storage, platform.get(reference, '$count', 0), range);
    return commitChanges(platform, reference, storage, changes);
  });
}
