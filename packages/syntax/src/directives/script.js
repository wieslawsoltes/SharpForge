/** Shebang (`#!`), C# 14 file-based-app `#:` directives and the script-only `#r` / `#load` directives. */
/**
 * `marker` is '!' or ':' for `#!`/`#:` lines, otherwise null with `name` set to 'r' or 'load'.
 * `context` is { offset, seenToken, afterIf, script }. Returns { kind, structure, diagnostics } or null.
 */
export function scanScriptDirective(marker, name, rest, context) {
  if (marker === '!') {
    if (context.offset !== 0)
      return {
        kind: 'BadDirectiveTrivia',
        structure: { directive: 'shebang', content: rest },
        diagnostics: [['CS1024', 'Preprocessor directive expected']]
      };
    return {
      kind: 'ShebangDirectiveTrivia',
      structure: { directive: 'shebang', content: rest.trim() },
      diagnostics:
        context.fileBasedProgram === false && !context.script
          ? [['CS9314', "'#!' directives can be only used in scripts or file-based programs"]]
          : []
    };
  }
  if (marker === ':') {
    // Roslyn does not gate `#:` by language version: outside a file-based program it reports CS9298 at every version.
    const content = rest.trim(),
      parts = /^(\S+)(?:\s+([\s\S]*))?$/.exec(content),
      diagnostics = [];
    if (context.fileBasedProgram === false)
      diagnostics.push(['CS9298', "'#:' directives can be only used in file-based programs ('-features:FileBasedProgram')", undefined, [1, 1]]);
    if (context.seenToken) diagnostics.push(['CS9297', "'#:' directives cannot be after first token in file"]);
    if (context.afterIf) diagnostics.push(['CS9299', "'#:' directives cannot be after '#if' directive"]);
    return {
      kind: 'IgnoredDirectiveTrivia',
      structure: { directive: 'ignored', content, key: parts?.[1] ?? null, value: parts?.[2] ?? null },
      diagnostics
    };
  }
  if (name === 'r' || name === 'load') {
    const file = /^[ \t]*"([^"]*)"(.*)$/.exec(rest),
      kind = name === 'r' ? 'ReferenceDirectiveTrivia' : 'LoadDirectiveTrivia',
      diagnostics = [];
    if (!context.script)
      diagnostics.push(name === 'r' ? ['CS7011', '#r is only allowed in scripts'] : ['CS8097', '#load is only allowed in scripts']);
    else if (!file) diagnostics.push(['CS7010', 'Quoted file name expected']);
    else if (context.seenToken) diagnostics.push(['CS7011', `Cannot use #${name} after first token in file`]);
    else if (!/^[ \t]*(?:\/\/.*)?$/.test(file[2])) diagnostics.push(['CS1025', 'Single-line comment or end-of-line expected']);
    return { kind, structure: { directive: name === 'r' ? 'reference' : 'load', file: file?.[1] ?? null }, diagnostics };
  }
  return null;
}
