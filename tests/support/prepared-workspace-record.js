import {PieceTable} from '@sharpforge/text';

export function prepared(path, text, options = {}) {
  const source = new PieceTable(text, {uri: path, version: options.version ?? 1}).snapshot();
  const record = {path, ...options};
  Object.defineProperties(record, {
    source: {value: source, configurable: true},
    text: {get() { throw new Error('Prepared compatibility text must remain lazy'); }, enumerable: true, configurable: true},
    model: {value: {disposed: false}, configurable: true}
  });
  return record;
}

export function referenceBytes(text, encoding = 'utf-8', bom = false) {
  if (encoding === 'utf-8') return Buffer.concat([bom ? Buffer.from([239, 187, 191]) : Buffer.alloc(0), Buffer.from(text)]);
  const body = Buffer.from(text, 'utf16le');
  if (encoding === 'utf-16be') body.swap16();
  const prefix = bom ? Buffer.from(encoding === 'utf-16be' ? [254, 255] : [255, 254]) : Buffer.alloc(0);
  return Buffer.concat([prefix, body]);
}

