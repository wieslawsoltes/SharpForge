/**
 * Expression trees as factory calls (SF-A02-T30): the tree `lowerExpressionTree` describes (lowering/expression-trees.js)
 * written as the calls of `System.Linq.Expressions.Expression` factory methods Roslyn emits.
 *
 *   typeof(T)        ldtoken T; call Type.GetTypeFromHandle
 *   a method         ldtoken M; call MethodBase.GetMethodFromHandle; castclass MethodInfo   (ConstructorInfo for a constructor)
 *   a field          ldtoken F; call FieldInfo.GetFieldFromHandle
 *   a parameter      created once per lambda, kept in a local, pushed at every use
 *   a variable of the enclosing method     Expression.Field(Expression.Constant(its cell), <>Cell.Value)
 *
 * A member of a generic type needs the handle of its declaring type as well (the two-argument `GetMethodFromHandle`).
 */
import { MethodKind } from '../../symbols/members.js';
import { needsTypeSpec } from '../../codegen/generics.js';
import { frameworkType, methodTypeParameter } from './framework-types.js';
import { needsBox, primitiveOf, representationOf } from './type-facts.js';
import { expressionTreeCreationFactories } from './expression-tree-creation-factories.js';
import { anonymousMemberToken } from './anonymous-type-members.js';

const EXPRESSIONS = 'System.Linq.Expressions';
const REFLECTION = 'System.Reflection';
/** Factories that take their operands and, when the operator is user-defined, its method. */
const comparisons = new Set(['Equal', 'NotEqual', 'LessThan', 'LessThanOrEqual', 'GreaterThan', 'GreaterThanOrEqual']);
const typedUnary = new Set(['Convert', 'ConvertChecked', 'TypeAs']);

