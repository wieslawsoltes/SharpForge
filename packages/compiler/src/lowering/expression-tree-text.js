/**
 * What a lowered expression tree (lowering/expression-trees.js) looks like from .NET, without running it:
 *
 *   treeToString(tree)   the text `Expression.ToString()` produces (`x => (x + 1)`)
 *   nodeTypes(tree)      the `ExpressionType` of every node in the order an `ExpressionVisitor` visits them
 *   factoryCalls(tree)   the C# of the factory calls the tree stands for
 *
 * The first two are compared with pinned .NET output: they are how the shape of a tree is verified.
 */

const clrNames = Object.freeze({
  System_Int32: 'Int32',
  System_UInt32: 'UInt32',
  System_Int64: 'Int64',
  System_UInt64: 'UInt64',
  System_Int16: 'Int16',
  System_UInt16: 'UInt16',
  System_Byte: 'Byte',
  System_SByte: 'SByte',
  System_Double: 'Double',
  System_Single: 'Single',
  System_Decimal: 'Decimal',
  System_Boolean: 'Boolean',
  System_Char: 'Char',
  System_String: 'String',
  System_Object: 'Object',
  System_Void: 'Void',
});
/** Types `MethodInfo.ToString()` prints by their short name (primitives and void). */
const shortInSignatures = new Set(Object.keys(clrNames).filter(id => !['System_String', 'System_Object', 'System_Decimal'].includes(id)));
const binarySymbols = Object.freeze({
  Add: '+',
  AddChecked: '+',
  Subtract: '-',
  SubtractChecked: '-',
  Multiply: '*',
  MultiplyChecked: '*',
  Divide: '/',
  Modulo: '%',
  ExclusiveOr: '^',
  LeftShift: '<<',
  RightShift: '>>',
  Equal: '==',
  NotEqual: '!=',
  LessThan: '<',
  LessThanOrEqual: '<=',
  GreaterThan: '>',
  GreaterThanOrEqual: '>=',
  AndAlso: 'AndAlso',
  OrElse: 'OrElse',
  Coalesce: '??',
});

/** `Type.Name`: `Int32`, `String`, `List\`1`, `Int32[]`. */
export function clrName(type) {
  if (!type) return 'Object';
  if (type.isAnonymousType) return clrName(type.metadataForm());
  if (type.elementType) return clrName(type.elementType) + '[' + ','.repeat((type.rank ?? 1) - 1) + ']';
  if (clrNames[type.specialType]) return clrNames[type.specialType];
  const arity = type.typeArguments?.length ?? type.arity ?? 0;
  return arity ? `${type.name}\`${arity}` : type.name;
}
/** `Type.ToString()`: the namespace-qualified name. */
export function clrFullName(type) {
  if (!type) return 'System.Object';
  if (type.elementType) return clrFullName(type.elementType) + '[' + ','.repeat((type.rank ?? 1) - 1) + ']';
  if (clrNames[type.specialType]) return 'System.' + clrNames[type.specialType];
  return type.toDisplayString();
}
const signatureName = type => (shortInSignatures.has(type?.specialType) ? clrNames[type.specialType] : clrFullName(type));
/** `MethodInfo.ToString()`: `Void Add(Int32)`. */
const methodText = method => `${signatureName(method.returnType)} ${method.name}(${method.parameters.map(p => signatureName(p.type)).join(', ')})`;
const isBool = type => type?.specialType === 'System_Boolean';

function bindingChildren(binding) {
  if (binding.factory === 'MemberBind') return binding.bindings.flatMap(bindingChildren);
  if (binding.factory === 'ListBind') return binding.initializers.flatMap(initializer => initializer.arguments);
  return [binding.expression];
}

function bindingText(binding, text) {
  const name = binding.member.name;
  if (binding.factory === 'MemberBind') return `${name} = {${binding.bindings.map(child => bindingText(child, text)).join(', ')}}`;
  if (binding.factory === 'ListBind') {
    const values = binding.initializers.map(initializer => `${methodText(initializer.addMethod)}(${initializer.arguments.map(text).join(', ')})`);
    return `${name} = {${values.join(', ')}}`;
  }
  return `${name} = ${text(binding.expression)}`;
}

