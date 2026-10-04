import {workspaceRecordBytes} from '@sharpforge/workspace';
import {recordSource} from './workspace-records.js';
import {sourceByteLength} from './disk/source-content.js';

/** Capture immutable source roots and byte copies; a save never retains the live editor model. */
export function captureDiskSaveRecord(previous, change, path) {
  const source = recordSource(change);
  const text = Object.getOwnPropertyDescriptor(change, 'text');
  const binary = change.bytes;
  if (change.source !== undefined && !source) throw new TypeError('Save source must be an immutable snapshot');
  if (!source && typeof text?.value !== 'string' && !(binary instanceof Uint8Array)) {
    throw new TypeError('Save requires text, bytes or an immutable source snapshot');
  }
  const descriptors = {...Object.getOwnPropertyDescriptors(previous ?? {}), ...Object.getOwnPropertyDescriptors(change)};
  delete descriptors.model;
  delete descriptors.expectedHash;
  descriptors.path = {value: path, enumerable: true, configurable: true};
  if (descriptors.uri) descriptors.uri = {value: path, enumerable: descriptors.uri.enumerable, configurable: true};
  if (source) {
    descriptors.source = {value: source, configurable: true};
    descriptors.text = {get: () => source.getText(0, source.length), enumerable: true, configurable: true};
    if (descriptors.originalSource) descriptors.originalSource.enumerable = false;
  } else {
    delete descriptors.source;
    delete descriptors.originalSource;
    if (typeof text?.value !== 'string') {
      delete descriptors.text;
      delete descriptors.originalText;
    }
  }
  if (binary instanceof Uint8Array) {
    descriptors.bytes = {value: binary.slice(), enumerable: true, configurable: true};
  }
  return Object.defineProperties({}, descriptors);
}

/** Encoding is deferred until save preparation; shared bounded range encoding never reads the compatibility text getter. */
export async function encodeDiskSaveRecord(record, maximum, options = {}) {
  const source = recordSource(record);
  if (source || /\.cs$/i.test(record.path) && typeof record.text === 'string') {
    const size = await sourceByteLength(source ?? record.text, record, maximum, options);
    if (size > maximum) throw new RangeError('Encoded source exceeds the byte budget');
  }
  return workspaceRecordBytes(record, {maxBytes: maximum}).slice();
}
