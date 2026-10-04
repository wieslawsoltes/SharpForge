import { MetadataLanguageModel } from '@sharpforge/compiler';

function sameReferences(left, right) {
  return left?.length === right.length && right.every((reference, index) => {
    const previous = left[index];
    return previous.bytes === reference.bytes && previous.assembly === reference.assembly
      && previous.display === reference.display && previous.runtimeProfile === reference.runtimeProfile
      && JSON.stringify(previous.aliases) === JSON.stringify(reference.aliases);
  });
}

/** Own decoded assembly/query state for one workspace; edits invalidate source binding without re-reading metadata. */
export class MetadataLanguageSession {
  constructor(workspace) {
    this.workspace = workspace;
    this.references = null;
    this.model = null;
    this.key = null;
  }

  current() {
    const options = this.workspace.compilationOptions;
    const references = options.references ?? [];
    if (!references.length) {
      this.model = null;
      this.references = null;
      this.key = null;
      return null;
    }
    const inputs = new Map(this.workspace.generatedDocuments);
    for (const [uri, document] of this.workspace.documents) inputs.set(uri, document);
    const files = [...inputs.values()].map(document => ({
      uri: document.source.uri, text: document.source.text, version: document.source.version
    }));
    const { references: omitted, signal: ignored, ...settings } = options;
    const key = JSON.stringify([this.workspace.revision, files.map(file => [file.uri, file.version]), settings]);
    if (!sameReferences(this.references, references)) {
      this.references = references.map(reference => ({ ...reference, aliases: reference.aliases?.slice() }));
      this.model = new MetadataLanguageModel(files, options);
      this.key = key;
    } else if (key !== this.key) {
      this.model.update(files, options);
      this.key = key;
    }
    return this.model;
  }

  symbolAt(uri, offset) {
    const symbol = this.current()?.symbolAt(uri, offset);
    return symbol?.metadata ? symbol : null;
  }

  diagnostics(uri) {
    return this.current()?.analyze().diagnostics.filter(diagnostic => diagnostic.uri === uri) ?? null;
  }
}
