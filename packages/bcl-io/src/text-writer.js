import {invokeStringWriter} from './string-writer.js';

const parentType = 'System.IO.TextWriter';
const writerType = 'System.IO.StringWriter';
const builderType = 'System.Text.StringBuilder';

function contracts({define, member, ctor, prop}) {
  define(parentType, {kind: 'bcl', family: 'textWriter', isAbstract: true, interfaces: ['System.IDisposable']});
  define(writerType, {kind: 'bcl', family: 'textWriter', base: parentType});
  prop(parentType, 'NewLine', 'string');
  for (const type of ['char', 'string']) member(parentType, 'Write', [type], 'void');
  for (const parameters of [[], ['string']]) member(parentType, 'WriteLine', parameters, 'void');
  for (const name of ['Flush', 'Close', 'Dispose']) member(parentType, name, [], 'void');
  ctor(writerType);
  ctor(writerType, [builderType]);
  member(writerType, 'GetStringBuilder', [], builderType);
  member(writerType, 'ToString', [], 'string', {objectToStringOverride: true});
}

function invoke(platform, descriptor, args, type = platform.bclHost.frameworkType(descriptor.owner)) {
  if (type?.kind !== 'bcl' || type.family !== 'textWriter') return {handled: false};
  return {handled: true, value: invokeStringWriter(platform, descriptor, args)};
}

/** Synchronous StringWriter and inherited TextWriter primitives, appended after the reader contracts. */
export const stringWriterModule = Object.freeze({name: 'string-writer', group: 'bcl-io', families: ['textWriter'], contracts, invoke});
