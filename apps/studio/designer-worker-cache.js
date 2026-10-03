import {sameDesignerSources} from './designer-source-snapshots.js';
export {sameDesignerSources} from './designer-source-snapshots.js';

export function designerAnalysisOptions(params) {
  return {
    uri: params.uri,
    className: params.className ?? params.previous?.ownership?.className,
    methodName: params.methodName ?? params.previous?.ownership?.methodName ?? params.previous?.method?.name,
    previous: params.previous,
    signal: params.signal,
    projectTypes: params.projectTypes ?? params.previous?.document?.projectTypes,
    compilationOptions: {...params.compilationOptions, outputKind: 'library'}
  };
}

function stableContext(value) {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
}

function contextKey(params) {
  const options = designerAnalysisOptions(params);
  return stableContext({uri: options.uri, className: options.className, methodName: options.methodName,
    projectTypes: options.projectTypes, compilationOptions: options.compilationOptions,
    assemblyName: params.assemblyName, extensions: params.extensions, workspaceId: params.workspaceId,
    previousDocument: params.previous?.document, previousBindings: params.previous?.bindings});
}

/** A bounded per-worker cache isolates owner, method, compiler options, descriptors, identities and preview metadata. */
export class DesignerWorkerAnalysisCache {
  constructor({maxDocuments = 4, maxCharacters = 512000} = {}) {
    if (!Number.isSafeInteger(maxDocuments) || maxDocuments < 0 || maxDocuments > 256
      || !Number.isSafeInteger(maxCharacters) || maxCharacters < 0) {
      throw new RangeError('Designer cache limits must be nonnegative safe integers, with at most 256 documents.');
    }
    this.maxDocuments = maxDocuments;
    this.maxCharacters = maxCharacters;
    this.entries = new Map();
    this.characters = 0;
  }

  get(params, sources) {
    const key = contextKey(params);
    const entry = this.entries.get(key);
    if (!entry || !sameDesignerSources(entry.analysis.sources, sources)) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.analysis;
  }

  set(params, analysis) {
    const key = contextKey(params);
    const previous = this.entries.get(key);
    if (previous) this.characters -= previous.characters;
    this.entries.delete(key);
    const characters = key.length + analysis.sources.reduce((sum, file) => sum + file.text.length, 0);
    this.entries.set(key, {analysis, characters});
    this.characters += characters;
    while (this.entries.size && (this.entries.size > this.maxDocuments || this.characters > this.maxCharacters)) {
      const oldest = this.entries.keys().next().value;
      this.characters -= this.entries.get(oldest).characters;
      this.entries.delete(oldest);
    }
  }

  clear() { this.entries.clear(); this.characters = 0; }
}
