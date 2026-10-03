import { SourceText } from '@sharpforge/text';
import { parse, parseLanguageVersion } from '@sharpforge/syntax';
import { implicitUsingsUnit } from './binder/global-usings.js';

/** Parse text inputs with each file's grammar version; callers supplying trees retain responsibility for their parse options. */
export function parseCompilerInput(input, options) {
  const symbols = options.preprocessorSymbols;
  const preprocessorSymbols = Array.isArray(symbols) ? symbols : String(symbols ?? '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
  const parseFile = file => {
    if (file.root) return file;
    const source = new SourceText(file.text, file.uri, file.version);
    const selected = options.langVersionByUri?.[source.uri] ?? options.langVersion ?? '14';
    // The compilation reports invalid values once as CS1617; do not generate misleading gates from a fallback version.
    const languageVersion = parseLanguageVersion(selected) ? selected : undefined;
    return parse(source, undefined, { preprocessorSymbols, languageVersion });
  };
  const files =
    typeof input === 'string' || input.length === 0 ? [parseFile({ text: typeof input === 'string' ? input : '' })] : input.map(parseFile);
  // Implicit usings are one more compilation unit of global using directives, placed last so the first file stays first.
  const implicit = implicitUsingsUnit(options.implicitUsings);
  if (implicit && !files.some(file => file.source.uri === implicit.uri)) files.push(parseFile(implicit));
  return files;
}
