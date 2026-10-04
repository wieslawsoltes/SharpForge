import { baseName, directoryName } from '../paths.js';
import { getCaseInsensitive, fail } from './errors.js';

/** Built-in metadata is computed from the item specification, defining import, and project directory. */
export function wellKnownMetadata(item, context, requested) {
  const identity = String(item.identity ?? item.path ?? '');
  const needsPath = requested === undefined || ['fullpath', 'rootdir', 'directory'].includes(requested.toLowerCase());
  const fullPath = needsPath ? '/' + context.resolvePath(identity) : '';
  const file = baseName(identity.replaceAll('\\', '/'));
  const extensionAt = file.lastIndexOf('.');
  const directory = directoryName(fullPath);
  const relativeDirectory = directoryName(identity.replaceAll('\\', '/'));
  const defining = item.definingProject ?? context.currentFile ?? context.path;
  const definingName = baseName(defining);
  const definingExtension = definingName.lastIndexOf('.');
  return {
    FullPath: fullPath, RootDir: '/', Filename: extensionAt < 0 ? file : file.slice(0, extensionAt),
    Extension: extensionAt < 0 ? '' : file.slice(extensionAt),
    RelativeDir: relativeDirectory ? relativeDirectory + '/' : '',
    Directory: directory.slice(1) ? directory.slice(1) + '/' : '', RecursiveDir: item.recursiveDir ?? '', Identity: identity,
    DefiningProjectFullPath: '/' + defining, DefiningProjectDirectory: '/' + (directoryName(defining) ? directoryName(defining) + '/' : ''),
    DefiningProjectName: definingExtension < 0 ? definingName : definingName.slice(0, definingExtension),
    DefiningProjectExtension: definingExtension < 0 ? '' : definingName.slice(definingExtension),
  };
}

export function getItemMetadata(item, name, context) {
  const builtin = getCaseInsensitive(wellKnownMetadata(item, context, name), name);
  return builtin ?? getCaseInsensitive(item.metadata, name) ?? '';
}

/** Metadata outside an item, definition or batching context is rejected, never compared as literal text. */
export function expandMetadata(body, context) {
  const parts = body.trim().split('.');
  if (parts.length > 2 || !parts.at(-1)) fail(`Invalid metadata reference '%(${body})'.`, 'MSB4191');
  const [type, name] = parts.length === 2 ? parts : [null, parts[0]];
  const item = type && context.batchItems ? getCaseInsensitive(context.batchItems, type)?.[0]
    : context.currentItem ?? context.metadataItem;
  if (!item) fail(`Metadata reference '%(${body})' requires an item or batching context.`, 'MSB4191');
  if (type && type.toLowerCase() !== item.itemType.toLowerCase() && type.toLowerCase() !== item.sourceItemType?.toLowerCase()) return '';
  return getItemMetadata(item, name, context);
}