/** The child expressions of a node in the order `ExpressionVisitor` visits them. */
export function childrenOf(node) {
  switch (node.factory) {
    case 'Lambda':
      return [node.body, ...node.parameters];
    case 'Parameter':
    case 'Constant':
    case 'Default':
      return [];
    case 'Field':
    case 'Property':
      return node.expression ? [node.expression] : [];
    case 'TypeIs':
      return [node.expression];
    case 'Coalesce':
      return [node.operands[0], ...(node.conversion ? [node.conversion] : []), node.operands[1]];
    case 'Call':
      return [...(node.object ? [node.object] : []), ...node.arguments];
    case 'Invoke':
      return [node.expression, ...node.arguments];
    case 'New':
      return node.arguments;
    case 'MemberInit':
      return [node.newExpression, ...node.bindings.flatMap(bindingChildren)];
    case 'ListInit':
      return [node.newExpression, ...node.initializers.flatMap(initializer => initializer.arguments)];
    case 'NewArrayInit':
    case 'NewArrayBounds':
      return node.expressions;
    default:
      return node.operands ?? [];
  }
}

/** The node types in visiting order (pre-order over `childrenOf`). */
export function nodeTypes(tree) {
  const types = [];
  const visit = node => {
    types.push(node.nodeType);
    for (const child of childrenOf(node)) visit(child);
  };
  visit(tree);
  return types;
}

function constantText(node) {
  if (node.isThis) return `value(${clrFullName(node.type)})`;
  if (node.methodValue) return methodText(node.methodValue);
  if (node.typeValue) return clrFullName(node.typeValue);
  if (node.isDefault) {
    if (node.type?.isReferenceType || node.type?.isNullableValueType) return 'null';
    if (node.type?.specialType === 'System_Boolean') return 'False';
    return clrNames[node.type?.specialType] ? '0' : `value(${clrFullName(node.type)})`;
  }
  if (node.closure) return 'value(<>c__DisplayClass)';
  const value = node.value;
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return String(value);
}

function callText(node, text) {
  const args = node.arguments.map(text);
  if (node.isExtension) return `${args[0]}.${node.method.name}(${args.slice(1).join(', ')})`;
  return `${node.object ? text(node.object) + '.' : ''}${node.method.name}(${args.join(', ')})`;
}

function operandText(node, text) {
  const operands = (node.operands ?? []).map(text);
  switch (node.factory) {
    case 'Negate':
    case 'NegateChecked':
      return `-${operands[0]}`;
    case 'UnaryPlus':
      return `+${operands[0]}`;
    case 'Not':
    case 'ArrayLength':
      return `${node.factory}(${operands[0]})`;
    case 'Convert':
    case 'ConvertChecked':
      return `${node.factory}(${operands[0]}, ${clrName(node.type)})`;
    case 'TypeAs':
      return `(${operands[0]} As ${clrName(node.type)})`;
    case 'Quote':
      return operands[0];
    case 'ArrayIndex':
      return operands.length === 2 ? `${operands[0]}[${operands[1]}]` : `${operands[0]}.Get(${operands.slice(1).join(', ')})`;
    case 'Condition':
      return `IIF(${operands.join(', ')})`;
    case 'And':
    case 'Or': {
      const word = isBool(node.type) ? node.factory : node.factory === 'And' ? '&' : '|';
      return `(${operands[0]} ${word} ${operands[1]})`;
    }
    default: {
      const symbol = binarySymbols[node.factory];
      if (!symbol) throw new Error(`No text for expression node '${node.factory}'`);
      return `(${operands[0]} ${symbol} ${operands[1]})`;
    }
  }
}

