import {invokeStringReader} from './string-reader.js';

const parentType = 'System.IO.TextReader';
const readerType = 'System.IO.StringReader';

function contracts({define, member, ctor}) {
  // IDisposable already has compiler/runtime intrinsic metadata. No new method ID is needed here.
  define('System.IDisposable', {kind: 'interface'});
  define(parentType, {kind: 'bcl', family: 'textReader', isAbstract: true, interfaces: ['System.IDisposable']});
  define(readerType, {kind: 'bcl', family: 'textReader', base: parentType});
  for (const name of ['Peek', 'Read']) member(parentType, name, [], 'int');
  for (const name of ['ReadLine', 'ReadToEnd']) member(parentType, name, [], 'string');
  for (const name of ['Close', 'Dispose']) member(parentType, name, [], 'void');
  ctor(readerType, ['string']);
}

function extensionContracts({member}) {
  for (const name of ['Read', 'ReadBlock']) member(parentType, name, ['char[]', 'int', 'int'], 'int');
}

function invoke(platform, descriptor, args, type = platform.bclHost.frameworkType(descriptor.owner)) {
  if (type?.kind !== 'bcl' || type.family !== 'textReader') return {handled: false};
  return {handled: true, value: invokeStringReader(platform, descriptor, args)};
}

/** Synchronous StringReader and inherited TextReader calls, including bounded UTF-16 buffer slices. */
export const stringReaderModule = Object.freeze({
  name: 'string-reader', group: 'bcl-io', families: ['textReader'], contracts, extensionContracts, invoke
});
