import {attributeConstant, normalizeTestAttribute, hasUnresolved} from './attribute-values.js';

function sourceSpan(source, node) {
  const start = node.identifier?.spanStart ?? node.span.start;
  let low = 0;
  let high = source.lineStarts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (source.lineStarts[middle] <= start) low = middle;
    else high = middle;
  }
  return {path: source.uri, line: low + 1, column: start - source.lineStarts[low] + 1, start, end: node.span.end};
}

function members(node) { return node.members ? [...node.members] : []; }

function attributeList(node, options) {
  return (node.attributeLists ?? []).flatMap(list => list.attributes.map(attribute => normalizeTestAttribute(attribute, options)));
}

function constantRows(node, options) {
  const expression = node.expressionBody?.expression ?? node.initializer?.value;
  if (expression) {
    const value = attributeConstant(expression, options);
    if (Array.isArray(value) && !hasUnresolved(value)) return value;
  }
  const body = node.body ?? node.accessorList?.accessors.find(value => value.keyword?.text === 'get')?.body;
  if (!body) return null;
  const statements = [...body.statements];
  if (statements.length === 1 && statements[0].kind === 'ReturnStatement') {
    const value = attributeConstant(statements[0].expression, options);
    if (Array.isArray(value) && !hasUnresolved(value)) return value;
  }
  if (statements.length && statements.every(statement => statement.kind === 'YieldReturnStatement')) {
    const rows = statements.map(statement => attributeConstant(statement.expression, options));
    if (!hasUnresolved(rows)) return rows;
  }
  return null;
}

function methodSymbol(node, type, source, options) {
  return {kind: 'method', name: node.identifier.valueText, fqn: type.fqn + '.' + node.identifier.valueText,
    className: type.fqn, declaringType: type, source: sourceSpan(source, node), attributes: attributeList(node, options),
    modifiers: node.modifiers.map(value => value.text), returnType: node.returnType.toString(),
    parameters: node.parameterList.parameters.map(parameter => ({name: parameter.identifier.valueText,
      type: parameter.type?.toString() ?? 'object', modifiers: parameter.modifiers.map(value => value.text)})),
    typeParameters: node.typeParameterList?.parameters.map(parameter => parameter.identifier.valueText) ?? [],
    declarationSpan: node.span, constantRows: constantRows(node, options)};
}

/** Extract test-ready declaration records from the compiler's lossless syntax tree; no user source is executed. */
export function testSymbolsFromTrees(trees, options = {}) {
  const {maxMethods = 100_000, signal} = options;
  const types = [];
  const methods = [];
  const diagnostics = [];
  const attributeSpans = [];
  const identifierReferences = new Map();
  for (const tree of trees) {
    signal?.throwIfAborted();
    diagnostics.push(...tree.getDiagnostics().filter(diagnostic => diagnostic.severity === 'error'));
    const lineStarts = [0];
    for (let at = 0; at < tree.source.text.length; at++) if (tree.source.text[at] === '\n') lineStarts.push(at + 1);
    const source = {uri: tree.source.uri, text: tree.source.text, lineStarts};
    const visit = (node, scope = '', parent = null) => {
      signal?.throwIfAborted();
      if (['NamespaceDeclaration', 'FileScopedNamespaceDeclaration'].includes(node.kind)) {
        const namespace = (scope ? scope + '.' : '') + node.name.toString();
        for (const child of members(node)) visit(child, namespace, parent);
        return;
      }
      if (['ClassDeclaration', 'StructDeclaration', 'RecordDeclaration'].includes(node.kind)) {
        const fqn = (scope ? scope + '.' : '') + node.identifier.valueText;
        const type = {kind: 'class', name: node.identifier.valueText, fqn, source: sourceSpan(source, node),
          attributes: attributeList(node, options), methods: [], dataMembers: new Map(), dataProviders: new Map(), constructors: [],
          modifiers: node.modifiers.map(value => value.text), baseTypes: node.baseList?.types.map(value => value.type.toString()) ?? [],
          declarationSpan: node.span, parent, hasFields: members(node).some(member => member.kind === 'FieldDeclaration')};
        types.push(type);
        for (const child of members(node)) {
          if (child.kind === 'MethodDeclaration') {
            if (methods.length >= maxMethods) throw new Error('Test method count limit exceeded');
            const method = methodSymbol(child, type, source, options);
            methods.push(method);
            type.methods.push(method);
            type.dataProviders.set(method.name, {kind: 'method', parameters: method.parameters, modifiers: method.modifiers});
            if (method.constantRows) type.dataMembers.set(method.name, method.constantRows);
          } else if (child.kind === 'PropertyDeclaration') {
            type.dataProviders.set(child.identifier.valueText, {kind: 'property', parameters: [], modifiers: child.modifiers.map(value => value.text)});
            const rows = constantRows(child, options);
            if (rows) type.dataMembers.set(child.identifier.valueText, rows);
          } else if (child.kind === 'FieldDeclaration') {
            for (const variable of child.declaration.variables) {
              type.dataProviders.set(variable.identifier.valueText, {kind: 'field', parameters: [], modifiers: child.modifiers.map(value => value.text)});
              const rows = constantRows(variable, options);
              if (rows) type.dataMembers.set(variable.identifier.valueText, rows);
            }
          } else if (child.kind === 'ConstructorDeclaration') {
            type.constructors.push({parameters: child.parameterList.parameters.map(parameter => ({name: parameter.identifier.valueText,
              type: parameter.type?.toString() ?? 'object'})), modifiers: child.modifiers.map(value => value.text)});
          } else visit(child, fqn, type);
        }
        return;
      }
      for (const child of members(node)) visit(child, scope, parent);
    };
    visit(tree.root);
    for (const node of tree.root.descendantNodes()) {
      if (node.kind === 'AttributeList') attributeSpans.push({uri: source.uri, ...node.span});
      if (node.kind === 'IdentifierName') {
        const name = node.identifier.valueText;
        if (!identifierReferences.has(name)) identifierReferences.set(name, []);
        identifierReferences.get(name).push({uri: source.uri, ...node.span});
      }
    }
  }
  return {types, methods, diagnostics, attributeSpans, identifierReferences,
    sources: trees.map(tree => ({uri: tree.source.uri, text: tree.source.text}))};
}

/** Lazy source frontend. Callers with compiler-owned trees can supply them without reparsing. */
export async function discoverTestSymbols(input, options = {}) {
  if (input?.methods && input?.types) return input;
  if (input?.trees) return testSymbolsFromTrees(input.trees, options);
  const {SyntaxTree} = await import('@sharpforge/syntax');
  const sources = typeof input === 'string' ? [{uri: 'Tests.cs', text: input}] : input;
  if (!Array.isArray(sources) || sources.length > 10_000) throw new Error('Invalid test source collection');
  const trees = sources.map(source => {
    options.signal?.throwIfAborted();
    if (source.text.length > 4_000_000) throw new Error('Test source size limit exceeded');
    return SyntaxTree.parseText(source.text, {uri: source.uri ?? source.path, languageVersion: options.languageVersion ?? '14',
      preprocessorSymbols: options.preprocessorSymbols});
  });
  return testSymbolsFromTrees(trees, options);
}
