/**
 * The registry of parser modules. Each module exports one object of parser methods for a grammar family (a statement
 * form, a declaration kind, an expression family, a language-version feature); parser.js installs them on the Parser.
 * Adding grammar means adding a module here, not editing a central parser file. Method names are unique across modules.
 */
import { typeMethods } from './types.js';
import { modifierMethods } from './modifiers.js';
import { statementMethods } from './statements.js';
import { expressionMethods } from './expressions.js';
import { namespaceMethods } from './declarations/namespaces.js';
import { typeDeclarationMethods } from './declarations/types.js';
import { enumMethods } from './declarations/enums.js';
import { delegateMethods } from './declarations/delegates.js';
import { memberMethods } from './declarations/members.js';
import { attributeMethods } from './declarations/attributes.js';
import { eventMethods } from './declarations/events.js';
import { operatorMethods } from './declarations/operators.js';
import { constructorMethods } from './declarations/constructors.js';
import { typeParameterMethods } from './declarations/type-parameters.js';
import { anonymousFunctionMethods } from './expressions/anonymous-functions.js';
import { lambdaMethods } from './expressions/lambdas.js';
import { queryMethods } from './expressions/queries.js';
import { tupleMethods } from './expressions/tuples.js';
import { nullabilityMethods } from './expressions/nullability.js';
import { genericNameMethods } from './expressions/generic-names.js';
import { basicPatternMethods } from './patterns/basic.js';
import { recursivePatternMethods } from './patterns/recursive.js';
import { combinatorPatternMethods } from './patterns/combinators.js';
import { listPatternMethods } from './patterns/lists.js';
import { recordMethods } from './declarations/records.js';
import { recordStructMethods } from './declarations/record-structs.js';
import { withMethods } from './expressions/with.js';
import { accessorMethods } from './declarations/accessors.js';
import { propertyMethods } from './declarations/properties.js';
import { primaryConstructorMethods } from './declarations/primary-constructors.js';
import { partialMemberMethods } from './declarations/partial-members.js';
import { typeModifierMethods } from './declarations/type-modifiers.js';
import { extensionMethods } from './declarations/extensions.js';
import { modernOperatorMethods } from './declarations/operators-modern.js';
import { extensionIndexerMethods } from './declarations/extension-indexers.js';
import { unionMethods } from './declarations/unions.js';
import { closedMethods } from './declarations/closed.js';
import { safetyModifierMethods } from './declarations/safety-modifiers.js';
import { jumpStatementMethods } from './statements/jumps.js';
import { blockStatementMethods } from './statements/blocks.js';
import { tryStatementMethods } from './statements/try.js';
import { localStatementMethods } from './statements/locals.js';
import { yieldStatementMethods } from './statements/yield.js';
import { fixedStatementMethods } from './unsafe/fixed.js';
import { argumentMethods } from './expressions/arguments.js';
import { initializerMethods } from './expressions/initializers.js';
import { objectCreationMethods } from './expressions/object-creation.js';
import { collectionExpressionMethods } from './expressions/collection-expressions.js';
import { switchExpressionMethods } from './expressions/switch-expression.js';
import { interpolatedStringMethods } from './expressions/interpolated-strings.js';
import { stackAllocMethods } from './unsafe/stackalloc.js';
import { anonymousObjectMethods } from './expressions/anonymous-objects.js';
import { parameterMethods } from './declarations/parameters.js';
import { awaitMethods } from './expressions/await.js';
export const parserModules = Object.freeze([
  typeMethods,
  modifierMethods,
  statementMethods,
  expressionMethods,
  namespaceMethods,
  typeDeclarationMethods,
  enumMethods,
  delegateMethods,
  memberMethods,
  attributeMethods,
  eventMethods,
  operatorMethods,
  constructorMethods,
  typeParameterMethods,
  anonymousFunctionMethods,
  lambdaMethods,
  queryMethods,
  tupleMethods,
  nullabilityMethods,
  genericNameMethods,
  basicPatternMethods,
  recursivePatternMethods,
  combinatorPatternMethods,
  listPatternMethods,
  recordMethods,
  recordStructMethods,
  withMethods,
  accessorMethods,
  propertyMethods,
  primaryConstructorMethods,
  partialMemberMethods,
  typeModifierMethods,
  extensionMethods,
  modernOperatorMethods,
  extensionIndexerMethods,
  unionMethods,
  closedMethods,
  safetyModifierMethods,
  jumpStatementMethods,
  blockStatementMethods,
  tryStatementMethods,
  localStatementMethods,
  yieldStatementMethods,
  fixedStatementMethods,
  argumentMethods,
  initializerMethods,
  objectCreationMethods,
  collectionExpressionMethods,
  switchExpressionMethods,
  interpolatedStringMethods,
  stackAllocMethods,
  anonymousObjectMethods,
  parameterMethods,
  awaitMethods
]);
