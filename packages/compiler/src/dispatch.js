import {
  compileBlock,
  compileEmpty,
  compileUsing,
  compileUsingDeclaration,
  compileLocal,
  compileExpressionStatement,
  compileOverflowContext
} from './statements/scope.js';
import {
  compileIf,
  compileLoop,
  compileLoopJump,
  compileSwitch,
  compileReturn
} from './statements/control-flow.js';
import {
  compileForeach
} from './statements/foreach.js';
import {
  compileThrow,
  compileTry,
  compileUnknown
} from './statements/exceptions.js';
import {
  inferAwait,
  inferNested,
  inferDeclaredType,
  inferSwitchExpression,
  inferInterpolatedString,
  inferLiteral,
  inferName,
  inferNew,
  inferNewArray,
  inferIndex,
  inferMember,
  inferCall,
  inferAssignment,
  inferConditional,
  inferUnary,
  inferBinary,
  inferUnknown
} from './expressions/inference.js';
import {
  emitInterpolatedString,
  emitAwait,
  emitDefault,
  emitOverflowContext,
  emitCast,
  emitError,
  emitLiteral,
  emitUnknown
} from './expressions/values.js';
import {
  emitSwitchExpression,
  emitBinary,
  emitUnary,
  emitAssignment,
  emitConditional
} from './expressions/operators.js';
import {
  emitName,
  emitMember,
  emitIndex
} from './expressions/references.js';
import {
  emitCall
} from './expressions/call.js';
import {
  emitNewArray,
  emitNew
} from './expressions/creation.js';

// Tables are built once. Null prototypes keep malformed kinds on the diagnostic fallback.
const statementHandlers = Object.freeze(Object.assign(Object.create(null), {
  Block: compileBlock,
  Empty: compileEmpty,
  Using: compileUsing,
  UsingDeclaration: compileUsingDeclaration,
  Local: compileLocal,
  ExpressionStatement: compileExpressionStatement,
  If: compileIf,
  While: compileLoop,
  Do: compileLoop,
  For: compileLoop,
  OverflowContext: compileOverflowContext,
  Foreach: compileForeach,
  Break: compileLoopJump,
  Continue: compileLoopJump,
  Switch: compileSwitch,
  Return: compileReturn,
  Throw: compileThrow,
  Try: compileTry,
}));

/** Run a statement handler with the composed compiler as its receiver. */
export function dispatchStatement(compiler, node) {
  const kind = node.kind;
  const handler = typeof kind === 'string' ? statementHandlers[kind] : undefined;
  return (handler ?? compileUnknown).call(compiler, node);
}

const inferenceHandlers = Object.freeze(Object.assign(Object.create(null), {
  Await: inferAwait,
  Checked: inferNested,
  Unchecked: inferNested,
  Cast: inferDeclaredType,
  Default: inferDeclaredType,
  SwitchExpression: inferSwitchExpression,
  InterpolatedString: inferInterpolatedString,
  Literal: inferLiteral,
  Name: inferName,
  New: inferNew,
  NewArray: inferNewArray,
  Index: inferIndex,
  Member: inferMember,
  Call: inferCall,
  Assignment: inferAssignment,
  Conditional: inferConditional,
  Unary: inferUnary,
  Binary: inferBinary,
}));

/** Infer a type without changing framework-hook precedence in MethodCompiler. */
export function dispatchInference(compiler, node) {
  const kind = node.kind;
  const handler = typeof kind === 'string' ? inferenceHandlers[kind] : undefined;
  return (handler ?? inferUnknown).call(compiler, node);
}

const expressionHandlers = Object.freeze(Object.assign(Object.create(null), {
  InterpolatedString: emitInterpolatedString,
  Await: emitAwait,
  Default: emitDefault,
  Checked: emitOverflowContext,
  Unchecked: emitOverflowContext,
  Cast: emitCast,
  SwitchExpression: emitSwitchExpression,
  Error: emitError,
  Literal: emitLiteral,
  Name: emitName,
  Member: emitMember,
  Index: emitIndex,
  Binary: emitBinary,
  Unary: emitUnary,
  Assignment: emitAssignment,
  Conditional: emitConditional,
  Call: emitCall,
  NewArray: emitNewArray,
  New: emitNew,
}));

/** Emit an expression and preserve its handler return type and compiler receiver. */
export function dispatchExpression(compiler, node) {
  const kind = node.kind;
  const handler = typeof kind === 'string' ? expressionHandlers[kind] : undefined;
  return (handler ?? emitUnknown).call(compiler, node);
}

