import {fail} from '@sharpforge/bcl-core';

/** Natural guest completion remains inspectable; an explicit stop cancels the pending host continuation. */
export function hashSetActive(platform) {
  return platform.bclHost.isExecutionStopped?.(platform) !== true;
}

/** Explicit stop takes precedence over an observer failure after the version write has committed. */
export function notifyHashSetVersion(platform, reference, value) {
  if (!hashSetActive(platform)) return false;
  try {
    platform.set(reference, '$version', value);
  } catch (error) {
    if (hashSetActive(platform)) throw error;
  }
  return hashSetActive(platform);
}

function field(values, name) {
  for (let index = 0; index < values.length; index += 2) if (values[index] === name) return values[index + 1];
  return null;
}

function backing(platform, reference) {
  if (!reference) return null;
  const record = platform.heap.get(reference);
  return {reference, record, data: record.data};
}

/** A resize checkpoint belongs to this owner, not a heap-wide revision that also changes on unrelated work. */
export function hashSetStorageCheckpoint(platform, reference, publishedValues = null) {
  const record = platform.record(reference);
  const values = publishedValues ?? [...record.data];
  return {record, ownerData: publishedValues ? null : record.data, values,
    payload: backing(platform, field(values, '$data')), slots: backing(platform, field(values, '$slots'))};
}

function sameBacking(platform, expected) {
  return !expected || platform.heap.get(expected.reference) === expected.record && expected.record.data === expected.data;
}

/** A synchronous observer may change the set; retain that mutation and reject the stale outer preparation. */
export function checkHashSetStorage(platform, reference, expected) {
  if (!hashSetActive(platform)) return false;
  const record = platform.record(reference);
  if (record !== expected.record || expected.ownerData && record.data !== expected.ownerData ||
      record.data.length !== expected.values.length || record.data.some((value, index) => !Object.is(value, expected.values[index])) ||
      !sameBacking(platform, expected.payload) || !sameBacking(platform, expected.slots)) {
    fail(platform, 'InvalidOperationException', 'BCLHS0002: HashSet changed during storage allocation or notification');
  }
  return true;
}
