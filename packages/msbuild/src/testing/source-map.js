/** Resolve failures through stack-frame source coordinates, then PDB sequence points, then source discovery records. */
export function mapTestSource(test, options = {}) {
  const {stackTrace = '', symbols, methodTokens = new Map(), declarations = [], workspaceRoot = ''} = options;
  const relative = value => {
    const path = value.replaceAll('\\', '/');
    const root = workspaceRoot.replaceAll('\\', '/').replace(/\/$/, '');
    return root && path.toLowerCase().startsWith(root.toLowerCase() + '/') ? path.slice(root.length + 1) : path;
  };
  for (const line of stackTrace.split(/\r?\n/)) {
    const match = /\bin (.+?):line (\d+)(?:\s*$|\s+)/.exec(line);
    if (match && Number(match[2]) > 0) return {path: relative(match[1]), line: Number(match[2]), column: 1, origin: 'stack'};
  }
  const token = methodTokens instanceof Map ? methodTokens.get(test.fqn) : methodTokens[test.fqn];
  if (symbols && token) {
    const method = symbols.methods.find(value => value.token === token);
    const point = method?.points.find(value => !value.hidden);
    const document = point && symbols.documents.find(value => value.id === point.document);
    if (document) return {path: relative(document.name), line: point.startLine, column: point.startColumn,
      endLine: point.endLine, endColumn: point.endColumn, origin: 'portable-pdb'};
  }
  const declaration = declarations.find(value => value.fqn === test.fqn);
  return declaration?.source ? {...declaration.source, origin: 'source-declaration'} : test.source;
}
