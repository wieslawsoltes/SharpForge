export const DataPackageOperation = Object.freeze({ None: 0, Copy: 1, Move: 2, Link: 4 });
export const dragFormats = Object.freeze({ Text: 'text/plain', Html: 'text/html', Uri: 'text/uri-list' });
const effects = ['none', 'copy', 'move', 'copyMove', 'link', 'copyLink', 'linkMove', 'all'];
export const maximumDragBytes = 64 * 1024;

export function dragOperation(value, { single = false } = {}) {
  if (!Number.isInteger(value) || value < 0 || value > 7 || (single && ![0, 1, 2, 4].includes(value))) {
    throw new RangeError('SFUI1666: Invalid drag operation');
  }
  return value;
}
export function effectAllowed(value) { return effects[dragOperation(value)]; }
export function operationFromEffect(value) { return value === 'uninitialized' ? 7 : Math.max(0, effects.indexOf(value)); }
export function preferredOperation(value, event = {}) {
  value = dragOperation(value);
  const preferred = event.altKey ? 4 : event.ctrlKey ? 1 : event.shiftKey ? 2 : 0;
  return preferred && (preferred & value) ? preferred : [1, 2, 4].find(operation => operation & value) ?? 0;
}

/** Plain, bounded transport data; browser objects and callbacks never enter a scene or worker packet. */
export function validateDragData(data, { maximumBytes = maximumDragBytes } = {}) {
  if (!data || data.version !== 1 || !Array.isArray(data.values) || data.values.length > 3) {
    throw new TypeError('SFUI1666: Invalid drag data package');
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > maximumDragBytes) {
    throw new RangeError('SFUI1666: Invalid drag data byte limit');
  }
  let bytes = 0;
  const formats = new Set();
  const values = data.values.map(entry => {
    if (!Array.isArray(entry) || entry.length !== 2 || !Object.hasOwn(dragFormats, entry[0])
      || typeof entry[1] !== 'string' || formats.has(entry[0])) throw new TypeError('SFUI1666: Invalid drag data format');
    formats.add(entry[0]);
    bytes += entry[1].length * 2;
    if (bytes > maximumBytes) throw new RangeError('SFUI1666: Drag data exceeds the byte limit');
    if (entry[0] === 'Uri' && entry[1]) validateDragUri(entry[1]);
    return [...entry];
  });
  const result = { version: 1, values, requestedOperation: dragOperation(data.requestedOperation ?? 0) };
  if (data.externalFormats != null) {
    if (!Array.isArray(data.externalFormats) || data.externalFormats.some(value => value !== 'StorageItems')
      || data.externalFormats.length > 1) throw new TypeError('SFUI1666: Invalid external drag formats');
    result.externalFormats = [...data.externalFormats];
  }
  if (data.StorageToken != null) result.StorageToken = validateDropToken(data.StorageToken);
  if (data.StorageCount != null) {
    if (!Number.isInteger(data.StorageCount) || data.StorageCount < 0 || data.StorageCount > 256) {
      throw new RangeError('SFUI1666: Invalid storage item count');
    }
    result.StorageCount = data.StorageCount;
  }
  return result;
}

export function validateDropToken(token) {
  if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(token)) throw new TypeError('SFUI1667: Invalid drop capability token');
  return token;
}
export function validateDragUri(value) {
  const line = value.split(/\r?\n/).find(part => part && !part.startsWith('#'));
  if (!line) return '';
  const uri = new URL(line);
  if (!['https:', 'http:'].includes(uri.protocol) || uri.username || uri.password) throw new TypeError('SFUI1666: Unsupported dropped URI');
  return uri.href;
}

export function readDragData(transfer, { maximumBytes = maximumDragBytes, files, captureFiles = false } = {}) {
  const types = new Set(transfer?.types ?? []);
  const data = { version: 1, values: [], requestedOperation: operationFromEffect(transfer?.dropEffect ?? 'none') };
  for (const [format, mime] of Object.entries(dragFormats)) {
    const value = transfer?.getData(mime) ?? '';
    if (value || types.has(mime)) data.values.push([format, value]);
  }
  if (types.has('Files') || transfer?.files?.length) data.externalFormats = ['StorageItems'];
  if (captureFiles && transfer?.files?.length) {
    if (!files) throw new Error('SFUI1667: Storage drops require an application file broker');
    data.StorageToken = files.capture(transfer.files);
    data.StorageCount = transfer.files.length;
  }
  return validateDragData(data, { maximumBytes });
}

export function writeDragData(transfer, data) {
  const snapshot = validateDragData(data);
  if (!transfer) return;
  for (const [format, value] of snapshot.values) transfer.setData(dragFormats[format], value);
}
