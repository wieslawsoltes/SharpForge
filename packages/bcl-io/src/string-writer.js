import {bclScalar, fail, integer, string} from '@sharpforge/bcl-core';
import {appendWriterBuilder, createWriterBuilder, writerBuilderText} from './string-writer-builder.js';
import {writeStringBuffer} from './string-writer-buffer.js';

const writerType = 'System.IO.StringWriter';
const builderType = 'System.Text.StringBuilder';
// The released text execution profile uses LF. An OS/culture provider is a separate #2723 prerequisite.
const defaultNewLine = '\n';

function construct(platform, args) {
  const builder = args.length ? args[0] : createWriterBuilder(platform);
  if (builder == null) fail(platform, 'ArgumentNullException', 'A StringBuilder is required');
  if (platform.record(builder).type !== builderType) fail(platform, 'ArgumentException', 'A StringBuilder is required');
  return platform.heap.withRoots([builder], () => {
    const newline = platform.heap.string(defaultNewLine);
    return platform.make(writerType, {$builder: builder, $newLine: newline, $disposed: false});
  });
}

function requireWriter(platform, reference) {
  if (reference == null) fail(platform, 'NullReferenceException', 'A text writer is required');
  if (platform.record(reference).type !== writerType) {
    fail(platform, 'NotSupportedException', 'Only StringWriter is supported by this text writer profile');
  }
}

function setNewLine(platform, reference, value) {
  string(platform, value, true);
  const newline = value === null ? platform.heap.string(defaultNewLine) : value;
  return platform.heap.withRoots([newline], () => {
    platform.set(reference, '$newLine', newline);
    return null;
  });
}

function requireOpen(platform, reference) {
  if (platform.get(reference, '$disposed')) fail(platform, 'ObjectDisposedException', 'Cannot write to a closed TextWriter');
}

function appendNewLine(platform, builder, reference) {
  appendWriterBuilder(platform, builder, platform.get(reference, '$newLine'));
}

function write(platform, descriptor, reference, value) {
  const builder = platform.get(reference, '$builder');
  if (descriptor.parameters[0] === 'char') {
    const unit = integer(platform, bclScalar(platform, value), 0, 65535);
    appendWriterBuilder(platform, builder, String.fromCharCode(unit));
    // TextWriter.WriteLine(char) re-enters the parameterless newline gate after Write(char).
    if (descriptor.name === 'WriteLine') requireOpen(platform, reference);
  } else if (descriptor.parameters.length) {
    string(platform, value, true);
    if (value !== null) appendWriterBuilder(platform, builder, value);
  }
  // Keep these separate: a failed newline append retains an already-written value, as TextWriter does.
  if (descriptor.name === 'WriteLine') appendNewLine(platform, builder, reference);
  return null;
}

/** Preserve managed builder identity across disposal and snapshots; writes consume UTF-16 units. */
export function invokeStringWriter(platform, descriptor, args) {
  if (descriptor.kind === 'constructor') return construct(platform, args);
  const reference = args[0];
  requireWriter(platform, reference);
  if ((descriptor.name === 'Write' || descriptor.name === 'WriteLine') && descriptor.parameters[0] === 'char[]') {
    writeStringBuffer(platform, reference, args, descriptor.parameters.length === 1);
    if (descriptor.name === 'WriteLine') {
      // Inherited buffer overloads call parameterless WriteLine after the completed buffer write.
      requireOpen(platform, reference);
      appendNewLine(platform, platform.get(reference, '$builder'), reference);
    }
    return null;
  }
  switch (descriptor.name) {
    case 'get_NewLine': return platform.get(reference, '$newLine');
    case 'set_NewLine': return setNewLine(platform, reference, args[1]);
    case 'GetStringBuilder': return platform.get(reference, '$builder');
    case 'ToString': return writerBuilderText(platform, platform.get(reference, '$builder'));
    case 'Flush': return null;
    case 'Close':
    case 'Dispose':
      platform.set(reference, '$disposed', true);
      return null;
    case 'Write':
    case 'WriteLine':
      requireOpen(platform, reference);
      return write(platform, descriptor, reference, args[1]);
    default: return fail(platform, 'MissingMethodException', descriptor.name);
  }
}
