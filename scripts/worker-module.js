const identifier = /^[A-Za-z_$][\w$]*$/;

function bindings(list, description) {
  const result = [];
  for (const item of list.split(',')) {
    if (!item.trim()) continue;
    const parts = item.trim().split(/\s+as\s+/);
    if (parts.length > 2 || !parts.every(name => identifier.test(name))) throw new Error(`Unsupported ${description}`);
    result.push({name: parts[0], alias: parts[1] ?? parts[0]});
  }
  return result;
}

function dependencies(source) {
  const result = [];
  const named = /^[\t ]*import\s+\{([^}]+)\}\s+from\s+(['"])([^'"]+)\2\s*;/gm;
  const namespace = /^[\t ]*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+)\2\s*;/gm;
  const star = /^[\t ]*export\s+\*\s+from\s+(['"])([^'"]+)\1\s*;/gm;
  const namedExport = /^[\t ]*export\s+\{([^}]+)\}\s+from\s+(['"])([^'"]+)\2\s*;/gm;
  for (const match of source.matchAll(named)) result.push({start: match.index, end: match.index + match[0].length,
    kind: 'named', specifier: match[3], bindings: bindings(match[1], 'named import')});
  for (const match of source.matchAll(namespace)) result.push({start: match.index, end: match.index + match[0].length,
    kind: 'namespace', specifier: match[3], alias: match[1]});
  for (const match of source.matchAll(star)) result.push({start: match.index, end: match.index + match[0].length,
    kind: 'star', specifier: match[2]});
  for (const match of source.matchAll(namedExport)) result.push({start: match.index, end: match.index + match[0].length,
    kind: 'reexport', specifier: match[3], bindings: bindings(match[1], 'named re-export')});
  return result.sort((left, right) => left.start - right.start);
}

function declarations(source) {
  const exports = [], edits = [];
  const declaration = /^[\t ]*export\s+(class|(?:async\s+)?function\*?|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of source.matchAll(declaration)) {
    exports.push({name: match[2], alias: match[2]});
    edits.push({start: match.index, end: match.index + match[0].length, replacement: `${match[1]} ${match[2]}`});
  }
  const named = /^[\t ]*export\s+\{([^}]+)\}\s*;/gm;
  for (const match of source.matchAll(named)) {
    exports.push(...bindings(match[1], 'named export'));
    edits.push({start: match.index, end: match.index + match[0].length, replacement: ''});
  }
  return {exports, edits};
}

/** The repository's static ESM subset uses complete line-start import/export declarations with relative dependencies. */
export function parseWorkerModule(source, path) {
  const imports = dependencies(source), local = declarations(source);
  const stripped = rewriteModule(source, [...local.edits, ...imports.map(entry => ({...entry, replacement: ''}))]);
  if (/^[\t ]*(?:import|export)\s/m.test(stripped)) throw new Error(`Unsupported module syntax in ${path}`);
  return {source, dependencies: imports, exports: local.exports, edits: local.edits};
}

/** Apply nonoverlapping source edits once, preserving dependency evaluation order and untouched factory bodies. */
export function rewriteModule(source, edits) {
  const parts = [];
  let position = 0;
  for (const edit of [...edits].sort((left, right) => left.start - right.start)) {
    if (edit.start < position) throw new Error('Overlapping worker module syntax');
    parts.push(source.slice(position, edit.start), edit.replacement);
    position = edit.end;
  }
  parts.push(source.slice(position));
  return parts.join('');
}
