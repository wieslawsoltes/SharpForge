import {ManagedFault} from '../heap.js';

const type = 'Microsoft.UI.Xaml.Markup.XamlParseException';
const position = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647 ? value : 1;

/** Preserve XAML source locations in a normal managed exception record so source and direct CIL catch the same type. */
export function createManagedXamlException(context, error) {
  const lineNumber = position(error.lineNumber), linePosition = position(error.linePosition);
  const message = `${error.code ?? 'XamlParseException'}: ${String(error.message).slice(0, 65536)} `
    + `(Line ${lineNumber}, position ${linePosition})`;
  const heap = context.platform.heap;
  const text = heap.string(message);
  const reference = heap.allocate('exception', type, [text, lineNumber, linePosition]);
  return new ManagedFault(type, message, reference);
}

export function managedXamlExceptionInfo(context, reference) {
  const record = context.platform.heap.get(reference);
  if (record.kind !== 'exception' || record.type !== type) {
    throw new ManagedFault('InvalidCastException', 'A XamlParseException record is required');
  }
  return {lineNumber: record.data[1], linePosition: record.data[2]};
}
