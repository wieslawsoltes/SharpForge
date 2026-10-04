/**
 * The expression tree types the binder needs (SF-A02-T07.5): `Expression`, `LambdaExpression`, `Expression<TDelegate>`
 * and `ExpressionVisitor` of System.Linq.Expressions, with the members programs name most (`Compile`, `Visit`,
 * `NodeType` and its enum `ExpressionType`).
 * The framework registry does not list them - the runtime cannot execute expression trees - so the core library of
 * a compilation gets their symbols here, once per bridge. Other members are unknown, not errors.
 */
import { NamedTypeSymbol, TypeWithAnnotations, TypeKind, Accessibility } from './types.js';
import { MethodSymbol, PropertySymbol, ParameterSymbol, MethodKind, DeclarationModifiers } from './members.js';

const EXPRESSIONS = 'System.Linq.Expressions';

function addMethod(owner, name, returnType, parameters, modifiers = 0) {
  if (owner.getMembers(name).length) return;
  owner.addMember(new MethodSymbol({ name, returnType, parameters, declaredAccessibility: Accessibility.Public, modifiers, isImplicitlyDeclared: true }));
}

/** The enum `ExpressionType`, declared without its members: a program reads `NodeType`, it rarely names a member. */
function expressionTypeEnum(bridge, core) {
  const namespace = (bridge.bridge ?? bridge).globalNamespace?.ensureNamespace(EXPRESSIONS);
  if (!namespace) return null;
  const existing = namespace.getTypeMembers('ExpressionType', 0)[0];
  if (existing) return existing;
  return namespace.addType(
    new NamedTypeSymbol({
      name: 'ExpressionType',
      typeKind: TypeKind.Enum,
      declaredAccessibility: Accessibility.Public,
      enumUnderlyingType: core.int,
      baseType: () => core.enumType,
    }),
  );
}

/** `ExpressionType NodeType { get; }` on `Expression`. */
function addNodeType(expression, nodeKind) {
  if (!nodeKind || expression.getMembers('NodeType').length) return;
  const common = { declaredAccessibility: Accessibility.Public, modifiers: DeclarationModifiers.Virtual, isImplicitlyDeclared: true },
    getMethod = new MethodSymbol({ ...common, name: 'get_NodeType', methodKind: MethodKind.PropertyGet, returnType: nodeKind, parameters: [] });
  expression.addMember(getMethod);
  expression.addMember(new PropertySymbol({ ...common, name: 'NodeType', type: nodeKind, getMethod }));
}

/** Resolves the expression tree types on `core` (`expression`, `lambdaExpression`, `expressionT`). */
export function declareExpressionTreeTypes(core) {
  const bridge = core.bridge,
    expression = bridge.coreType('System_Linq_Expressions_Expression'),
    visitor = bridge.coreType('System_Linq_Expressions_ExpressionVisitor');
  core.expression = expression;
  core.lambdaExpression = bridge.coreType('System_Linq_Expressions_LambdaExpression');
  core.expressionT = bridge.coreType('System_Linq_Expressions_Expression_T');
  // A referenced core library (it has an `assembly`) reads the expression tree classes, with all their members, from metadata.
  if (bridge.assembly && expression.containingAssembly) return;
  if (bridge.expressionTreesDeclared) return;
  bridge.expressionTreesDeclared = true;
  addMethod(core.expressionT, 'Compile', new TypeWithAnnotations(core.expressionT.typeParameters[0]), []);
  addMethod(visitor, 'Visit', expression, [new ParameterSymbol({ name: 'node', type: expression })], DeclarationModifiers.Virtual);
  addNodeType(expression, expressionTypeEnum(bridge, core));
}

/** The delegate type of `Expression<TDelegate>`, or null for any other type. */
export function expressionTreeDelegate(type, core) {
  if (!type || type.originalDefinition !== core.expressionT) return null;
  return type.typeArguments?.[0]?.type ?? null;
}
