/**
 * Expression trees (SF-A02-T07.5): a lambda converted to `Expression<TDelegate>` is lowered to the tree of
 * `System.Linq.Expressions.Expression` factory calls Roslyn emits for it.
 *
 * The result is a plain description of that tree - one node per factory call:
 *
 *   { factory: 'Add', nodeType: 'Add', type, operands: [...], method? }      Expression.Add(left, right[, method])
 *   { factory: 'Parameter', nodeType: 'Parameter', type, name }              Expression.Parameter(typeof(T), "x")
 *   { factory: 'Constant', nodeType: 'Constant', type, value }               Expression.Constant(value, typeof(T))
 *   { factory: 'Lambda', nodeType: 'Lambda', type, body, parameters }        Expression.Lambda<TDelegate>(body, parameters)
 *
 * and so on for members, calls, creation and initializers (see the `visit*` functions below). The tree is what
 * code generation will turn into calls once the runtime has System.Linq.Expressions; today it is checked against
 * .NET through its text and node-type walk (lowering/expression-tree-text.js).
 *
 * A construct with no factory call makes the lowering return `{ unsupported: <what>, syntax }` instead of guessing.
 */
import { MethodKind } from '../symbols/members.js';
import { expressionTreeDelegate } from '../symbols/expression-tree-types.js';
import { expressionTreeCreationVisitors } from './expression-tree-creation.js';

const binaryFactories = Object.freeze({
  '+': ['Add', 'AddChecked'],
  '-': ['Subtract', 'SubtractChecked'],
  '*': ['Multiply', 'MultiplyChecked'],
  '/': ['Divide'],
  '%': ['Modulo'],
  '&': ['And'],
  '|': ['Or'],
  '^': ['ExclusiveOr'],
  '<<': ['LeftShift'],
  '>>': ['RightShift'],
  '==': ['Equal'],
  '!=': ['NotEqual'],
  '<': ['LessThan'],
  '<=': ['LessThanOrEqual'],
  '>': ['GreaterThan'],
  '>=': ['GreaterThanOrEqual'],
  '&&': ['AndAlso'],
  '||': ['OrElse'],
});
const unaryFactories = Object.freeze({ '-': ['Negate', 'NegateChecked'], '+': ['UnaryPlus'], '!': ['Not'], '~': ['Not'] });
const integralTypes = new Set(
  ['Int32', 'UInt32', 'Int64', 'UInt64', 'Int16', 'UInt16', 'Byte', 'SByte'].map(name => 'System_' + name),
);
/** Conversions that leave the operand as it is in the tree. */
const transparentConversions = new Set(['Identity', 'InterpolatedString']);

class Unsupported extends Error {
  constructor(what, syntax) {
    super(what);
    this.what = what;
    this.syntax = syntax;
  }
}

