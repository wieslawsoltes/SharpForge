/**
 * Language-version gates for features that are visible in the syntax tree but that the parser does not record
 * (SF-A02-B01): auto-implemented properties, async functions, expression-bodied accessors, static local functions,
 * ref loop variables, lambda attributes, file types, generic attributes ...
 *
 * `collectSyntaxFeatures(root)` walks a compilation unit once and returns feature uses `{ id, start, end }` in the
 * shape `checkFeatures` (packages/syntax) takes, with the ids of the shared feature catalog. Detection is a table
 * from syntax kind to a detector `(node, context, use)`, so a new feature is one more entry; `context` is
 * `{ parent, ancestors, enclosingType, inAsyncOrIterator, inInitializerOrQuery, inLambdaParameters }`. The walk is only worth its cost when a
 * language version below the newest is selected; `Compilation` skips it otherwise.
 *
 * Only features that the syntax alone decides are here. Features that need binding (the type of an operand, the
 * attribute a name resolves to) are gated by the semantic binder through ./feature-check.js.
 */

const has = (node, modifier) => [...(node.modifiers ?? [])].some(token => token.text === modifier);
const textOf = node => node.toString().replace(/\s+/g, '');
const accessorKinds = new Set([
  'GetAccessorDeclaration',
  'SetAccessorDeclaration',
  'InitAccessorDeclaration',
  'AddAccessorDeclaration',
  'RemoveAccessorDeclaration',
]);
const typeKinds = new Set([
  'ClassDeclaration',
  'StructDeclaration',
  'InterfaceDeclaration',
  'RecordDeclaration',
  'RecordStructDeclaration',
  'EnumDeclaration',
  'DelegateDeclaration',
]);
const lambdaKinds = new Set(['SimpleLambdaExpression', 'ParenthesizedLambdaExpression', 'AnonymousMethodExpression']);
const functionKinds = new Set([...lambdaKinds, 'LocalFunctionStatement', 'MethodDeclaration']);
const systemConstraints = new Map([
  ['System.Enum', 'EnumGenericTypeConstraint'],
  ['global::System.Enum', 'EnumGenericTypeConstraint'],
  ['System.Delegate', 'DelegateGenericTypeConstraint'],
  ['global::System.Delegate', 'DelegateGenericTypeConstraint'],
  ['System.MulticastDelegate', 'DelegateGenericTypeConstraint'],
  ['global::System.MulticastDelegate', 'DelegateGenericTypeConstraint'],
]);
const keywordConstraints = new Map([
  ['unmanaged', 'UnmanagedGenericTypeConstraint'],
  ['notnull', 'NotNullGenericTypeConstraint'],
]);
const shiftOperators = new Set(['<<', '>>', '>>>']);

/** The parameters of a lambda, whichever form it has. */
function lambdaParameters(node) {
  if (node.kind === 'SimpleLambdaExpression') return node.parameter ? [node.parameter] : [];
  return [...(node.parameterList?.parameters ?? [])];
}

function propertyFeatures(node, context, use) {
  const accessors = [...(node.accessorList?.accessors ?? [])];
  const isAuto =
    accessors.length > 0 &&
    accessors.every(accessor => !accessor.body && !accessor.expressionBody) &&
    !has(node, 'abstract') &&
    !has(node, 'extern') &&
    !has(node, 'partial') &&
    context.enclosingType?.kind !== 'InterfaceDeclaration';
  if (isAuto) {
    use('AutoImplementedProperties', node.identifier);
    if (accessors.length === 1 && accessors[0].kind === 'GetAccessorDeclaration') use('ReadonlyAutoImplementedProperties', node.identifier);
  }
  for (const list of node.attributeLists ?? []) {
    if (list.target?.identifier.text === 'field') use('AttributesOnBackingFields', list.target);
  }
  if (has(node, 'readonly')) use('ReadOnlyMembers', node.identifier);
}