/** The text `Expression.ToString()` gives for the tree. */
export function treeToString(tree) {
  const text = node => {
    switch (node.factory) {
      case 'Lambda': {
        const names = node.parameters.map(parameter => parameter.name);
        return `${names.length === 1 ? names[0] : `(${names.join(', ')})`} => ${text(node.body)}`;
      }
      case 'Parameter':
        return node.name;
      case 'Constant':
        return constantText(node);
      case 'Default':
        return `default(${clrName(node.type)})`;
      case 'Field':
      case 'Property': {
        const owner = node.expression ? text(node.expression) : clrName(node.member.containingType);
        return `${owner}.${node.member.name}`;
      }
      case 'TypeIs':
        return `(${text(node.expression)} Is ${clrName(node.typeOperand)})`;
      case 'Call':
        return callText(node, text);
      case 'Invoke':
        return `Invoke(${[node.expression, ...node.arguments].map(text).join(', ')})`;
      case 'New': {
        const argumentsText = node.arguments.map((argument, index) => `${node.members?.[index] ? node.members[index].name + ' = ' : ''}${text(argument)}`);
        return `new ${clrName(node.type)}(${argumentsText.join(', ')})`;
      }
      case 'MemberInit':
        return `${text(node.newExpression)} {${node.bindings.map(binding => bindingText(binding, text)).join(', ')}}`;
      case 'ListInit':
        return `${text(node.newExpression)} {${node.initializers.map(i => `${methodText(i.addMethod)}(${i.arguments.map(text).join(', ')})`).join(', ')}}`;
      case 'NewArrayInit':
        return `new [] {${node.expressions.map(text).join(', ')}}`;
      case 'NewArrayBounds':
        return `new ${clrFullName(node.type)}(${node.expressions.map(text).join(', ')})`;
      default:
        return operandText(node, text);
    }
  };
  return text(tree);
}

const csharpValue = node => (typeof node.value === 'string' ? JSON.stringify(node.value) : constantText(node).toLowerCase());
const typeOf = type => `typeof(${type?.toDisplayString() ?? 'object'})`;

/**
 * The factory calls as C#: one line per parameter, then the expression that builds the tree.
 * @returns {string[]}
 */
export function factoryCalls(tree) {
  const declared = new Map();
  const call = node => {
    switch (node.factory) {
      case 'Parameter':
        if (!declared.has(node)) declared.set(node, `var ${node.name} = Expression.Parameter(${typeOf(node.type)}, "${node.name}");`);
        return node.name;
      case 'Constant':
        if (node.isThis) return 'Expression.Constant(this)';
        if (node.closure) return 'Expression.Constant(closure)';
        if (node.isDefault) return `Expression.Constant(default(${node.type.toDisplayString()}), ${typeOf(node.type)})`;
        if (node.typeValue) return `Expression.Constant(${typeOf(node.typeValue)}, typeof(System.Type))`;
        if (node.methodValue) return `Expression.Constant(/* ${node.methodValue.toDisplayString()} */, typeof(System.Reflection.MethodInfo))`;
        return `Expression.Constant(${csharpValue(node)}, ${typeOf(node.type)})`;
      case 'Lambda': {
        const parameters = node.parameters.map(call);
        const generic = node.type ? `<${node.type.toDisplayString()}>` : '';
        return `Expression.Lambda${generic}(${[call(node.body), ...parameters].join(', ')})`;
      }
      case 'Coalesce':
        return `Expression.Coalesce(${[...node.operands, ...(node.conversion ? [node.conversion] : [])].map(call).join(', ')})`;
      case 'Field':
      case 'Property':
        return `Expression.${node.factory}(${node.expression ? call(node.expression) : 'null'}, "${node.member.name}")`;
      case 'TypeIs':
        return `Expression.TypeIs(${call(node.expression)}, ${typeOf(node.typeOperand)})`;
      case 'Convert':
      case 'ConvertChecked':
      case 'TypeAs':
        return `Expression.${node.factory}(${call(node.operands[0])}, ${typeOf(node.type)})`;
      default: {
        const children = childrenOf(node).map(call);
        const member = node.method ? [`/* ${node.method.toDisplayString()} */`] : [];
        return `Expression.${node.factory}(${[...children, ...member].join(', ')})`;
      }
    }
  };
  const expression = call(tree);
  return [...declared.values(), expression + ';'];
}
