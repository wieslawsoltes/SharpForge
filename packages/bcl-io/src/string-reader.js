import {fail, string} from '@sharpforge/bcl-core';

const readerType = 'System.IO.StringReader';

function requireReader(platform, reference) {
  if (reference == null) fail(platform, 'NullReferenceException', 'A text reader is required');
  if (platform.record(reference).type !== readerType) {
    fail(platform, 'NotSupportedException', 'Only StringReader is supported by this text reader profile');
  }
}

function dispose(platform, reference) {
  platform.set(reference, '$disposed', true);
  platform.set(reference, '$source', null);
  platform.set(reference, '$position', 0);
  return null;
}

function readUnit(platform, reference, source, position, advance) {
  if (position >= source.length) return -1;
  const value = source.charCodeAt(position);
  if (advance) platform.set(reference, '$position', position + 1);
  return value;
}

function returnText(platform, reference, text, nextPosition) {
  // A failed managed allocation must not consume input. The write observer may collect the returned string.
  const result = platform.managed(text, 'string');
  return platform.heap.withRoots([result], () => {
    platform.set(reference, '$position', nextPosition);
    return result;
  });
}

function readLine(platform, reference, source, position) {
  if (position >= source.length) return null;
  let end = position;
  while (end < source.length && source.charCodeAt(end) !== 13 && source.charCodeAt(end) !== 10) end++;
  let next = end;
  if (next < source.length) {
    next++;
    if (source.charCodeAt(end) === 13 && source.charCodeAt(next) === 10) next++;
  }
  return returnText(platform, reference, source.slice(position, end), next);
}

/** Read UTF-16 code units from managed state; EOF is -1/null/empty according to the requested method. */
export function invokeStringReader(platform, descriptor, args) {
  if (descriptor.kind === 'constructor') {
    string(platform, args[0]);
    return platform.make(readerType, {$source: args[0], $position: 0, $disposed: false});
  }
  const reference = args[0];
  requireReader(platform, reference);
  if (descriptor.name === 'Close' || descriptor.name === 'Dispose') return dispose(platform, reference);
  if (platform.get(reference, '$disposed')) fail(platform, 'ObjectDisposedException', 'Cannot read from a closed TextReader');
  const source = string(platform, platform.get(reference, '$source'));
  const position = platform.get(reference, '$position');
  switch (descriptor.name) {
    case 'Peek': return readUnit(platform, reference, source, position, false);
    case 'Read': return readUnit(platform, reference, source, position, true);
    case 'ReadLine': return readLine(platform, reference, source, position);
    case 'ReadToEnd': return returnText(platform, reference, source.slice(position), source.length);
    default: return fail(platform, 'MissingMethodException', descriptor.name);
  }
}