function accessorFeatures(node, context, use) {
  if (node.expressionBody) use('ExpressionBodiedAccessor', node.expressionBody);
  if (has(node, 'readonly')) use('ReadOnlyMembers', node.keyword);
  if ([...(node.modifiers ?? [])].some(token => ['private', 'protected', 'internal'].includes(token.text))) {
    use('PropertyAccessorMods', node.keyword);
  }
}

function functionFeatures(node, context, use) {
  // Roslyn reports an async method or local function at its name (lambdas and `await` are reported by the parser).
  if (has(node, 'async')) use('Async', node.identifier ?? [...node.modifiers].find(token => token.text === 'async'));
  if (node.kind === 'MethodDeclaration') {
    if (has(node, 'readonly')) use('ReadOnlyMembers', node.identifier);
    if (node.identifier.valueText === 'ToString' && has(node, 'sealed') && context.enclosingType?.kind === 'RecordDeclaration') {
      use('SealedToStringInRecord', node.identifier);
    }
    return;
  }
  if (node.kind === 'LocalFunctionStatement') {
    if (has(node, 'static')) use('StaticLocalFunctions', node.identifier);
    if (has(node, 'extern')) use('ExternLocalFunctions', node.identifier);
    const attributes = [...(node.attributeLists ?? [])];
    if (attributes.length) use('LocalFunctionAttributes', attributes[0]);
    return;
  }
  if (node.kind === 'AnonymousMethodExpression') return;
  const attributes = [...(node.attributeLists ?? [])];
  if (attributes.length) use('LambdaAttributes', attributes[0]);
  const parameters = lambdaParameters(node);
  if (parameters.filter(p => p.identifier?.valueText === '_').length > 1) use('LambdaDiscardParameters', parameters[1]);
  for (const parameter of parameters) {
    if (parameter.default) use('LambdaOptionalParameters', parameter.default);
    if (has(parameter, 'params')) use('LambdaParamsArray', parameter);
    else if (!parameter.type && [...(parameter.modifiers ?? [])].length) use('SimpleLambdaParameterModifiers', parameter);
  }
}

function parameterFeatures(node, context, use) {
  // `scoped` has no feature of its own: Roslyn reports it as 'ref fields' (C# 11), at the keyword.
  const scoped = [...(node.modifiers ?? [])].find(token => token.text === 'scoped');
  if (scoped) use('RefFields', scoped);
  if (context.inLambdaParameters) return;
  if (has(node, 'this') && (has(node, 'ref') || has(node, 'in'))) {
    // Roslyn reports the later of `this` and `ref`/`in`: `ref this int x` at `this`, `this ref int x` at `ref`.
    const pair = [...node.modifiers].filter(token => ['this', 'ref', 'in'].includes(token.text));
    use('RefExtensionMethods', pair[pair.length - 1]);
  }
  if (has(node, 'params') && node.type && node.type.kind !== 'ArrayType') use('ParamsCollections', node);
}

/**
 * Before C# 8 a stackalloc is the initializer of a local, directly or as an operand of the conditional operator that
 * is; anywhere else it is 'stackalloc in nested expressions', which Roslyn reports on the keyword.
 */
function stackAllocFeatures(node, context, use) {
  const ancestors = context.ancestors;
  let depth = ancestors.length - 1;
  while (depth >= 0 && ancestors[depth].kind === 'ConditionalExpression') depth--;
  const isLocalInitializer = ancestors[depth]?.kind === 'EqualsValueClause' && ancestors[depth - 1]?.kind === 'VariableDeclarator';
  if (!isLocalInitializer) use('NestedStackalloc', node.stackAllocKeyword ?? node);
}

function fieldFeatures(node, context, use) {
  const declaration = node.declaration;
  if (declaration.type.kind === 'RefType') use('RefFields', declaration.type);
  constantFeatures(node, context, use);
  const record = context.enclosingType;
  if (record?.kind !== 'RecordDeclaration' && record?.kind !== 'RecordStructDeclaration') return;
  // Roslyn reports the positional parameter that the field stands for, not the field.
  const positional = new Map([...(record.parameterList?.parameters ?? [])].map(p => [p.identifier.valueText, p]));
  for (const variable of declaration.variables) {
    const parameter = positional.get(variable.identifier.valueText);
    if (parameter) use('PositionalFieldsInRecords', parameter);
  }
}

