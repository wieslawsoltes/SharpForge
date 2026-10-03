import {parse, parseLanguageVersion} from '@sharpforge/syntax';

/** Grammar identity excludes warning and emission settings; symbol order and duplicate definitions do not affect parsing. */
function grammarOptions(uri, options) {
  const written = options.langVersionByUri?.[uri] ?? options.langVersion;
  const selected = parseLanguageVersion(written);
  const languageVersion = selected?.preview ? 'preview' : selected?.number;
  const symbols = options.preprocessorSymbols;
  const list = Array.isArray(symbols) ? symbols : typeof symbols === 'string' ? symbols.split(/[;,]/) : [];
  const preprocessorSymbols = [...new Set(list.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))].sort();
  return {languageVersion, preprocessorSymbols};
}

/** Parse one user or generated document, reusing its tree only while the effective grammar settings are identical. */
export function documentSyntax(workspace, uri, options = workspace.compilationOptions) {
  const document = workspace.documents.get(uri) ?? workspace.generatedDocuments.get(uri);
  if (!document) throw new Error(`Unknown document '${uri}'`);
  const settings = grammarOptions(uri, options);
  const key = JSON.stringify(settings);
  if (document.parsed && document.parseOptionsKey === key) {
    workspace.metrics.syntaxCacheHits++;
    return document.parsed;
  }
  const started = performance.now();
  const parsed = parse(document.source, workspace.tokenCache, settings);
  workspace.result = null;
  document.parsed = parsed;
  document.parseOptionsKey = key;
  document.parseMs = performance.now() - started;
  workspace.metrics.parsedDocuments++;
  return parsed;
}