export class ExpressionTreeFactories {
  /** @param emitter the MethodEmitter of the body that creates the tree */
  constructor(emitter) {
    this.emitter = emitter;
    this.il = emitter.il;
    this.core = emitter.core;
    this.tokens = emitter.tokens;
    /** Parameter node of the tree -> the local that holds its ParameterExpression. */
    this.parameterSlots = new Map();
    const core = this.core,
      named = (namespace, name) => frameworkType(core, namespace, name);
    this.expression = core.expression;
    this.types = {
      parameter: named(EXPRESSIONS, 'ParameterExpression'),
      newExpression: named(EXPRESSIONS, 'NewExpression'),
      memberBinding: named(EXPRESSIONS, 'MemberBinding'),
      elementInit: named(EXPRESSIONS, 'ElementInit'),
      methodBase: named(REFLECTION, 'MethodBase'),
      methodInfo: named(REFLECTION, 'MethodInfo'),
      constructorInfo: named(REFLECTION, 'ConstructorInfo'),
      fieldInfo: named(REFLECTION, 'FieldInfo'),
      memberInfo: named(REFLECTION, 'MemberInfo'),
      typeHandle: core.bridge.coreType('System_RuntimeTypeHandle'),
      methodHandle: core.bridge.coreType('System_RuntimeMethodHandle'),
      fieldHandle: core.bridge.coreType('System_RuntimeFieldHandle'),
    };
  }
  /** `call Expression::name(parameters) : returns`; the arguments are on the stack. */
  factory(name, parameters, returns) {
    const shape = { isStatic: true, returnType: returns, parameters: parameters.map(type => ({ type })) };
    return this.il.emit('call', this.tokens.external(this.expression, name, shape), { pops: parameters.length, pushes: 1 });
  }
  /** The result type of a factory by the class name .NET declares (`BinaryExpression`, ...). */
  result(name) {
    return frameworkType(this.core, EXPRESSIONS, name);
  }
  arrayOf(elementType) {
    return this.emitter.arrayTypeOf(elementType);
  }
  typeOf(type) {
    const shape = { isStatic: true, returnType: this.core.type, parameters: [{ type: this.types.typeHandle }] };
    this.il.emit('ldtoken', this.tokens.type(type));
    return this.il.emit('call', this.tokens.external(this.core.type, 'GetTypeFromHandle', shape), { pops: 1, pushes: 1 });
  }
  /** Pushes the handle-to-reflection call for a member token; a member of a generic type also names that type. */
  fromHandle(owner, name, handleType, returns, declaringType) {
    const generic = declaringType && (needsTypeSpec(declaringType) || declaringType.isGenericType),
      parameters = generic ? [{ type: handleType }, { type: this.types.typeHandle }] : [{ type: handleType }];
    if (generic) this.il.emit('ldtoken', this.tokens.type(declaringType));
    return this.il.emit('call', this.tokens.external(owner, name, { isStatic: true, returnType: returns, parameters }), {
      pops: parameters.length,
      pushes: 1,
    });
  }
  /** Pushes the MethodInfo of a method (the ConstructorInfo of a constructor). */
  methodOf(method) {
    if (method.containingType?.isAnonymousType) return this.anonymousMethodOf(method.containingType, method.name);
    const { methodBase, methodHandle, methodInfo, constructorInfo } = this.types,
      isConstructor = method.methodKind === MethodKind.Constructor;
    this.il.emit('ldtoken', this.tokens.method(method));
    this.fromHandle(methodBase, 'GetMethodFromHandle', methodHandle, methodBase, method.containingType);
    return this.il.emit('castclass', this.tokens.type(isConstructor ? constructorInfo : methodInfo));
  }
  /** Anonymous members use their planned generic template, with the constructed type handle. */
  anonymousMethodOf(type, name) {
    const { methodBase, methodHandle, methodInfo, constructorInfo } = this.types;
    this.il.emit('ldtoken', anonymousMemberToken(this.tokens, type, name));
    this.fromHandle(methodBase, 'GetMethodFromHandle', methodHandle, methodBase, type.metadataForm());
    return this.il.emit('castclass', this.tokens.type(name === '.ctor' ? constructorInfo : methodInfo));
  }
  fieldOf(token, declaringType) {
    this.il.emit('ldtoken', token);
    return this.fromHandle(this.types.fieldInfo, 'GetFieldFromHandle', this.types.fieldHandle, this.types.fieldInfo, declaringType);
  }
  /** Pushes an array of the given element type holding what each `push` leaves on the stack. */
  array(elementType, pushes) {
    const il = this.il;
    il.emit('ldc.i4', pushes.length).emit('newarr', this.tokens.type(elementType));
    pushes.forEach((push, index) => {
      il.emit('dup').emit('ldc.i4', index);
      push();
      il.emit('stelem.ref');
    });
  }
  expressions(nodes) {
    this.array(
      this.expression,
      nodes.map(node => () => this.emit(node)),
    );
  }
  /** Emits the factory calls of one node of the tree; its expression object is left on the stack. */
  emit(node) {
    const handler = expressionTreeCreationFactories[node.factory] ?? this['emit' + node.factory];
    if (handler) return handler.call(this, node);
    if (node.operands?.length === 2) return this.binary(node);
    if (node.operands?.length === 1) return this.unary(node);
    return this.emitter.unsupported(`'${node.factory}' in an expression tree`);
  }
  emitLambda(node) {
    const il = this.il,
      { parameter } = this.types,
      shape = {
        isStatic: true,
        arity: 1,
        returnType: this.core.expressionT.construct(methodTypeParameter(0)),
        parameters: [{ type: this.expression }, { type: this.arrayOf(parameter) }],
      };
    for (const declared of node.parameters) {
      const slot = this.emitter.temp(parameter);
      this.typeOf(declared.type);
      il.emit('ldstr', this.tokens.string(declared.name));
      this.factory('Parameter', [this.core.type, this.core.string], parameter);
      il.emit('stloc', slot);
      this.parameterSlots.set(declared, slot);
    }
    this.emit(node.body);
    this.array(
      parameter,
      node.parameters.map(declared => () => il.emit('ldloc', this.parameterSlots.get(declared))),
    );
    if (!node.type) return this.factory('Lambda', [this.expression, this.arrayOf(parameter)], this.core.lambdaExpression);
    return il.emit('call', this.tokens.externalGeneric(this.expression, 'Lambda', shape, [node.type]), { pops: 2, pushes: 1 });
  }
  emitParameter(node) {
    const slot = this.parameterSlots.get(node);
    if (slot === undefined) return this.emitter.unsupported('a parameter of another expression tree');
    return this.il.emit('ldloc', slot);
  }
  emitConstant(node) {
    const { il, core, emitter } = this,
      constant = this.result('ConstantExpression');
    if (node.isThis) {
      emitter.exprThis({ syntax: null });
      if (needsBox(node.type)) il.emit('box', this.tokens.type(node.type));
    } else if (node.isDefault) {
      emitter.defaultValue(node.type);
      if (needsBox(node.type)) il.emit('box', this.tokens.type(node.type));
    } else if (node.value === null || node.value === undefined) il.emit('ldnull');
    else {
      const representation = representationOf(node.type),
        keyword = [...core.byKeyword].find(([, type]) => type === representation || type.equals(representation))?.[0];
      if (!keyword) return emitter.unsupported(`a constant of type '${node.type?.toDisplayString()}' in an expression tree`);
      emitter.constantValue({ type: keyword, value: node.value });
      if (needsBox(node.type) || primitiveOf(node.type)) il.emit('box', this.tokens.type(node.type));
    }
    this.typeOf(node.type ?? core.object);
    return this.factory('Constant', [core.object, core.type], constant);
  }
  emitDefault(node) {
    this.typeOf(node.type);
    return this.factory('Default', [this.core.type], this.result('DefaultExpression'));
  }
  binary(node) {
    const { expression } = this,
      { methodInfo } = this.types,
      result = this.result('BinaryExpression');
    this.emit(node.operands[0]);
    this.emit(node.operands[1]);
    if (!node.method && node.factory === 'Add' && node.type?.specialType === 'System_String') return this.concatenation(node, result);
    if (!node.method) return this.factory(node.factory, [expression, expression], result);
    if (comparisons.has(node.factory)) this.il.emit('ldc.i4', node.liftToNull ? 1 : 0);
    this.methodOf(node.method);
    const parameters = comparisons.has(node.factory) ? [expression, expression, this.core.bool, methodInfo] : [expression, expression, methodInfo];
    return this.factory(node.factory, parameters, result);
  }
  /** `+` over strings has no operator method: the tree names `String.Concat`, over strings or over objects. */
  concatenation(node, result) {
    const { core, expression } = this,
      { methodBase, methodHandle, methodInfo } = this.types,
      bothStrings = node.operands.every(operand => operand.type?.specialType === 'System_String'),
      operandType = bothStrings ? core.string : core.object,
      shape = { isStatic: true, returnType: core.string, parameters: [{ type: operandType }, { type: operandType }] };
    this.il.emit('ldtoken', this.tokens.external(core.string, 'Concat', shape));
    this.fromHandle(methodBase, 'GetMethodFromHandle', methodHandle, methodBase, null);
    this.il.emit('castclass', this.tokens.type(methodInfo));
    return this.factory('Add', [expression, expression, methodInfo], result);
  }
  unary(node) {
    const { expression, core } = this,
      { methodInfo } = this.types,
      isTyped = typedUnary.has(node.factory),
      parameters = [expression, ...(isTyped ? [core.type] : []), ...(node.method ? [methodInfo] : [])];
    this.emit(node.operands[0]);
    if (isTyped) this.typeOf(node.type);
    if (node.method) this.methodOf(node.method);
    return this.factory(node.factory, parameters, this.result('UnaryExpression'));
  }
  emitTypeIs(node) {
    this.emit(node.expression);
    this.typeOf(node.typeOperand);
    return this.factory('TypeIs', [this.expression, this.core.type], this.result('TypeBinaryExpression'));
  }
  emitCondition(node) {
    const { expression } = this;
    for (const operand of node.operands) this.emit(operand);
    return this.factory('Condition', [expression, expression, expression], this.result('ConditionalExpression'));
  }
  emitCoalesce(node) {
    if (!node.conversion) return this.binary(node);
    for (const operand of node.operands) this.emit(operand);
    this.emit(node.conversion);
    return this.factory('Coalesce', [this.expression, this.expression, this.core.lambdaExpression], this.result('BinaryExpression'));
  }
  /** The object a member is read from: the expression, or null for a static member. */
  instance(expression) {
    if (expression) return this.emit(expression);
    return this.il.emit('ldnull');
  }
  emitField(node) {
    const member = this.result('MemberExpression');
    if (node.isCapturedVariable) return this.capturedVariable(node, member);
    this.instance(node.expression);
    this.fieldOf(this.tokens.field(node.member), node.member.containingType);
    return this.factory('Field', [this.expression, this.types.fieldInfo], member);
  }
  /** A variable of the enclosing method lives in a cell; the tree reads the cell's field. */
  capturedVariable(node, member) {
    const emitter = this.emitter,
      cell = emitter.cellOf(node.member);
    if (!cell) return emitter.unsupported(`the variable '${node.member.name}' in an expression tree`);
    emitter.pushCell(node.member);
    this.factory('Constant', [this.core.object], this.result('ConstantExpression'));
    this.fieldOf(cell.value.token, cell.type);
    return this.factory('Field', [this.expression, this.types.fieldInfo], member);
  }
  emitProperty(node) {
    const getter = node.member.getMethod;
    if (!getter) return this.emitter.unsupported(`the property '${node.member.name}' in an expression tree`);
    this.instance(node.expression);
    this.methodOf(getter);
    return this.factory('Property', [this.expression, this.types.methodInfo], this.result('MemberExpression'));
  }
  emitCall(node) {
    const { expression } = this;
    this.instance(node.object);
    this.methodOf(node.method);
    this.expressions(node.arguments);
    return this.factory('Call', [expression, this.types.methodInfo, this.arrayOf(expression)], this.result('MethodCallExpression'));
  }
  emitInvoke(node) {
    const { expression } = this;
    this.emit(node.expression);
    this.expressions(node.arguments);
    return this.factory('Invoke', [expression, this.arrayOf(expression)], this.result('InvocationExpression'));
  }
}
