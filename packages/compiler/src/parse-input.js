import { SourceText } from '@sharpforge/text';
import { parse, parseLanguageVersion } from '@sharpforge/syntax';

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
  if (typeof input === 'string' || input.length === 0) return [parseFile({ text: typeof input === 'string' ? input : '' })];
  return input.map(parseFile);
}
