import {sourcePath} from './source-text.js';

function sameMethod(left, right) {
  return left && right && left.name === right.name && left.uri === right.uri
    && left.start === right.start && left.end === right.end;
}

/** Find the complete source constructor; chained calls and implicit initialization cannot be projected as an empty prefix. */
function ownedConstructor(context) {
  if (!context) return null;
  const members = context.partials.flatMap(partial => partial.members);
  if (members.some(member => ['Field', 'Property'].includes(member.kind) && member.initializer)) return null;
  const constructors = members.filter(member => member.kind === 'Method' && member.name === '.ctor');
  if (constructors.some(method => method.modifiers?.includes('static'))) return null;
  const parameterless = constructors.filter(method => !method.parameters.length);
  if (parameterless.length !== 1) return null;
  const constructor = parameterless[0];
  const parsed = context.parsedFiles.find(file => file.source.uri === constructor.uri);
  let syntax = parsed?.syntax.findNode(constructor.start, constructor.end);
  while (syntax?.parent && syntax.kind !== 'ConstructorDeclaration') syntax = syntax.parent;
  if (syntax?.kind !== 'ConstructorDeclaration' || !syntax.body || syntax.initializer || syntax.expressionBody) return null;
  return constructor;
}

/** Serializable evidence accompanies only the chosen direct constructor, never a synthesized or unrelated method. */
export function sourceConstructorEvidence(context) {
  const constructor = ownedConstructor(context);
  if (!sameMethod(constructor, context?.chosen?.method)) return null;
  const owner = context.chosen.owner;
  return {kind: 'constructor', owner: [owner.namespace, owner.name].filter(Boolean).join('.'), uri: constructor.uri,
    span: {start: constructor.start, end: constructor.end}, parameterCount: 0, instance: true,
    implicitBase: true, fieldInitializers: false, staticConstructor: false};
}

export function hasSourceConstructorEvidence(analysis) {
  const evidence = analysis?.ownership?.construction;
  return evidence?.kind === 'constructor' && !!analysis.method && evidence.owner === analysis.ownership.className
    && evidence.uri === analysis.uri && evidence.span?.start === analysis.method.start && evidence.span?.end === analysis.method.end
    && evidence.parameterCount === 0 && evidence.instance === true && evidence.implicitBase === true
    && evidence.fieldInitializers === false && evidence.staticConstructor === false;
}

/** A composed instance either owns its constructor body or invokes exactly the separately owned parameterless body. */
export function constructorInvokesSourceConstruction(analysis) {
  const constructor = ownedConstructor(analysis.context);
  if (!constructor || analysis.method.modifiers?.includes('static') || analysis.method.parameters.length) return false;
  if (sameMethod(constructor, analysis.method)) return hasSourceConstructorEvidence(analysis);
  if (constructor.body?.kind !== 'Block' || constructor.body.statements.length !== 1) return false;
  const statement = constructor.body.statements[0];
  const expression = statement.expression;
  return statement.kind === 'ExpressionStatement' && expression?.kind === 'Call' && !expression.args.length
    && [analysis.method.name, 'this.' + analysis.method.name].includes(sourcePath(expression.target));
}
