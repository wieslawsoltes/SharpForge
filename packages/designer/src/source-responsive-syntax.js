import {failSource} from './source-errors.js';

/** Retained arguments include parentheses that the legacy expression projection deliberately omits. */
export function responsiveInvocationArguments(parsed, invocation) {
  const syntax = parsed.syntax.findNode(invocation.start, invocation.end);
  if (syntax.kind !== 'InvocationExpression' || syntax.argumentList.arguments.length !== invocation.args.length) {
    failSource('Adaptive initializer has no exact retained argument list', invocation, 'SFSYNC_OWNERSHIP');
  }
  const argumentsList = syntax.argumentList.arguments;
  if (argumentsList.some(argument => argument.nameColon || argument.refKindKeyword)) {
    failSource('Adaptive initializers require positional value arguments', invocation, 'SFSYNC_OWNERSHIP');
  }
  return argumentsList.map(argument => ({...argument.span}));
}

/** Composite replacements cover their complete retained expression, including nested operand parentheses. */
export function responsiveExpressionSpan(source, expression) {
  const syntax = source.parsed.syntax.findNode(expression.start, expression.end);
  if (!syntax.kind.endsWith('Expression') && !syntax.kind.endsWith('Name')) {
    failSource('Adaptive constant has no exact retained expression span', expression, 'SFSYNC_OWNERSHIP');
  }
  return {...expression, ...syntax.span};
}

/** Class declarations may have a trailing semicolon; insertion belongs before their actual close brace. */
export function responsiveClassBodyEnd(base) {
  const syntax = base.parsed.syntax.findNode(base.owner.start, base.owner.end);
  if (syntax.kind !== 'ClassDeclaration' || !syntax.closeBraceToken || syntax.closeBraceToken.isMissing) {
    failSource('Adaptive helper requires an owned class body', base.owner, 'SFSYNC_OWNERSHIP');
  }
  return syntax.closeBraceToken.span.start;
}