class TreeBuilder {
  /** @param core the core types of the compilation */
  constructor(core) {
    this.core = core;
    /** Parameter symbol -> its Parameter node; one node per parameter, shared by every use (as Roslyn emits it). */
    this.parameters = new Map();
  }
  fail(what, node) {
    throw new Unsupported(what, node?.syntax ?? null);
  }
  node(factory, type, fields, nodeType = factory) {
    return { factory, nodeType, type, ...fields };
  }
  lambda(lambda, delegateType) {
    if (!lambda.body) this.fail('a lambda whose body was not bound', lambda);
    if (lambda.body.kind === 'Block') this.fail('a lambda with a statement body', lambda);
    const parameters = (lambda.parameters ?? []).map(symbol => {
      const parameter = this.node('Parameter', symbol.type, { name: symbol.name });
      this.parameters.set(symbol, parameter);
      return parameter;
    });
    const body = lambda.body.kind === 'ExpressionBody' ? lambda.body.expression : lambda.body;
    return this.node('Lambda', delegateType, { body: this.visit(body), parameters });
  }
  visit(node) {
    if (node.hasErrors) this.fail('an expression with errors', node);
    if (node.constantValue && node.kind !== 'Lambda') return this.constant(node.constantValue.isNull ? null : node.constantValue.value, node.type);
    const handler = expressionTreeCreationVisitors[node.kind] ?? this['visit' + node.kind];
    if (!handler) this.fail(`'${node.kind}' in an expression tree`, node);
    return handler.call(this, node);
  }
  constant(value, type) {
    return this.node('Constant', type, { value });
  }
  visitLiteral(node) {
    if (node.literal === 'null' || node.literal === 'default') return this.constant(null, node.type ?? this.core.object);
    return this.fail('this literal', node);
  }
  visitDefault(node) {
    return this.node('Default', node.type, {});
  }
  visitParameter(node) {
    return this.parameters.get(node.parameter) ?? this.captured(node.parameter, node);
  }
  visitLocal(node) {
    return this.captured(node.local, node);
  }
  /** A variable of the enclosing method: a field of the closure object the tree holds as a constant. */
  captured(symbol, node) {
    const closure = this.node('Constant', null, { value: undefined, closure: true });
    return this.node('Field', node.type, { expression: closure, member: symbol, isCapturedVariable: true }, 'MemberAccess');
  }
  visitThis(node) {
    return this.node('Constant', node.type, { value: undefined, isThis: true });
  }
  visitBinary(node) {
    if (node.isLifted) this.fail('lifted operators', node);
    if (node.isLogical && node.method) this.fail('user-defined conditional logical operators', node);
    const [plain, checkedName] = binaryFactories[node.operator] ?? [];
    if (!plain) this.fail(`operator '${node.operator}'`, node);
    const useChecked = node.isChecked && checkedName && !node.method && integralTypes.has(node.type?.specialType);
    const factory = useChecked ? checkedName : plain;
    return this.node(factory, node.type, { operands: [this.visit(node.left), this.visit(node.right)], method: node.method ?? null });
  }
  visitUnary(node) {
    if (node.isLifted) this.fail('lifted operators', node);
    const [plain, checkedName] = unaryFactories[node.operator] ?? [];
    if (!plain) this.fail(`operator '${node.operator}'`, node);
    const useChecked = node.isChecked && checkedName && !node.method && integralTypes.has(node.type?.specialType);
    return this.node(useChecked ? checkedName : plain, node.type, { operands: [this.visit(node.operand)], method: node.method ?? null });
  }
  visitConversion(node) {
    const kind = node.conversion?.kind;
    if (kind === 'AnonymousFunction') return this.nestedLambda(node);
    if (kind === 'NullLiteral' || kind === 'DefaultLiteral') return this.constant(null, node.type);
    if (transparentConversions.has(kind)) return this.visit(node.operand);
    if (kind === 'ImplicitReference' && !node.isExplicit) return this.visit(node.operand);
    if (kind === 'MethodGroup') this.fail('a method group conversion', node);
    return this.node('Convert', node.type, { operands: [this.visit(node.operand)], method: node.conversion?.method ?? null });
  }
  /** A lambda inside the tree: a Lambda node, quoted when it is itself converted to an expression tree. */
  nestedLambda(node) {
    const delegateType = expressionTreeDelegate(node.type, this.core),
      lambda = this.lambda(node.operand, delegateType ?? node.type);
    return delegateType ? this.node('Quote', node.type, { operands: [lambda] }) : lambda;
  }
  visitAs(node) {
    return this.node('TypeAs', node.type, { operands: [this.visit(node.operand)] });
  }
  visitIs(node) {
    return this.node('TypeIs', this.core.bool, { expression: this.visit(node.operand), typeOperand: node.testedType });
  }
  visitConditional(node) {
    return this.node(
      'Condition',
      node.type,
      { operands: [this.visit(node.condition), this.visit(node.whenTrue), this.visit(node.whenFalse)] },
      'Conditional',
    );
  }
  visitCoalesce(node) {
    if (node.right.form === 'throw') this.fail('a throw expression', node.right);
    if (node.leftConversion && !node.leftConversion.isIdentity) this.fail('a coalescing conversion', node);
    return this.node('Coalesce', node.type, { operands: [this.visit(node.left), this.visit(node.right)] });
  }
  visitFieldAccess(node) {
    return this.member('Field', node, node.field);
  }
  visitPropertyAccess(node) {
    return this.member('Property', node, node.property);
  }
  member(factory, node, symbol) {
    const expression = symbol.isStatic || !node.receiver ? null : this.visit(node.receiver);
    return this.node(factory, node.type, { expression, member: symbol }, 'MemberAccess');
  }
  visitArrayLength(node) {
    if (node.member !== 'Length') this.fail(`'${node.member}' of an array`, node);
    return this.node('ArrayLength', node.type, { operands: [this.visit(node.array)] });
  }
  visitIndexerAccess(node) {
    const getter = node.property.getMethod;
    if (!getter?.name) this.fail('this indexer', node);
    return this.node('Call', node.type, { object: this.visit(node.receiver), method: getter, arguments: this.arguments(node) });
  }
  arguments(node) {
    return (node.args ?? []).map(argument => {
      if (argument.refKind) this.fail('by-reference arguments', node);
      return this.visit(argument.expression ?? argument);
    });
  }
  visitCall(node) {
    const method = node.method;
    if (node.isDelegateInvoke || method.methodKind === MethodKind.DelegateInvoke)
      return this.node('Invoke', node.type, { expression: this.visit(node.receiver), arguments: this.arguments(node) });
    if (method.methodKind === MethodKind.LocalFunction) this.fail('a reference to a local function', node);
    const object = method.isStatic || node.isExtension || !node.receiver ? null : this.visit(node.receiver);
    return this.node('Call', node.type, { object, method, arguments: this.arguments(node), isExtension: !!node.isExtension });
  }
}

/**
 * Lowers a bound lambda converted to `Expression<TDelegate>`.
 * @param lambda the bound Lambda node (its body bound against the delegate type)
 * @param delegateType the `TDelegate` of the target  @param core the core types of the compilation
 * @returns {{tree: object}|{unsupported: string, syntax: object|null}}
 */
export function lowerExpressionTree(lambda, delegateType, core) {
  try {
    return { tree: new TreeBuilder(core).lambda(lambda, delegateType) };
  } catch (error) {
    if (!(error instanceof Unsupported)) throw error;
    return { unsupported: error.what, syntax: error.syntax };
  }
}

/**
 * Translator mixin: a lambda converted to an expression tree cannot be generated yet. The tree is known (see
 * `lowerExpressionTree`); the factory methods it calls are not in the runtime.
 */
export const ExpressionTreeTranslation = Base =>
  class extends Base {
    /** Any use of an expression tree type stops generation with the reason, before the type itself is looked up. */
    imageType(type, syntax) {
      if (expressionTreeDelegate(type, this.g.analysis.core))
        return this.unsupported('expression trees (System.Linq.Expressions is not in the runtime)', syntax);
      return super.imageType(type, syntax);
    }
  };