/** A constant whose value is an interpolated string. */
function constantFeatures(node, context, use) {
  if (!has(node, 'const')) return;
  for (const variable of node.declaration.variables) {
    const value = variable.initializer?.value;
    if (value?.kind === 'InterpolatedStringExpression') use('ConstantInterpolatedStrings', value);
  }
}

function localDeclarationFeatures(node, context, use) {
  if (node.awaitKeyword && node.usingKeyword) use('AsyncUsing', node.awaitKeyword);
  constantFeatures(node, context, use);
  // Roslyn names each ref local, not its type.
  if (context.inAsyncOrIterator && node.declaration.type.kind === 'RefType')
    for (const variable of node.declaration.variables) use('RefUnsafeInIteratorAsync', variable.identifier);
}

function typeConstraintFeatures(node, context, use) {
  const text = textOf(node.type);
  const id = node.type.kind === 'IdentifierName' ? keywordConstraints.get(text) : systemConstraints.get(text);
  if (id) use(id, node.type);
}

function operatorFeatures(node, context, use) {
  const second = [...(node.parameterList?.parameters ?? [])][1];
  if (shiftOperators.has(node.operatorToken.text) && second?.type && textOf(second.type) !== 'int') use('RelaxedShiftOperator', node.operatorToken);
}

function attributeFeatures(node, context, use) {
  const name = node.name.kind === 'QualifiedName' ? node.name.right : node.name;
  if (name.kind === 'GenericName') use('GenericAttributes', name);
}

function invocationFeatures(node, context, use) {
  const target = node.expression;
  if (target.kind !== 'IdentifierName' || target.identifier.valueText !== 'nameof') return;
  const omitted = findFirst(node.argumentList, child => child.kind === 'OmittedTypeArgument');
  if (omitted) use('UnboundGenericTypesInNameof', omitted.parent ?? node.argumentList);
}

function implicitElementAccessFeatures(node, context, use) {
  // Roslyn reports the whole element access (`[^1]`), once.
  const implicit = [...node.argumentList.arguments].some(
    argument => argument.expression.kind === 'IndexExpression' || argument.expression.kind === 'RangeExpression',
  );
  if (implicit) use('ImplicitIndexerInitializer', node);
}

function assignmentFeatures(node, context, use) {
  if (node.left?.kind !== 'TupleExpression') return;
  const parts = [...node.left.arguments].map(argument => argument.expression.kind === 'DeclarationExpression');
  if (parts.includes(true) && parts.includes(false)) use('MixedDeclarationsAndExpressionsInDeconstruction', node.left);
}

function declarationExpressionFeatures(node, context, use) {
  if (context.inInitializerOrQuery) use('ExpressionVariablesInQueriesAndInitializers', node);
}

