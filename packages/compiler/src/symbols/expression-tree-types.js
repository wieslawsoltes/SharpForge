/**
 * The expression tree types the binder needs (SF-A02-T07.5): `Expression`, `LambdaExpression`, `Expression<TDelegate>`
 * and `ExpressionVisitor` of System.Linq.Expressions, with the two members programs name most (`Compile`, `Visit`).
 * The framework registry does not list them - the runtime cannot execute expression trees - so the core library of
 * a compilation gets their symbols here, once per bridge. Other members are unknown, not errors.
 */
import { TypeWithAnnotations, Accessibility } from './types.js';
import { MethodSymbol, ParameterSymbol, DeclarationModifiers } from './members.js';

function addMethod(owner, name, returnType, parameters, modifiers = 0) {
  if (owner.getMembers(name).length) return;
  owner.addMember(new MethodSymbol({ name, returnType, parameters, declaredAccessibility: Accessibility.Public, modifiers, isImplicitlyDeclared: true }));
}

/** Resolves the expression tree types on `core` (`expression`, `lambdaExpression`, `expressionT`). */
export function declareExpressionTreeTypes(core) {
  const bridge = core.bridge,
    expression = bridge.coreType('System_Linq_Expressions_Expression'),
    visitor = bridge.coreType('System_Linq_Expressions_ExpressionVisitor');
  core.expression = expression;
  core.lambdaExpression = bridge.coreType('System_Linq_Expressions_LambdaExpression');
  core.expressionT = bridge.coreType('System_Linq_Expressions_Expression_T');
  if (bridge.expressionTreesDeclared) return;
  bridge.expressionTreesDeclared = true;
  addMethod(core.expressionT, 'Compile', new TypeWithAnnotations(core.expressionT.typeParameters[0]), []);
  addMethod(visitor, 'Visit', expression, [new ParameterSymbol({ name: 'node', type: expression })], DeclarationModifiers.Virtual);
}

/** The delegate type of `Expression<TDelegate>`, or null for any other type. */
export function expressionTreeDelegate(type, core) {
  if (!type || type.originalDefinition !== core.expressionT) return null;
  return type.typeArguments?.[0]?.type ?? null;
}
