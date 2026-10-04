import {SourceText} from '@sharpforge/text';
import {Compilation} from '@sharpforge/compiler';

/** Refresh generator output identities without discarding unchanged text; grammar changes are handled by syntax(). */
function generatedInputs(workspace, files, options, signal) {
  if (!workspace.extensions) {
    workspace.generatedDocuments.clear();
    return {files: [], diagnostics: []};
  }
  const generated = workspace.extensions.generate(files.map(file => file.source), {
    options: workspace.extensionOptions,
    additionalFiles: workspace.additionalFiles,
    signal,
  });
  const next = new Map();
  for (const file of generated.files) {
    const previous = workspace.generatedDocuments.get(file.uri);
    const document = previous?.source.text === file.text ? previous : {
      source: new SourceText(file.text, file.uri, (previous?.source.version ?? 0) + 1),
      parsed: null,
      generated: true,
    };
    next.set(file.uri, document);
  }
  workspace.generatedDocuments = next;
  files.push(...[...next.keys()].map(uri => workspace.syntax(uri, options)));
  return generated;
}

/** Preserve generator/analyzer diagnostics and the existing public compilation result shape. */
function analyzeExtensions(workspace, result, files, generated, signal) {
  if (!workspace.extensions) return;
  const diagnostics = workspace.extensions.analyze(result, files, {options: workspace.extensionOptions, signal});
  result.diagnostics.push(...generated.diagnostics, ...diagnostics);
  result.success = !result.diagnostics.some(diagnostic => diagnostic.severity === 'error');
  if (!result.success) result.image = null;
  result.metrics.errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').length;
  result.metrics.warnings = result.diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length;
  result.metrics.extensions = {...workspace.extensions.metrics};
  result.generatedSources = generated.files;
}

/** Compile with effective options, retaining complete result reuse and option-aware per-document parse reuse. */
export function compileWorkspace(workspace, {signal, ...provided} = {}) {
  const options = {...workspace.compilationOptions, ...provided};
  if (signal?.aborted) throw new DOMException('Compilation cancelled', 'AbortError');
  const optionKey = JSON.stringify([
    Object.keys(options).sort().map(key => [key, options[key]]),
    workspace.extensions?.revision ?? 0,
    workspace.extensionOptions,
    workspace.additionalFiles,
  ]);
  if (workspace.result && workspace.resultExtensions === workspace.extensions && workspace.resultOptionKey === optionKey) {
    workspace.metrics.compilationCacheHits++;
    return workspace.result;
  }
  const started = performance.now();
  const beforeParsed = workspace.metrics.parsedDocuments;
  const files = [...workspace.documents.keys()].map(uri => workspace.syntax(uri, options));
  if (!files.length) return {success: false, image: null, diagnostics: [], symbols: [], references: [], metrics: {}};
  const parseMs = performance.now() - started;
  const generated = generatedInputs(workspace, files, options, signal);
  const compilation = new Compilation(files, options);
  const result = compilation.build();
  analyzeExtensions(workspace, result, files, generated, signal);
  if (signal?.aborted) throw new DOMException('Compilation cancelled', 'AbortError');
  result.metrics.totalMs = performance.now() - started;
  result.metrics.parseMs = parseMs;
  result.metrics.parsedThisCompilation = workspace.metrics.parsedDocuments - beforeParsed;
  result.metrics.reusedDocuments = files.length - result.metrics.parsedThisCompilation;
  result.revision = workspace.revision;
  workspace.result = result;
  workspace.compilation = compilation;
  workspace.resultOptionKey = optionKey;
  workspace.resultExtensions = workspace.extensions;
  return result;
}