/** Syntax kind -> detector. */
const detectors = {
  PropertyDeclaration: propertyFeatures,
  IndexerDeclaration: (node, context, use) => has(node, 'readonly') && use('ReadOnlyMembers', node.thisKeyword),
  MethodDeclaration: functionFeatures,
  LocalFunctionStatement: functionFeatures,
  SimpleLambdaExpression: functionFeatures,
  ParenthesizedLambdaExpression: functionFeatures,
  AnonymousMethodExpression: functionFeatures,
  Parameter: parameterFeatures,
  // Roslyn gates the discard pattern as a recursive pattern (C# 8), next to the construct that contains it.
  RecursivePattern: (node, context, use) => use('RecursivePatterns', node),
  DiscardPattern: (node, context, use) => use('RecursivePatterns', node),
  ScopedType: (node, context, use) => use('RefFields', node.firstToken()),
  StackAllocArrayCreationExpression: stackAllocFeatures,
  ImplicitStackAllocArrayCreationExpression: stackAllocFeatures,
  FieldDeclaration: fieldFeatures,
  LocalDeclarationStatement: localDeclarationFeatures,
  TypeConstraint: typeConstraintFeatures,
  OperatorDeclaration: operatorFeatures,
  Attribute: attributeFeatures,
  InvocationExpression: invocationFeatures,
  ImplicitElementAccess: implicitElementAccessFeatures,
  SimpleAssignmentExpression: assignmentFeatures,
  DeclarationExpression: declarationExpressionFeatures,
  DeclarationPattern: declarationExpressionFeatures,
  UsingStatement: (node, context, use) => node.awaitKeyword && use('AsyncUsing', node.awaitKeyword),
  UnsafeStatement: (node, context, use) => context.inAsyncOrIterator && use('RefUnsafeInIteratorAsync', node.unsafeKeyword),
  ForStatement: (node, context, use) => node.declaration?.type.kind === 'RefType' && use('RefFor', node.declaration.type),
  ForEachStatement: (node, context, use) => node.type?.kind === 'RefType' && use('RefForEach', node.type),
  ConditionalExpression: (node, context, use) =>
    node.whenTrue.kind === 'RefExpression' && node.whenFalse.kind === 'RefExpression' && use('RefConditional', node),
};
for (const kind of accessorKinds) detectors[kind] = accessorFeatures;
for (const kind of typeKinds) detectors[kind] = (node, context, use) => has(node, 'file') && use('FileTypes', node.identifier);

function findFirst(node, predicate) {
  for (const child of node.childNodes()) {
    if (predicate(child)) return child;
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return null;
}

/** True when the body of a function contains `yield` outside nested functions. */
function isIterator(node) {
  const body = node.body ?? node.block;
  if (!body) return false;
  const yields = child => child.kind === 'YieldReturnStatement' || child.kind === 'YieldBreakStatement';
  const search = current => {
    for (const child of current.childNodes()) {
      if (functionKinds.has(child.kind)) continue;
      if (yields(child) || search(child)) return true;
    }
    return false;
  };
  return search(body);
}

/** The flags a node passes down to its children; `stack` holds the node's ancestors, nearest last. */
function childFlags(node, flags, stack) {
  const isFunction = functionKinds.has(node.kind),
    isType = typeKinds.has(node.kind),
    parent = stack.at(-1);
  const startsInitializer =
    node.kind === 'QueryExpression' ||
    node.kind === 'BaseConstructorInitializer' ||
    node.kind === 'ThisConstructorInitializer' ||
    (node.kind === 'EqualsValueClause' &&
      (parent?.kind === 'PropertyDeclaration' || (parent?.kind === 'VariableDeclarator' && stack.at(-3)?.kind === 'FieldDeclaration')));
  const inLambdaParameters = isFunction ? lambdaKinds.has(node.kind) : node.kind === 'ParameterList' && flags.inLambdaParameters;
  if (!isFunction && !isType && !startsInitializer && inLambdaParameters === flags.inLambdaParameters) return flags;
  return {
    enclosingType: isType ? node : flags.enclosingType,
    inAsyncOrIterator: isFunction ? has(node, 'async') || isIterator(node) : flags.inAsyncOrIterator,
    inInitializerOrQuery: isFunction ? false : startsInitializer || flags.inInitializerOrQuery,
    inLambdaParameters,
  };
}

/**
 * @param root a CompilationUnit of the lossless syntax tree
 * @returns {{id:string,start:number,end:number}[]} feature uses for `checkFeatures`, in source order
 */
export function collectSyntaxFeatures(root) {
  const uses = [],
    stack = [];
  const use = (id, at) => {
    const span = at.span ?? at;
    uses.push({ id, start: span.start, end: span.end });
  };
  const visit = (node, flags) => {
    const detector = detectors[node.kind];
    if (detector) detector(node, { ...flags, parent: stack.at(-1) ?? null, ancestors: stack }, use);
    const next = childFlags(node, flags, stack);
    stack.push(node);
    for (const child of node.childNodes()) visit(child, next);
    stack.pop();
  };
  visit(root, { enclosingType: null, inAsyncOrIterator: false, inInitializerOrQuery: false, inLambdaParameters: false });
  return uses;
}
