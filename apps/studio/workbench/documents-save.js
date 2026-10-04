import { documentSource } from './document-source.js';

/** Capture the current source root without invoking an enumerable compatibility text getter. */
export function captureDocumentSave(record, model) {
  const source = documentSource(record, model);
  const descriptors = Object.getOwnPropertyDescriptors(record);
  delete descriptors.model;
  delete descriptors.originalSource;
  delete descriptors.source;
  delete descriptors.length;
  descriptors.version = { value: source?.version ?? record.version, enumerable: true };
  descriptors.text = source ? { enumerable: true, get: () => source.text } : { value: record.text, enumerable: true };
  if (source) {
    descriptors.source = { value: source, enumerable: false };
    descriptors.length = { value: source.length, enumerable: false };
  }
  return Object.freeze(Object.defineProperties({}, descriptors));
}

/** A late save owns its captured baseline, but can only mark that exact current model revision clean. */
export function savedModelBaseline(model, options) {
  const published = documentSource(null, model);
  const source = options.source;
  if (source !== undefined) {
    const version = options.version ?? source?.version;
    if (!source || !Object.isFrozen(source) || source.uri !== model.uri || source.version !== version
        || !Number.isSafeInteger(version) || typeof source.getText !== 'function') {
      throw new TypeError('Saved source must be an immutable snapshot matching the document URI and saved version');
    }
    return { baseline: source, stale: version !== published.version || source !== published };
  }
  const { version, text } = options;
  if (version !== undefined && version !== published.version || text !== undefined && text !== published.text) {
    return text === undefined ? null : { baseline: text, stale: true };
  }
  return { baseline: published, stale: false };
}
