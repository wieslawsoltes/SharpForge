/** Generated from grammar/syntax.json by tools/generate-nodes.js. Do not edit by hand. */
import { GreenNode } from '../green.js';
import { SyntaxNode, registerNodeClass, createNode } from '../red.js';
/** Child slot names per node kind, in Roslyn order. */
export const slotNames = Object.freeze({
  CompilationUnit: ['externs', 'usings', 'attributeLists', 'members', 'endOfFileToken'],
  ExternAliasDirective: ['externKeyword', 'aliasKeyword', 'identifier', 'semicolonToken'],
  UsingDirective: ['globalKeyword', 'usingKeyword', 'staticKeyword', 'unsafeKeyword', 'alias', 'namespaceOrType', 'semicolonToken'],
  NameEquals: ['name', 'equalsToken'],
  NamespaceDeclaration: ['attributeLists', 'modifiers', 'namespaceKeyword', 'name', 'openBraceToken', 'externs', 'usings', 'members', 'closeBraceToken', 'semicolonToken'],
  FileScopedNamespaceDeclaration: ['attributeLists', 'modifiers', 'namespaceKeyword', 'name', 'semicolonToken', 'externs', 'usings', 'members'],
  AttributeList: ['openBracketToken', 'target', 'attributes', 'closeBracketToken'],
  AttributeTargetSpecifier: ['identifier', 'colonToken'],
  Attribute: ['name', 'argumentList'],
  AttributeArgumentList: ['openParenToken', 'arguments', 'closeParenToken'],
  AttributeArgument: ['nameEquals', 'nameColon', 'expression'],
  GlobalStatement: ['attributeLists', 'modifiers', 'statement'],
  TypeParameterList: ['lessThanToken', 'parameters', 'greaterThanToken'],
  TypeParameter: ['attributeLists', 'varianceKeyword', 'identifier'],
  ClassDeclaration: ['attributeLists', 'modifiers', 'keyword', 'identifier', 'typeParameterList', 'parameterList', 'baseList', 'constraintClauses', 'openBraceToken', 'members', 'closeBraceToken', 'semicolonToken'],
  StructDeclaration: ['attributeLists', 'modifiers', 'keyword', 'identifier', 'typeParameterList', 'parameterList', 'baseList', 'constraintClauses', 'openBraceToken', 'members', 'closeBraceToken', 'semicolonToken'],
  InterfaceDeclaration: ['attributeLists', 'modifiers', 'keyword', 'identifier', 'typeParameterList', 'parameterList', 'baseList', 'constraintClauses', 'openBraceToken', 'members', 'closeBraceToken', 'semicolonToken'],
  RecordDeclaration: ['attributeLists', 'modifiers', 'keyword', 'classOrStructKeyword', 'identifier', 'typeParameterList', 'parameterList', 'baseList', 'constraintClauses', 'openBraceToken', 'members', 'closeBraceToken', 'semicolonToken'],
  RecordStructDeclaration: ['attributeLists', 'modifiers', 'keyword', 'classOrStructKeyword', 'identifier', 'typeParameterList', 'parameterList', 'baseList', 'constraintClauses', 'openBraceToken', 'members', 'closeBraceToken', 'semicolonToken'],
  EnumDeclaration: ['attributeLists', 'modifiers', 'enumKeyword', 'identifier', 'baseList', 'openBraceToken', 'members', 'closeBraceToken', 'semicolonToken'],
  DelegateDeclaration: ['attributeLists', 'modifiers', 'delegateKeyword', 'returnType', 'identifier', 'typeParameterList', 'parameterList', 'constraintClauses', 'semicolonToken'],
  EnumMemberDeclaration: ['attributeLists', 'modifiers', 'identifier', 'equalsValue'],
  BaseList: ['colonToken', 'types'],
  SimpleBaseType: ['type'],
  PrimaryConstructorBaseType: ['type', 'argumentList'],
  TypeParameterConstraintClause: ['whereKeyword', 'name', 'colonToken', 'constraints'],
  ConstructorConstraint: ['newKeyword', 'openParenToken', 'closeParenToken'],
  ClassConstraint: ['classOrStructKeyword', 'questionToken'],
  StructConstraint: ['classOrStructKeyword', 'questionToken'],
  TypeConstraint: ['type'],
  DefaultConstraint: ['defaultKeyword'],
  AllowsConstraintClause: ['allowsKeyword', 'constraints'],
  RefStructConstraint: ['refKeyword', 'structKeyword'],
  FieldDeclaration: ['attributeLists', 'modifiers', 'declaration', 'semicolonToken'],
  EventFieldDeclaration: ['attributeLists', 'modifiers', 'eventKeyword', 'declaration', 'semicolonToken'],
  ExplicitInterfaceSpecifier: ['name', 'dotToken'],
  MethodDeclaration: ['attributeLists', 'modifiers', 'returnType', 'explicitInterfaceSpecifier', 'identifier', 'typeParameterList', 'parameterList', 'constraintClauses', 'body', 'expressionBody', 'semicolonToken'],
  OperatorDeclaration: ['attributeLists', 'modifiers', 'returnType', 'explicitInterfaceSpecifier', 'operatorKeyword', 'checkedKeyword', 'operatorToken', 'parameterList', 'body', 'expressionBody', 'semicolonToken'],
  ConversionOperatorDeclaration: ['attributeLists', 'modifiers', 'implicitOrExplicitKeyword', 'explicitInterfaceSpecifier', 'operatorKeyword', 'checkedKeyword', 'type', 'parameterList', 'body', 'expressionBody', 'semicolonToken'],
  ConstructorDeclaration: ['attributeLists', 'modifiers', 'identifier', 'parameterList', 'initializer', 'body', 'expressionBody', 'semicolonToken'],
  BaseConstructorInitializer: ['colonToken', 'thisOrBaseKeyword', 'argumentList'],
  ThisConstructorInitializer: ['colonToken', 'thisOrBaseKeyword', 'argumentList'],
  DestructorDeclaration: ['attributeLists', 'modifiers', 'tildeToken', 'identifier', 'parameterList', 'body', 'expressionBody', 'semicolonToken'],
  PropertyDeclaration: ['attributeLists', 'modifiers', 'type', 'explicitInterfaceSpecifier', 'identifier', 'accessorList', 'expressionBody', 'initializer', 'semicolonToken'],
  ArrowExpressionClause: ['arrowToken', 'expression'],
  EventDeclaration: ['attributeLists', 'modifiers', 'eventKeyword', 'type', 'explicitInterfaceSpecifier', 'identifier', 'accessorList', 'semicolonToken'],
  IndexerDeclaration: ['attributeLists', 'modifiers', 'type', 'explicitInterfaceSpecifier', 'thisKeyword', 'parameterList', 'accessorList', 'expressionBody', 'semicolonToken'],
  AccessorList: ['openBraceToken', 'accessors', 'closeBraceToken'],
  GetAccessorDeclaration: ['attributeLists', 'modifiers', 'keyword', 'body', 'expressionBody', 'semicolonToken'],
  SetAccessorDeclaration: ['attributeLists', 'modifiers', 'keyword', 'body', 'expressionBody', 'semicolonToken'],
  InitAccessorDeclaration: ['attributeLists', 'modifiers', 'keyword', 'body', 'expressionBody', 'semicolonToken'],
  AddAccessorDeclaration: ['attributeLists', 'modifiers', 'keyword', 'body', 'expressionBody', 'semicolonToken'],
  RemoveAccessorDeclaration: ['attributeLists', 'modifiers', 'keyword', 'body', 'expressionBody', 'semicolonToken'],
  UnknownAccessorDeclaration: ['attributeLists', 'modifiers', 'keyword', 'body', 'expressionBody', 'semicolonToken'],
  ParameterList: ['openParenToken', 'parameters', 'closeParenToken'],
  BracketedParameterList: ['openBracketToken', 'parameters', 'closeBracketToken'],
  Parameter: ['attributeLists', 'modifiers', 'type', 'identifier', 'default'],
  IncompleteMember: ['attributeLists', 'modifiers', 'type'],
  IdentifierName: ['identifier'],
  QualifiedName: ['left', 'dotToken', 'right'],
  GenericName: ['identifier', 'typeArgumentList'],
  TypeArgumentList: ['lessThanToken', 'arguments', 'greaterThanToken'],
  AliasQualifiedName: ['alias', 'colonColonToken', 'name'],
  PredefinedType: ['keyword'],
  ArrayType: ['elementType', 'rankSpecifiers'],
  ArrayRankSpecifier: ['openBracketToken', 'sizes', 'closeBracketToken'],
  PointerType: ['elementType', 'asteriskToken'],
  FunctionPointerType: ['delegateKeyword', 'asteriskToken', 'callingConvention', 'parameterList'],
  FunctionPointerParameterList: ['lessThanToken', 'parameters', 'greaterThanToken'],
  FunctionPointerCallingConvention: ['managedOrUnmanagedKeyword', 'unmanagedCallingConventionList'],
  FunctionPointerUnmanagedCallingConventionList: ['openBracketToken', 'callingConventions', 'closeBracketToken'],
  FunctionPointerUnmanagedCallingConvention: ['name'],
  FunctionPointerParameter: ['attributeLists', 'modifiers', 'type'],
  NullableType: ['elementType', 'questionToken'],
  TupleType: ['openParenToken', 'elements', 'closeParenToken'],
  TupleElement: ['type', 'identifier'],
  OmittedTypeArgument: ['omittedTypeArgumentToken'],
  RefType: ['refKeyword', 'readOnlyKeyword', 'type'],
  ScopedType: ['scopedKeyword', 'type'],
  ParenthesizedExpression: ['openParenToken', 'expression', 'closeParenToken'],
  TupleExpression: ['openParenToken', 'arguments', 'closeParenToken'],
  UnaryPlusExpression: ['operatorToken', 'operand'],
  UnaryMinusExpression: ['operatorToken', 'operand'],
  BitwiseNotExpression: ['operatorToken', 'operand'],
  LogicalNotExpression: ['operatorToken', 'operand'],
  PreIncrementExpression: ['operatorToken', 'operand'],
  PreDecrementExpression: ['operatorToken', 'operand'],
  AddressOfExpression: ['operatorToken', 'operand'],
  PointerIndirectionExpression: ['operatorToken', 'operand'],
  IndexExpression: ['operatorToken', 'operand'],
  AwaitExpression: ['awaitKeyword', 'expression'],
  PostIncrementExpression: ['operand', 'operatorToken'],
  PostDecrementExpression: ['operand', 'operatorToken'],
  SuppressNullableWarningExpression: ['operand', 'operatorToken'],
  SimpleMemberAccessExpression: ['expression', 'operatorToken', 'name'],
  PointerMemberAccessExpression: ['expression', 'operatorToken', 'name'],
  ConditionalAccessExpression: ['expression', 'operatorToken', 'whenNotNull'],
  MemberBindingExpression: ['operatorToken', 'name'],
  ElementBindingExpression: ['argumentList'],
  RangeExpression: ['leftOperand', 'operatorToken', 'rightOperand'],
  ImplicitElementAccess: ['argumentList'],
  AddExpression: ['left', 'operatorToken', 'right'],
  SubtractExpression: ['left', 'operatorToken', 'right'],
  MultiplyExpression: ['left', 'operatorToken', 'right'],
  DivideExpression: ['left', 'operatorToken', 'right'],
  ModuloExpression: ['left', 'operatorToken', 'right'],
  LeftShiftExpression: ['left', 'operatorToken', 'right'],
  RightShiftExpression: ['left', 'operatorToken', 'right'],
  UnsignedRightShiftExpression: ['left', 'operatorToken', 'right'],
  LogicalOrExpression: ['left', 'operatorToken', 'right'],
  LogicalAndExpression: ['left', 'operatorToken', 'right'],
  BitwiseOrExpression: ['left', 'operatorToken', 'right'],
  BitwiseAndExpression: ['left', 'operatorToken', 'right'],
  ExclusiveOrExpression: ['left', 'operatorToken', 'right'],
  EqualsExpression: ['left', 'operatorToken', 'right'],
  NotEqualsExpression: ['left', 'operatorToken', 'right'],
  LessThanExpression: ['left', 'operatorToken', 'right'],
  LessThanOrEqualExpression: ['left', 'operatorToken', 'right'],
  GreaterThanExpression: ['left', 'operatorToken', 'right'],
  GreaterThanOrEqualExpression: ['left', 'operatorToken', 'right'],
  IsExpression: ['left', 'operatorToken', 'right'],
  AsExpression: ['left', 'operatorToken', 'right'],
  CoalesceExpression: ['left', 'operatorToken', 'right'],
  SimpleAssignmentExpression: ['left', 'operatorToken', 'right'],
  AddAssignmentExpression: ['left', 'operatorToken', 'right'],
  SubtractAssignmentExpression: ['left', 'operatorToken', 'right'],
  MultiplyAssignmentExpression: ['left', 'operatorToken', 'right'],
  DivideAssignmentExpression: ['left', 'operatorToken', 'right'],
  ModuloAssignmentExpression: ['left', 'operatorToken', 'right'],
  AndAssignmentExpression: ['left', 'operatorToken', 'right'],
  ExclusiveOrAssignmentExpression: ['left', 'operatorToken', 'right'],
  OrAssignmentExpression: ['left', 'operatorToken', 'right'],
  LeftShiftAssignmentExpression: ['left', 'operatorToken', 'right'],
  RightShiftAssignmentExpression: ['left', 'operatorToken', 'right'],
  UnsignedRightShiftAssignmentExpression: ['left', 'operatorToken', 'right'],
  CoalesceAssignmentExpression: ['left', 'operatorToken', 'right'],
  ConditionalExpression: ['condition', 'questionToken', 'whenTrue', 'colonToken', 'whenFalse'],
  ThisExpression: ['token'],
  BaseExpression: ['token'],
  NumericLiteralExpression: ['token'],
  StringLiteralExpression: ['token'],
  Utf8StringLiteralExpression: ['token'],
  CharacterLiteralExpression: ['token'],
  TrueLiteralExpression: ['token'],
  FalseLiteralExpression: ['token'],
  NullLiteralExpression: ['token'],
  DefaultLiteralExpression: ['token'],
  ArgListExpression: ['token'],
  FieldExpression: ['token'],
  MakeRefExpression: ['keyword', 'openParenToken', 'expression', 'closeParenToken'],
  RefTypeExpression: ['keyword', 'openParenToken', 'expression', 'closeParenToken'],
  RefValueExpression: ['keyword', 'openParenToken', 'expression', 'comma', 'type', 'closeParenToken'],
  TypeOfExpression: ['keyword', 'openParenToken', 'type', 'closeParenToken'],
  SizeOfExpression: ['keyword', 'openParenToken', 'type', 'closeParenToken'],
  DefaultExpression: ['keyword', 'openParenToken', 'type', 'closeParenToken'],
  CheckedExpression: ['keyword', 'openParenToken', 'expression', 'closeParenToken'],
  UncheckedExpression: ['keyword', 'openParenToken', 'expression', 'closeParenToken'],
  InvocationExpression: ['expression', 'argumentList'],
  ElementAccessExpression: ['expression', 'argumentList'],
  ArgumentList: ['openParenToken', 'arguments', 'closeParenToken'],
  BracketedArgumentList: ['openBracketToken', 'arguments', 'closeBracketToken'],
  Argument: ['nameColon', 'refKindKeyword', 'expression'],
  ExpressionColon: ['expression', 'colonToken'],
  NameColon: ['name', 'colonToken'],
  DeclarationExpression: ['type', 'designation'],
  CastExpression: ['openParenToken', 'type', 'closeParenToken', 'expression'],
  AnonymousMethodExpression: ['modifiers', 'delegateKeyword', 'parameterList', 'block', 'expressionBody'],
  SimpleLambdaExpression: ['attributeLists', 'modifiers', 'parameter', 'arrowToken', 'block', 'expressionBody'],
  RefExpression: ['refKeyword', 'expression'],
  ParenthesizedLambdaExpression: ['attributeLists', 'modifiers', 'returnType', 'parameterList', 'arrowToken', 'block', 'expressionBody'],
  ObjectInitializerExpression: ['openBraceToken', 'expressions', 'closeBraceToken'],
  CollectionInitializerExpression: ['openBraceToken', 'expressions', 'closeBraceToken'],
  ArrayInitializerExpression: ['openBraceToken', 'expressions', 'closeBraceToken'],
  ComplexElementInitializerExpression: ['openBraceToken', 'expressions', 'closeBraceToken'],
  WithInitializerExpression: ['openBraceToken', 'expressions', 'closeBraceToken'],
  ImplicitObjectCreationExpression: ['newKeyword', 'argumentList', 'initializer'],
  ObjectCreationExpression: ['newKeyword', 'type', 'argumentList', 'initializer'],
  WithExpression: ['expression', 'withKeyword', 'initializer'],
  AnonymousObjectMemberDeclarator: ['nameEquals', 'expression'],
  AnonymousObjectCreationExpression: ['newKeyword', 'openBraceToken', 'initializers', 'closeBraceToken'],
  ArrayCreationExpression: ['newKeyword', 'type', 'initializer'],
  ImplicitArrayCreationExpression: ['newKeyword', 'openBracketToken', 'commas', 'closeBracketToken', 'initializer'],
  StackAllocArrayCreationExpression: ['stackAllocKeyword', 'type', 'initializer'],
  ImplicitStackAllocArrayCreationExpression: ['stackAllocKeyword', 'openBracketToken', 'closeBracketToken', 'initializer'],
  CollectionExpression: ['openBracketToken', 'elements', 'closeBracketToken'],
  ExpressionElement: ['expression'],
  SpreadElement: ['operatorToken', 'expression'],
  WithElement: ['withKeyword', 'argumentList'],
  QueryExpression: ['fromClause', 'body'],
  QueryBody: ['clauses', 'selectOrGroup', 'continuation'],
  FromClause: ['fromKeyword', 'type', 'identifier', 'inKeyword', 'expression'],
  LetClause: ['letKeyword', 'identifier', 'equalsToken', 'expression'],
  JoinClause: ['joinKeyword', 'type', 'identifier', 'inKeyword', 'inExpression', 'onKeyword', 'leftExpression', 'equalsKeyword', 'rightExpression', 'into'],
  JoinIntoClause: ['intoKeyword', 'identifier'],
  WhereClause: ['whereKeyword', 'condition'],
  OrderByClause: ['orderByKeyword', 'orderings'],
  AscendingOrdering: ['expression', 'ascendingOrDescendingKeyword'],
  DescendingOrdering: ['expression', 'ascendingOrDescendingKeyword'],
  SelectClause: ['selectKeyword', 'expression'],
  GroupClause: ['groupKeyword', 'groupExpression', 'byKeyword', 'byExpression'],
  QueryContinuation: ['intoKeyword', 'identifier', 'body'],
  OmittedArraySizeExpression: ['omittedArraySizeExpressionToken'],
  InterpolatedStringExpression: ['stringStartToken', 'contents', 'stringEndToken'],
  InterpolatedStringText: ['textToken'],
  Interpolation: ['openBraceToken', 'expression', 'alignmentClause', 'formatClause', 'closeBraceToken'],
  InterpolationAlignmentClause: ['commaToken', 'value'],
  InterpolationFormatClause: ['colonToken', 'formatStringToken'],
  IsPatternExpression: ['expression', 'isKeyword', 'pattern'],
  ThrowExpression: ['throwKeyword', 'expression'],
  WhenClause: ['whenKeyword', 'condition'],
  SwitchExpression: ['governingExpression', 'switchKeyword', 'openBraceToken', 'arms', 'closeBraceToken'],
  SwitchExpressionArm: ['pattern', 'whenClause', 'equalsGreaterThanToken', 'expression'],
  DiscardPattern: ['underscoreToken'],
  DeclarationPattern: ['type', 'designation'],
  VarPattern: ['varKeyword', 'designation'],
  RecursivePattern: ['type', 'positionalPatternClause', 'propertyPatternClause', 'designation'],
  PositionalPatternClause: ['openParenToken', 'subpatterns', 'closeParenToken'],
  PropertyPatternClause: ['openBraceToken', 'subpatterns', 'closeBraceToken'],
  Subpattern: ['expressionColon', 'pattern'],
  ConstantPattern: ['expression'],
  ParenthesizedPattern: ['openParenToken', 'pattern', 'closeParenToken'],
  RelationalPattern: ['operatorToken', 'expression'],
  TypePattern: ['type'],
  OrPattern: ['left', 'operatorToken', 'right'],
  AndPattern: ['left', 'operatorToken', 'right'],
  NotPattern: ['operatorToken', 'pattern'],
  ListPattern: ['openBracketToken', 'patterns', 'closeBracketToken', 'designation'],
  SlicePattern: ['dotDotToken', 'pattern'],
  SingleVariableDesignation: ['identifier'],
  DiscardDesignation: ['underscoreToken'],
  ParenthesizedVariableDesignation: ['openParenToken', 'variables', 'closeParenToken'],
  Block: ['attributeLists', 'openBraceToken', 'statements', 'closeBraceToken'],
  LocalFunctionStatement: ['attributeLists', 'modifiers', 'returnType', 'identifier', 'typeParameterList', 'parameterList', 'constraintClauses', 'body', 'expressionBody', 'semicolonToken'],
  LocalDeclarationStatement: ['attributeLists', 'awaitKeyword', 'usingKeyword', 'modifiers', 'declaration', 'semicolonToken'],
  VariableDeclaration: ['type', 'variables'],
  VariableDeclarator: ['identifier', 'argumentList', 'initializer'],
  EqualsValueClause: ['equalsToken', 'value'],
  ExpressionStatement: ['attributeLists', 'expression', 'semicolonToken'],
  EmptyStatement: ['attributeLists', 'semicolonToken'],
  LabeledStatement: ['attributeLists', 'identifier', 'colonToken', 'statement'],
  GotoStatement: ['attributeLists', 'gotoKeyword', 'caseOrDefaultKeyword', 'expression', 'semicolonToken'],
  GotoCaseStatement: ['attributeLists', 'gotoKeyword', 'caseOrDefaultKeyword', 'expression', 'semicolonToken'],
  GotoDefaultStatement: ['attributeLists', 'gotoKeyword', 'caseOrDefaultKeyword', 'expression', 'semicolonToken'],
  BreakStatement: ['attributeLists', 'breakKeyword', 'label', 'semicolonToken'],
  ContinueStatement: ['attributeLists', 'continueKeyword', 'label', 'semicolonToken'],
  ReturnStatement: ['attributeLists', 'returnKeyword', 'expression', 'semicolonToken'],
  ThrowStatement: ['attributeLists', 'throwKeyword', 'expression', 'semicolonToken'],
  YieldReturnStatement: ['attributeLists', 'yieldKeyword', 'returnOrBreakKeyword', 'expression', 'semicolonToken'],
  YieldBreakStatement: ['attributeLists', 'yieldKeyword', 'returnOrBreakKeyword', 'expression', 'semicolonToken'],
  WhileStatement: ['attributeLists', 'whileKeyword', 'openParenToken', 'condition', 'closeParenToken', 'statement'],
  DoStatement: ['attributeLists', 'doKeyword', 'statement', 'whileKeyword', 'openParenToken', 'condition', 'closeParenToken', 'semicolonToken'],
  ForStatement: ['attributeLists', 'forKeyword', 'openParenToken', 'declaration', 'initializers', 'firstSemicolonToken', 'condition', 'secondSemicolonToken', 'incrementors', 'closeParenToken', 'statement'],
  ForEachStatement: ['attributeLists', 'awaitKeyword', 'forEachKeyword', 'openParenToken', 'type', 'identifier', 'inKeyword', 'expression', 'closeParenToken', 'statement'],
  ForEachVariableStatement: ['attributeLists', 'awaitKeyword', 'forEachKeyword', 'openParenToken', 'variable', 'inKeyword', 'expression', 'closeParenToken', 'statement'],
  UsingStatement: ['attributeLists', 'awaitKeyword', 'usingKeyword', 'openParenToken', 'declaration', 'expression', 'closeParenToken', 'statement'],
  FixedStatement: ['attributeLists', 'fixedKeyword', 'openParenToken', 'declaration', 'closeParenToken', 'statement'],
  CheckedStatement: ['attributeLists', 'keyword', 'block'],
  UncheckedStatement: ['attributeLists', 'keyword', 'block'],
  UnsafeStatement: ['attributeLists', 'unsafeKeyword', 'block'],
  LockStatement: ['attributeLists', 'lockKeyword', 'openParenToken', 'expression', 'closeParenToken', 'statement'],
  IfStatement: ['attributeLists', 'ifKeyword', 'openParenToken', 'condition', 'closeParenToken', 'statement', 'else'],
  ElseClause: ['elseKeyword', 'statement'],
  SwitchStatement: ['attributeLists', 'switchKeyword', 'openParenToken', 'expression', 'closeParenToken', 'openBraceToken', 'sections', 'closeBraceToken'],
  SwitchSection: ['labels', 'statements'],
  CasePatternSwitchLabel: ['keyword', 'pattern', 'whenClause', 'colonToken'],
  CaseSwitchLabel: ['keyword', 'value', 'colonToken'],
  DefaultSwitchLabel: ['keyword', 'colonToken'],
  TryStatement: ['attributeLists', 'tryKeyword', 'block', 'catches', 'finally'],
  CatchClause: ['catchKeyword', 'declaration', 'filter', 'block'],
  CatchDeclaration: ['openParenToken', 'type', 'identifier', 'closeParenToken'],
  CatchFilterClause: ['whenKeyword', 'openParenToken', 'filterExpression', 'closeParenToken'],
  FinallyClause: ['finallyKeyword', 'block'],
  SingleLineDocumentationCommentTrivia: ['content', 'endOfComment'],
  MultiLineDocumentationCommentTrivia: ['content', 'endOfComment'],
  XmlElement: ['startTag', 'content', 'endTag'],
  XmlElementStartTag: ['lessThanToken', 'name', 'attributes', 'greaterThanToken'],
  XmlElementEndTag: ['lessThanSlashToken', 'name', 'greaterThanToken'],
  XmlEmptyElement: ['lessThanToken', 'name', 'attributes', 'slashGreaterThanToken'],
  XmlName: ['prefix', 'localName'],
  XmlPrefix: ['prefix', 'colonToken'],
  XmlTextAttribute: ['name', 'equalsToken', 'startQuoteToken', 'textTokens', 'endQuoteToken'],
  XmlCrefAttribute: ['name', 'equalsToken', 'startQuoteToken', 'cref', 'endQuoteToken'],
  XmlNameAttribute: ['name', 'equalsToken', 'startQuoteToken', 'identifier', 'endQuoteToken'],
  XmlText: ['textTokens'],
  XmlCDataSection: ['startCDataToken', 'textTokens', 'endCDataToken'],
  XmlProcessingInstruction: ['startProcessingInstructionToken', 'name', 'textTokens', 'endProcessingInstructionToken'],
  XmlComment: ['lessThanExclamationMinusMinusToken', 'textTokens', 'minusMinusGreaterThanToken'],
  TypeCref: ['type'],
  QualifiedCref: ['container', 'dotToken', 'member'],
  NameMemberCref: ['name', 'parameters'],
  IndexerMemberCref: ['thisKeyword', 'parameters'],
  OperatorMemberCref: ['operatorKeyword', 'checkedKeyword', 'operatorToken', 'parameters'],
  ConversionOperatorMemberCref: ['implicitOrExplicitKeyword', 'operatorKeyword', 'checkedKeyword', 'type', 'parameters'],
  CrefParameterList: ['openToken', 'parameters', 'closeToken'],
  CrefBracketedParameterList: ['openToken', 'parameters', 'closeToken'],
  CrefParameter: ['refKindKeyword', 'readOnlyKeyword', 'type'],
  ExtensionBlockDeclaration: ['attributeLists', 'modifiers', 'keyword', 'typeParameterList', 'parameterList', 'constraintClauses', 'openBraceToken', 'members', 'closeBraceToken', 'semicolonToken'],
  UnionDeclaration: ['attributeLists', 'modifiers', 'keyword', 'identifier', 'typeParameterList', 'caseTypes', 'baseList', 'constraintClauses', 'openBraceToken', 'members', 'closeBraceToken', 'semicolonToken'],
  UnionCaseTypeList: ['openParenToken', 'types', 'closeParenToken'],
  UnsafeExpression: ['unsafeKeyword', 'openParenToken', 'expression', 'closeParenToken']
});
/** Slot shapes per node kind, one digit per slot: 0 required child, 1 list, 2 separated list, 3 optional child. */
export const slotTypes = Object.freeze({
  CompilationUnit: '11110',
  ExternAliasDirective: '0000',
  UsingDirective: '3033300',
  NameEquals: '00',
  NamespaceDeclaration: '1100011103',
  FileScopedNamespaceDeclaration: '11000111',
  AttributeList: '0320',
  AttributeTargetSpecifier: '00',
  Attribute: '03',
  AttributeArgumentList: '020',
  AttributeArgument: '330',
  GlobalStatement: '110',
  TypeParameterList: '020',
  TypeParameter: '130',
  ClassDeclaration: '110033313133',
  StructDeclaration: '110033313133',
  InterfaceDeclaration: '110033313133',
  RecordDeclaration: '1103033313133',
  RecordStructDeclaration: '1103033313133',
  EnumDeclaration: '110033233',
  DelegateDeclaration: '110003010',
  EnumMemberDeclaration: '1103',
  BaseList: '02',
  SimpleBaseType: '0',
  PrimaryConstructorBaseType: '00',
  TypeParameterConstraintClause: '0002',
  ConstructorConstraint: '000',
  ClassConstraint: '03',
  StructConstraint: '03',
  TypeConstraint: '0',
  DefaultConstraint: '0',
  AllowsConstraintClause: '02',
  RefStructConstraint: '00',
  FieldDeclaration: '1100',
  EventFieldDeclaration: '11000',
  ExplicitInterfaceSpecifier: '00',
  MethodDeclaration: '11030301333',
  OperatorDeclaration: '11030300333',
  ConversionOperatorDeclaration: '11030300333',
  ConstructorDeclaration: '11003333',
  BaseConstructorInitializer: '000',
  ThisConstructorInitializer: '000',
  DestructorDeclaration: '11000333',
  PropertyDeclaration: '110303333',
  ArrowExpressionClause: '00',
  EventDeclaration: '11003033',
  IndexerDeclaration: '110300333',
  AccessorList: '010',
  GetAccessorDeclaration: '110333',
  SetAccessorDeclaration: '110333',
  InitAccessorDeclaration: '110333',
  AddAccessorDeclaration: '110333',
  RemoveAccessorDeclaration: '110333',
  UnknownAccessorDeclaration: '110333',
  ParameterList: '020',
  BracketedParameterList: '020',
  Parameter: '11333',
  IncompleteMember: '113',
  IdentifierName: '0',
  QualifiedName: '000',
  GenericName: '00',
  TypeArgumentList: '020',
  AliasQualifiedName: '000',
  PredefinedType: '0',
  ArrayType: '01',
  ArrayRankSpecifier: '020',
  PointerType: '00',
  FunctionPointerType: '0030',
  FunctionPointerParameterList: '020',
  FunctionPointerCallingConvention: '03',
  FunctionPointerUnmanagedCallingConventionList: '020',
  FunctionPointerUnmanagedCallingConvention: '0',
  FunctionPointerParameter: '110',
  NullableType: '00',
  TupleType: '020',
  TupleElement: '03',
  OmittedTypeArgument: '0',
  RefType: '030',
  ScopedType: '00',
  ParenthesizedExpression: '000',
  TupleExpression: '020',
  UnaryPlusExpression: '00',
  UnaryMinusExpression: '00',
  BitwiseNotExpression: '00',
  LogicalNotExpression: '00',
  PreIncrementExpression: '00',
  PreDecrementExpression: '00',
  AddressOfExpression: '00',
  PointerIndirectionExpression: '00',
  IndexExpression: '00',
  AwaitExpression: '00',
  PostIncrementExpression: '00',
  PostDecrementExpression: '00',
  SuppressNullableWarningExpression: '00',
  SimpleMemberAccessExpression: '000',
  PointerMemberAccessExpression: '000',
  ConditionalAccessExpression: '000',
  MemberBindingExpression: '00',
  ElementBindingExpression: '0',
  RangeExpression: '303',
  ImplicitElementAccess: '0',
  AddExpression: '000',
  SubtractExpression: '000',
  MultiplyExpression: '000',
  DivideExpression: '000',
  ModuloExpression: '000',
  LeftShiftExpression: '000',
  RightShiftExpression: '000',
  UnsignedRightShiftExpression: '000',
  LogicalOrExpression: '000',
  LogicalAndExpression: '000',
  BitwiseOrExpression: '000',
  BitwiseAndExpression: '000',
  ExclusiveOrExpression: '000',
  EqualsExpression: '000',
  NotEqualsExpression: '000',
  LessThanExpression: '000',
  LessThanOrEqualExpression: '000',
  GreaterThanExpression: '000',
  GreaterThanOrEqualExpression: '000',
  IsExpression: '000',
  AsExpression: '000',
  CoalesceExpression: '000',
  SimpleAssignmentExpression: '000',
  AddAssignmentExpression: '000',
  SubtractAssignmentExpression: '000',
  MultiplyAssignmentExpression: '000',
  DivideAssignmentExpression: '000',
  ModuloAssignmentExpression: '000',
  AndAssignmentExpression: '000',
  ExclusiveOrAssignmentExpression: '000',
  OrAssignmentExpression: '000',
  LeftShiftAssignmentExpression: '000',
  RightShiftAssignmentExpression: '000',
  UnsignedRightShiftAssignmentExpression: '000',
  CoalesceAssignmentExpression: '000',
  ConditionalExpression: '00000',
  ThisExpression: '0',
  BaseExpression: '0',
  NumericLiteralExpression: '0',
  StringLiteralExpression: '0',
  Utf8StringLiteralExpression: '0',
  CharacterLiteralExpression: '0',
  TrueLiteralExpression: '0',
  FalseLiteralExpression: '0',
  NullLiteralExpression: '0',
  DefaultLiteralExpression: '0',
  ArgListExpression: '0',
  FieldExpression: '0',
  MakeRefExpression: '0000',
  RefTypeExpression: '0000',
  RefValueExpression: '000000',
  TypeOfExpression: '0000',
  SizeOfExpression: '0000',
  DefaultExpression: '0000',
  CheckedExpression: '0000',
  UncheckedExpression: '0000',
  InvocationExpression: '00',
  ElementAccessExpression: '00',
  ArgumentList: '020',
  BracketedArgumentList: '020',
  Argument: '330',
  ExpressionColon: '00',
  NameColon: '00',
  DeclarationExpression: '00',
  CastExpression: '0000',
  AnonymousMethodExpression: '10303',
  SimpleLambdaExpression: '110033',
  RefExpression: '00',
  ParenthesizedLambdaExpression: '1130033',
  ObjectInitializerExpression: '020',
  CollectionInitializerExpression: '020',
  ArrayInitializerExpression: '020',
  ComplexElementInitializerExpression: '020',
  WithInitializerExpression: '020',
  ImplicitObjectCreationExpression: '003',
  ObjectCreationExpression: '0033',
  WithExpression: '000',
  AnonymousObjectMemberDeclarator: '30',
  AnonymousObjectCreationExpression: '0020',
  ArrayCreationExpression: '003',
  ImplicitArrayCreationExpression: '00100',
  StackAllocArrayCreationExpression: '003',
  ImplicitStackAllocArrayCreationExpression: '0000',
  CollectionExpression: '020',
  ExpressionElement: '0',
  SpreadElement: '00',
  WithElement: '00',
  QueryExpression: '00',
  QueryBody: '103',
  FromClause: '03000',
  LetClause: '0000',
  JoinClause: '0300000003',
  JoinIntoClause: '00',
  WhereClause: '00',
  OrderByClause: '02',
  AscendingOrdering: '03',
  DescendingOrdering: '03',
  SelectClause: '00',
  GroupClause: '0000',
  QueryContinuation: '000',
  OmittedArraySizeExpression: '0',
  InterpolatedStringExpression: '010',
  InterpolatedStringText: '0',
  Interpolation: '00330',
  InterpolationAlignmentClause: '00',
  InterpolationFormatClause: '00',
  IsPatternExpression: '000',
  ThrowExpression: '00',
  WhenClause: '00',
  SwitchExpression: '00020',
  SwitchExpressionArm: '0300',
  DiscardPattern: '0',
  DeclarationPattern: '00',
  VarPattern: '00',
  RecursivePattern: '3333',
  PositionalPatternClause: '020',
  PropertyPatternClause: '020',
  Subpattern: '30',
  ConstantPattern: '0',
  ParenthesizedPattern: '000',
  RelationalPattern: '00',
  TypePattern: '0',
  OrPattern: '000',
  AndPattern: '000',
  NotPattern: '00',
  ListPattern: '0203',
  SlicePattern: '03',
  SingleVariableDesignation: '0',
  DiscardDesignation: '0',
  ParenthesizedVariableDesignation: '020',
  Block: '1010',
  LocalFunctionStatement: '1100301333',
  LocalDeclarationStatement: '133100',
  VariableDeclaration: '02',
  VariableDeclarator: '033',
  EqualsValueClause: '00',
  ExpressionStatement: '100',
  EmptyStatement: '10',
  LabeledStatement: '1000',
  GotoStatement: '10330',
  GotoCaseStatement: '10330',
  GotoDefaultStatement: '10330',
  BreakStatement: '1030',
  ContinueStatement: '1030',
  ReturnStatement: '1030',
  ThrowStatement: '1030',
  YieldReturnStatement: '10030',
  YieldBreakStatement: '10030',
  WhileStatement: '100000',
  DoStatement: '10000000',
  ForStatement: '10032030200',
  ForEachStatement: '1300000000',
  ForEachVariableStatement: '130000000',
  UsingStatement: '13003300',
  FixedStatement: '100000',
  CheckedStatement: '100',
  UncheckedStatement: '100',
  UnsafeStatement: '100',
  LockStatement: '100000',
  IfStatement: '1000003',
  ElseClause: '00',
  SwitchStatement: '10303010',
  SwitchSection: '11',
  CasePatternSwitchLabel: '0030',
  CaseSwitchLabel: '000',
  DefaultSwitchLabel: '00',
  TryStatement: '10013',
  CatchClause: '0330',
  CatchDeclaration: '0030',
  CatchFilterClause: '0000',
  FinallyClause: '00',
  SingleLineDocumentationCommentTrivia: '10',
  MultiLineDocumentationCommentTrivia: '10',
  XmlElement: '010',
  XmlElementStartTag: '0010',
  XmlElementEndTag: '000',
  XmlEmptyElement: '0010',
  XmlName: '30',
  XmlPrefix: '00',
  XmlTextAttribute: '00010',
  XmlCrefAttribute: '00000',
  XmlNameAttribute: '00000',
  XmlText: '1',
  XmlCDataSection: '010',
  XmlProcessingInstruction: '0010',
  XmlComment: '010',
  TypeCref: '0',
  QualifiedCref: '000',
  NameMemberCref: '03',
  IndexerMemberCref: '03',
  OperatorMemberCref: '0303',
  ConversionOperatorMemberCref: '00303',
  CrefParameterList: '020',
  CrefBracketedParameterList: '020',
  CrefParameter: '330',
  ExtensionBlockDeclaration: '1103013133',
  UnionDeclaration: '110030313133',
  UnionCaseTypeList: '020',
  UnsafeExpression: '0000'
});
const unwrap = value => {
  if (Array.isArray(value)) return value.length ? new GreenNode('SyntaxList', value.map(unwrap)) : null;
  return value && value.green ? value.green : value ?? null;
};
const make = (kind, children) => createNode(new GreenNode(kind, children.map(unwrap)), null, 0);
export class CompilationUnitSyntax extends SyntaxNode {
  get externs() { return this.list(0); }
  withExterns(value) { return this.withSlot(0, value); }
  get usings() { return this.list(1); }
  withUsings(value) { return this.withSlot(1, value); }
  get attributeLists() { return this.list(2); }
  withAttributeLists(value) { return this.withSlot(2, value); }
  get members() { return this.list(3); }
  withMembers(value) { return this.withSlot(3, value); }
  get endOfFileToken() { return this.slot(4); }
  withEndOfFileToken(value) { return this.withSlot(4, value); }
}
registerNodeClass(['CompilationUnit'], CompilationUnitSyntax);
export class ExternAliasDirectiveSyntax extends SyntaxNode {
  get externKeyword() { return this.slot(0); }
  withExternKeyword(value) { return this.withSlot(0, value); }
  get aliasKeyword() { return this.slot(1); }
  withAliasKeyword(value) { return this.withSlot(1, value); }
  get identifier() { return this.slot(2); }
  withIdentifier(value) { return this.withSlot(2, value); }
  get semicolonToken() { return this.slot(3); }
  withSemicolonToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['ExternAliasDirective'], ExternAliasDirectiveSyntax);
export class UsingDirectiveSyntax extends SyntaxNode {
  get globalKeyword() { return this.slot(0); }
  withGlobalKeyword(value) { return this.withSlot(0, value); }
  get usingKeyword() { return this.slot(1); }
  withUsingKeyword(value) { return this.withSlot(1, value); }
  get staticKeyword() { return this.slot(2); }
  withStaticKeyword(value) { return this.withSlot(2, value); }
  get unsafeKeyword() { return this.slot(3); }
  withUnsafeKeyword(value) { return this.withSlot(3, value); }
  get alias() { return this.slot(4); }
  withAlias(value) { return this.withSlot(4, value); }
  get namespaceOrType() { return this.slot(5); }
  withNamespaceOrType(value) { return this.withSlot(5, value); }
  get semicolonToken() { return this.slot(6); }
  withSemicolonToken(value) { return this.withSlot(6, value); }
}
registerNodeClass(['UsingDirective'], UsingDirectiveSyntax);
export class NameEqualsSyntax extends SyntaxNode {
  get name() { return this.slot(0); }
  withName(value) { return this.withSlot(0, value); }
  get equalsToken() { return this.slot(1); }
  withEqualsToken(value) { return this.withSlot(1, value); }
}
registerNodeClass(['NameEquals'], NameEqualsSyntax);
export class NamespaceDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get namespaceKeyword() { return this.slot(2); }
  withNamespaceKeyword(value) { return this.withSlot(2, value); }
  get name() { return this.slot(3); }
  withName(value) { return this.withSlot(3, value); }
  get openBraceToken() { return this.slot(4); }
  withOpenBraceToken(value) { return this.withSlot(4, value); }
  get externs() { return this.list(5); }
  withExterns(value) { return this.withSlot(5, value); }
  get usings() { return this.list(6); }
  withUsings(value) { return this.withSlot(6, value); }
  get members() { return this.list(7); }
  withMembers(value) { return this.withSlot(7, value); }
  get closeBraceToken() { return this.slot(8); }
  withCloseBraceToken(value) { return this.withSlot(8, value); }
  get semicolonToken() { return this.slot(9); }
  withSemicolonToken(value) { return this.withSlot(9, value); }
}
registerNodeClass(['NamespaceDeclaration'], NamespaceDeclarationSyntax);
export class FileScopedNamespaceDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get namespaceKeyword() { return this.slot(2); }
  withNamespaceKeyword(value) { return this.withSlot(2, value); }
  get name() { return this.slot(3); }
  withName(value) { return this.withSlot(3, value); }
  get semicolonToken() { return this.slot(4); }
  withSemicolonToken(value) { return this.withSlot(4, value); }
  get externs() { return this.list(5); }
  withExterns(value) { return this.withSlot(5, value); }
  get usings() { return this.list(6); }
  withUsings(value) { return this.withSlot(6, value); }
  get members() { return this.list(7); }
  withMembers(value) { return this.withSlot(7, value); }
}
registerNodeClass(['FileScopedNamespaceDeclaration'], FileScopedNamespaceDeclarationSyntax);
export class AttributeListSyntax extends SyntaxNode {
  get openBracketToken() { return this.slot(0); }
  withOpenBracketToken(value) { return this.withSlot(0, value); }
  get target() { return this.slot(1); }
  withTarget(value) { return this.withSlot(1, value); }
  get attributes() { return this.list(2, true); }
  withAttributes(value) { return this.withSlot(2, value); }
  get closeBracketToken() { return this.slot(3); }
  withCloseBracketToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['AttributeList'], AttributeListSyntax);
export class AttributeTargetSpecifierSyntax extends SyntaxNode {
  get identifier() { return this.slot(0); }
  withIdentifier(value) { return this.withSlot(0, value); }
  get colonToken() { return this.slot(1); }
  withColonToken(value) { return this.withSlot(1, value); }
}
registerNodeClass(['AttributeTargetSpecifier'], AttributeTargetSpecifierSyntax);
export class AttributeSyntax extends SyntaxNode {
  get name() { return this.slot(0); }
  withName(value) { return this.withSlot(0, value); }
  get argumentList() { return this.slot(1); }
  withArgumentList(value) { return this.withSlot(1, value); }
}
registerNodeClass(['Attribute'], AttributeSyntax);
export class AttributeArgumentListSyntax extends SyntaxNode {
  get openParenToken() { return this.slot(0); }
  withOpenParenToken(value) { return this.withSlot(0, value); }
  get arguments() { return this.list(1, true); }
  withArguments(value) { return this.withSlot(1, value); }
  get closeParenToken() { return this.slot(2); }
  withCloseParenToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['AttributeArgumentList'], AttributeArgumentListSyntax);
export class AttributeArgumentSyntax extends SyntaxNode {
  get nameEquals() { return this.slot(0); }
  withNameEquals(value) { return this.withSlot(0, value); }
  get nameColon() { return this.slot(1); }
  withNameColon(value) { return this.withSlot(1, value); }
  get expression() { return this.slot(2); }
  withExpression(value) { return this.withSlot(2, value); }
}
registerNodeClass(['AttributeArgument'], AttributeArgumentSyntax);
export class GlobalStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get statement() { return this.slot(2); }
  withStatement(value) { return this.withSlot(2, value); }
}
registerNodeClass(['GlobalStatement'], GlobalStatementSyntax);
export class TypeParameterListSyntax extends SyntaxNode {
  get lessThanToken() { return this.slot(0); }
  withLessThanToken(value) { return this.withSlot(0, value); }
  get parameters() { return this.list(1, true); }
  withParameters(value) { return this.withSlot(1, value); }
  get greaterThanToken() { return this.slot(2); }
  withGreaterThanToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['TypeParameterList'], TypeParameterListSyntax);
export class TypeParameterSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get varianceKeyword() { return this.slot(1); }
  withVarianceKeyword(value) { return this.withSlot(1, value); }
  get identifier() { return this.slot(2); }
  withIdentifier(value) { return this.withSlot(2, value); }
}
registerNodeClass(['TypeParameter'], TypeParameterSyntax);
export class TypeDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get keyword() { return this.slot(2); }
  withKeyword(value) { return this.withSlot(2, value); }
  get identifier() { return this.slot(3); }
  withIdentifier(value) { return this.withSlot(3, value); }
  get typeParameterList() { return this.slot(4); }
  withTypeParameterList(value) { return this.withSlot(4, value); }
  get parameterList() { return this.slot(5); }
  withParameterList(value) { return this.withSlot(5, value); }
  get baseList() { return this.slot(6); }
  withBaseList(value) { return this.withSlot(6, value); }
  get constraintClauses() { return this.list(7); }
  withConstraintClauses(value) { return this.withSlot(7, value); }
  get openBraceToken() { return this.slot(8); }
  withOpenBraceToken(value) { return this.withSlot(8, value); }
  get members() { return this.list(9); }
  withMembers(value) { return this.withSlot(9, value); }
  get closeBraceToken() { return this.slot(10); }
  withCloseBraceToken(value) { return this.withSlot(10, value); }
  get semicolonToken() { return this.slot(11); }
  withSemicolonToken(value) { return this.withSlot(11, value); }
}
registerNodeClass(['ClassDeclaration', 'StructDeclaration', 'InterfaceDeclaration'], TypeDeclarationSyntax);
export class RecordDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get keyword() { return this.slot(2); }
  withKeyword(value) { return this.withSlot(2, value); }
  get classOrStructKeyword() { return this.slot(3); }
  withClassOrStructKeyword(value) { return this.withSlot(3, value); }
  get identifier() { return this.slot(4); }
  withIdentifier(value) { return this.withSlot(4, value); }
  get typeParameterList() { return this.slot(5); }
  withTypeParameterList(value) { return this.withSlot(5, value); }
  get parameterList() { return this.slot(6); }
  withParameterList(value) { return this.withSlot(6, value); }
  get baseList() { return this.slot(7); }
  withBaseList(value) { return this.withSlot(7, value); }
  get constraintClauses() { return this.list(8); }
  withConstraintClauses(value) { return this.withSlot(8, value); }
  get openBraceToken() { return this.slot(9); }
  withOpenBraceToken(value) { return this.withSlot(9, value); }
  get members() { return this.list(10); }
  withMembers(value) { return this.withSlot(10, value); }
  get closeBraceToken() { return this.slot(11); }
  withCloseBraceToken(value) { return this.withSlot(11, value); }
  get semicolonToken() { return this.slot(12); }
  withSemicolonToken(value) { return this.withSlot(12, value); }
}
registerNodeClass(['RecordDeclaration', 'RecordStructDeclaration'], RecordDeclarationSyntax);
export class EnumDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get enumKeyword() { return this.slot(2); }
  withEnumKeyword(value) { return this.withSlot(2, value); }
  get identifier() { return this.slot(3); }
  withIdentifier(value) { return this.withSlot(3, value); }
  get baseList() { return this.slot(4); }
  withBaseList(value) { return this.withSlot(4, value); }
  get openBraceToken() { return this.slot(5); }
  withOpenBraceToken(value) { return this.withSlot(5, value); }
  get members() { return this.list(6, true); }
  withMembers(value) { return this.withSlot(6, value); }
  get closeBraceToken() { return this.slot(7); }
  withCloseBraceToken(value) { return this.withSlot(7, value); }
  get semicolonToken() { return this.slot(8); }
  withSemicolonToken(value) { return this.withSlot(8, value); }
}
registerNodeClass(['EnumDeclaration'], EnumDeclarationSyntax);
export class DelegateDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get delegateKeyword() { return this.slot(2); }
  withDelegateKeyword(value) { return this.withSlot(2, value); }
  get returnType() { return this.slot(3); }
  withReturnType(value) { return this.withSlot(3, value); }
  get identifier() { return this.slot(4); }
  withIdentifier(value) { return this.withSlot(4, value); }
  get typeParameterList() { return this.slot(5); }
  withTypeParameterList(value) { return this.withSlot(5, value); }
  get parameterList() { return this.slot(6); }
  withParameterList(value) { return this.withSlot(6, value); }
  get constraintClauses() { return this.list(7); }
  withConstraintClauses(value) { return this.withSlot(7, value); }
  get semicolonToken() { return this.slot(8); }
  withSemicolonToken(value) { return this.withSlot(8, value); }
}
registerNodeClass(['DelegateDeclaration'], DelegateDeclarationSyntax);
export class EnumMemberDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get identifier() { return this.slot(2); }
  withIdentifier(value) { return this.withSlot(2, value); }
  get equalsValue() { return this.slot(3); }
  withEqualsValue(value) { return this.withSlot(3, value); }
}
registerNodeClass(['EnumMemberDeclaration'], EnumMemberDeclarationSyntax);
export class BaseListSyntax extends SyntaxNode {
  get colonToken() { return this.slot(0); }
  withColonToken(value) { return this.withSlot(0, value); }
  get types() { return this.list(1, true); }
  withTypes(value) { return this.withSlot(1, value); }
}
registerNodeClass(['BaseList'], BaseListSyntax);
export class SimpleBaseTypeSyntax extends SyntaxNode {
  get type() { return this.slot(0); }
  withType(value) { return this.withSlot(0, value); }
}
registerNodeClass(['SimpleBaseType'], SimpleBaseTypeSyntax);
export class PrimaryConstructorBaseTypeSyntax extends SyntaxNode {
  get type() { return this.slot(0); }
  withType(value) { return this.withSlot(0, value); }
  get argumentList() { return this.slot(1); }
  withArgumentList(value) { return this.withSlot(1, value); }
}
registerNodeClass(['PrimaryConstructorBaseType'], PrimaryConstructorBaseTypeSyntax);
export class TypeParameterConstraintClauseSyntax extends SyntaxNode {
  get whereKeyword() { return this.slot(0); }
  withWhereKeyword(value) { return this.withSlot(0, value); }
  get name() { return this.slot(1); }
  withName(value) { return this.withSlot(1, value); }
  get colonToken() { return this.slot(2); }
  withColonToken(value) { return this.withSlot(2, value); }
  get constraints() { return this.list(3, true); }
  withConstraints(value) { return this.withSlot(3, value); }
}
registerNodeClass(['TypeParameterConstraintClause'], TypeParameterConstraintClauseSyntax);
export class ConstructorConstraintSyntax extends SyntaxNode {
  get newKeyword() { return this.slot(0); }
  withNewKeyword(value) { return this.withSlot(0, value); }
  get openParenToken() { return this.slot(1); }
  withOpenParenToken(value) { return this.withSlot(1, value); }
  get closeParenToken() { return this.slot(2); }
  withCloseParenToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['ConstructorConstraint'], ConstructorConstraintSyntax);
export class ClassOrStructConstraintSyntax extends SyntaxNode {
  get classOrStructKeyword() { return this.slot(0); }
  withClassOrStructKeyword(value) { return this.withSlot(0, value); }
  get questionToken() { return this.slot(1); }
  withQuestionToken(value) { return this.withSlot(1, value); }
}
registerNodeClass(['ClassConstraint', 'StructConstraint'], ClassOrStructConstraintSyntax);
export class TypeConstraintSyntax extends SyntaxNode {
  get type() { return this.slot(0); }
  withType(value) { return this.withSlot(0, value); }
}
registerNodeClass(['TypeConstraint'], TypeConstraintSyntax);
export class DefaultConstraintSyntax extends SyntaxNode {
  get defaultKeyword() { return this.slot(0); }
  withDefaultKeyword(value) { return this.withSlot(0, value); }
}
registerNodeClass(['DefaultConstraint'], DefaultConstraintSyntax);
export class AllowsConstraintClauseSyntax extends SyntaxNode {
  get allowsKeyword() { return this.slot(0); }
  withAllowsKeyword(value) { return this.withSlot(0, value); }
  get constraints() { return this.list(1, true); }
  withConstraints(value) { return this.withSlot(1, value); }
}
registerNodeClass(['AllowsConstraintClause'], AllowsConstraintClauseSyntax);
export class RefStructConstraintSyntax extends SyntaxNode {
  get refKeyword() { return this.slot(0); }
  withRefKeyword(value) { return this.withSlot(0, value); }
  get structKeyword() { return this.slot(1); }
  withStructKeyword(value) { return this.withSlot(1, value); }
}
registerNodeClass(['RefStructConstraint'], RefStructConstraintSyntax);
export class FieldDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get declaration() { return this.slot(2); }
  withDeclaration(value) { return this.withSlot(2, value); }
  get semicolonToken() { return this.slot(3); }
  withSemicolonToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['FieldDeclaration'], FieldDeclarationSyntax);
export class EventFieldDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get eventKeyword() { return this.slot(2); }
  withEventKeyword(value) { return this.withSlot(2, value); }
  get declaration() { return this.slot(3); }
  withDeclaration(value) { return this.withSlot(3, value); }
  get semicolonToken() { return this.slot(4); }
  withSemicolonToken(value) { return this.withSlot(4, value); }
}
registerNodeClass(['EventFieldDeclaration'], EventFieldDeclarationSyntax);
export class ExplicitInterfaceSpecifierSyntax extends SyntaxNode {
  get name() { return this.slot(0); }
  withName(value) { return this.withSlot(0, value); }
  get dotToken() { return this.slot(1); }
  withDotToken(value) { return this.withSlot(1, value); }
}
registerNodeClass(['ExplicitInterfaceSpecifier'], ExplicitInterfaceSpecifierSyntax);
export class MethodDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get returnType() { return this.slot(2); }
  withReturnType(value) { return this.withSlot(2, value); }
  get explicitInterfaceSpecifier() { return this.slot(3); }
  withExplicitInterfaceSpecifier(value) { return this.withSlot(3, value); }
  get identifier() { return this.slot(4); }
  withIdentifier(value) { return this.withSlot(4, value); }
  get typeParameterList() { return this.slot(5); }
  withTypeParameterList(value) { return this.withSlot(5, value); }
  get parameterList() { return this.slot(6); }
  withParameterList(value) { return this.withSlot(6, value); }
  get constraintClauses() { return this.list(7); }
  withConstraintClauses(value) { return this.withSlot(7, value); }
  get body() { return this.slot(8); }
  withBody(value) { return this.withSlot(8, value); }
  get expressionBody() { return this.slot(9); }
  withExpressionBody(value) { return this.withSlot(9, value); }
  get semicolonToken() { return this.slot(10); }
  withSemicolonToken(value) { return this.withSlot(10, value); }
}
registerNodeClass(['MethodDeclaration'], MethodDeclarationSyntax);
export class OperatorDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get returnType() { return this.slot(2); }
  withReturnType(value) { return this.withSlot(2, value); }
  get explicitInterfaceSpecifier() { return this.slot(3); }
  withExplicitInterfaceSpecifier(value) { return this.withSlot(3, value); }
  get operatorKeyword() { return this.slot(4); }
  withOperatorKeyword(value) { return this.withSlot(4, value); }
  get checkedKeyword() { return this.slot(5); }
  withCheckedKeyword(value) { return this.withSlot(5, value); }
  get operatorToken() { return this.slot(6); }
  withOperatorToken(value) { return this.withSlot(6, value); }
  get parameterList() { return this.slot(7); }
  withParameterList(value) { return this.withSlot(7, value); }
  get body() { return this.slot(8); }
  withBody(value) { return this.withSlot(8, value); }
  get expressionBody() { return this.slot(9); }
  withExpressionBody(value) { return this.withSlot(9, value); }
  get semicolonToken() { return this.slot(10); }
  withSemicolonToken(value) { return this.withSlot(10, value); }
}
registerNodeClass(['OperatorDeclaration'], OperatorDeclarationSyntax);
export class ConversionOperatorDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get implicitOrExplicitKeyword() { return this.slot(2); }
  withImplicitOrExplicitKeyword(value) { return this.withSlot(2, value); }
  get explicitInterfaceSpecifier() { return this.slot(3); }
  withExplicitInterfaceSpecifier(value) { return this.withSlot(3, value); }
  get operatorKeyword() { return this.slot(4); }
  withOperatorKeyword(value) { return this.withSlot(4, value); }
  get checkedKeyword() { return this.slot(5); }
  withCheckedKeyword(value) { return this.withSlot(5, value); }
  get type() { return this.slot(6); }
  withType(value) { return this.withSlot(6, value); }
  get parameterList() { return this.slot(7); }
  withParameterList(value) { return this.withSlot(7, value); }
  get body() { return this.slot(8); }
  withBody(value) { return this.withSlot(8, value); }
  get expressionBody() { return this.slot(9); }
  withExpressionBody(value) { return this.withSlot(9, value); }
  get semicolonToken() { return this.slot(10); }
  withSemicolonToken(value) { return this.withSlot(10, value); }
}
registerNodeClass(['ConversionOperatorDeclaration'], ConversionOperatorDeclarationSyntax);
export class ConstructorDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get identifier() { return this.slot(2); }
  withIdentifier(value) { return this.withSlot(2, value); }
  get parameterList() { return this.slot(3); }
  withParameterList(value) { return this.withSlot(3, value); }
  get initializer() { return this.slot(4); }
  withInitializer(value) { return this.withSlot(4, value); }
  get body() { return this.slot(5); }
  withBody(value) { return this.withSlot(5, value); }
  get expressionBody() { return this.slot(6); }
  withExpressionBody(value) { return this.withSlot(6, value); }
  get semicolonToken() { return this.slot(7); }
  withSemicolonToken(value) { return this.withSlot(7, value); }
}
registerNodeClass(['ConstructorDeclaration'], ConstructorDeclarationSyntax);
export class ConstructorInitializerSyntax extends SyntaxNode {
  get colonToken() { return this.slot(0); }
  withColonToken(value) { return this.withSlot(0, value); }
  get thisOrBaseKeyword() { return this.slot(1); }
  withThisOrBaseKeyword(value) { return this.withSlot(1, value); }
  get argumentList() { return this.slot(2); }
  withArgumentList(value) { return this.withSlot(2, value); }
}
registerNodeClass(['BaseConstructorInitializer', 'ThisConstructorInitializer'], ConstructorInitializerSyntax);
export class DestructorDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get tildeToken() { return this.slot(2); }
  withTildeToken(value) { return this.withSlot(2, value); }
  get identifier() { return this.slot(3); }
  withIdentifier(value) { return this.withSlot(3, value); }
  get parameterList() { return this.slot(4); }
  withParameterList(value) { return this.withSlot(4, value); }
  get body() { return this.slot(5); }
  withBody(value) { return this.withSlot(5, value); }
  get expressionBody() { return this.slot(6); }
  withExpressionBody(value) { return this.withSlot(6, value); }
  get semicolonToken() { return this.slot(7); }
  withSemicolonToken(value) { return this.withSlot(7, value); }
}
registerNodeClass(['DestructorDeclaration'], DestructorDeclarationSyntax);
export class PropertyDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get type() { return this.slot(2); }
  withType(value) { return this.withSlot(2, value); }
  get explicitInterfaceSpecifier() { return this.slot(3); }
  withExplicitInterfaceSpecifier(value) { return this.withSlot(3, value); }
  get identifier() { return this.slot(4); }
  withIdentifier(value) { return this.withSlot(4, value); }
  get accessorList() { return this.slot(5); }
  withAccessorList(value) { return this.withSlot(5, value); }
  get expressionBody() { return this.slot(6); }
  withExpressionBody(value) { return this.withSlot(6, value); }
  get initializer() { return this.slot(7); }
  withInitializer(value) { return this.withSlot(7, value); }
  get semicolonToken() { return this.slot(8); }
  withSemicolonToken(value) { return this.withSlot(8, value); }
}
registerNodeClass(['PropertyDeclaration'], PropertyDeclarationSyntax);
export class ArrowExpressionClauseSyntax extends SyntaxNode {
  get arrowToken() { return this.slot(0); }
  withArrowToken(value) { return this.withSlot(0, value); }
  get expression() { return this.slot(1); }
  withExpression(value) { return this.withSlot(1, value); }
}
registerNodeClass(['ArrowExpressionClause'], ArrowExpressionClauseSyntax);
export class EventDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get eventKeyword() { return this.slot(2); }
  withEventKeyword(value) { return this.withSlot(2, value); }
  get type() { return this.slot(3); }
  withType(value) { return this.withSlot(3, value); }
  get explicitInterfaceSpecifier() { return this.slot(4); }
  withExplicitInterfaceSpecifier(value) { return this.withSlot(4, value); }
  get identifier() { return this.slot(5); }
  withIdentifier(value) { return this.withSlot(5, value); }
  get accessorList() { return this.slot(6); }
  withAccessorList(value) { return this.withSlot(6, value); }
  get semicolonToken() { return this.slot(7); }
  withSemicolonToken(value) { return this.withSlot(7, value); }
}
registerNodeClass(['EventDeclaration'], EventDeclarationSyntax);
export class IndexerDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get type() { return this.slot(2); }
  withType(value) { return this.withSlot(2, value); }
  get explicitInterfaceSpecifier() { return this.slot(3); }
  withExplicitInterfaceSpecifier(value) { return this.withSlot(3, value); }
  get thisKeyword() { return this.slot(4); }
  withThisKeyword(value) { return this.withSlot(4, value); }
  get parameterList() { return this.slot(5); }
  withParameterList(value) { return this.withSlot(5, value); }
  get accessorList() { return this.slot(6); }
  withAccessorList(value) { return this.withSlot(6, value); }
  get expressionBody() { return this.slot(7); }
  withExpressionBody(value) { return this.withSlot(7, value); }
  get semicolonToken() { return this.slot(8); }
  withSemicolonToken(value) { return this.withSlot(8, value); }
}
registerNodeClass(['IndexerDeclaration'], IndexerDeclarationSyntax);
export class AccessorListSyntax extends SyntaxNode {
  get openBraceToken() { return this.slot(0); }
  withOpenBraceToken(value) { return this.withSlot(0, value); }
  get accessors() { return this.list(1); }
  withAccessors(value) { return this.withSlot(1, value); }
  get closeBraceToken() { return this.slot(2); }
  withCloseBraceToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['AccessorList'], AccessorListSyntax);
export class AccessorDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get keyword() { return this.slot(2); }
  withKeyword(value) { return this.withSlot(2, value); }
  get body() { return this.slot(3); }
  withBody(value) { return this.withSlot(3, value); }
  get expressionBody() { return this.slot(4); }
  withExpressionBody(value) { return this.withSlot(4, value); }
  get semicolonToken() { return this.slot(5); }
  withSemicolonToken(value) { return this.withSlot(5, value); }
}
registerNodeClass(['GetAccessorDeclaration', 'SetAccessorDeclaration', 'InitAccessorDeclaration', 'AddAccessorDeclaration', 'RemoveAccessorDeclaration', 'UnknownAccessorDeclaration'], AccessorDeclarationSyntax);
export class ParameterListSyntax extends SyntaxNode {
  get openParenToken() { return this.slot(0); }
  withOpenParenToken(value) { return this.withSlot(0, value); }
  get parameters() { return this.list(1, true); }
  withParameters(value) { return this.withSlot(1, value); }
  get closeParenToken() { return this.slot(2); }
  withCloseParenToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['ParameterList'], ParameterListSyntax);
export class BracketedParameterListSyntax extends SyntaxNode {
  get openBracketToken() { return this.slot(0); }
  withOpenBracketToken(value) { return this.withSlot(0, value); }
  get parameters() { return this.list(1, true); }
  withParameters(value) { return this.withSlot(1, value); }
  get closeBracketToken() { return this.slot(2); }
  withCloseBracketToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['BracketedParameterList'], BracketedParameterListSyntax);
export class ParameterSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get type() { return this.slot(2); }
  withType(value) { return this.withSlot(2, value); }
  get identifier() { return this.slot(3); }
  withIdentifier(value) { return this.withSlot(3, value); }
  get default() { return this.slot(4); }
  withDefault(value) { return this.withSlot(4, value); }
}
registerNodeClass(['Parameter'], ParameterSyntax);
export class IncompleteMemberSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get type() { return this.slot(2); }
  withType(value) { return this.withSlot(2, value); }
}
registerNodeClass(['IncompleteMember'], IncompleteMemberSyntax);
export class IdentifierNameSyntax extends SyntaxNode {
  get identifier() { return this.slot(0); }
  withIdentifier(value) { return this.withSlot(0, value); }
}
registerNodeClass(['IdentifierName'], IdentifierNameSyntax);
export class QualifiedNameSyntax extends SyntaxNode {
  get left() { return this.slot(0); }
  withLeft(value) { return this.withSlot(0, value); }
  get dotToken() { return this.slot(1); }
  withDotToken(value) { return this.withSlot(1, value); }
  get right() { return this.slot(2); }
  withRight(value) { return this.withSlot(2, value); }
}
registerNodeClass(['QualifiedName'], QualifiedNameSyntax);
export class GenericNameSyntax extends SyntaxNode {
  get identifier() { return this.slot(0); }
  withIdentifier(value) { return this.withSlot(0, value); }
  get typeArgumentList() { return this.slot(1); }
  withTypeArgumentList(value) { return this.withSlot(1, value); }
}
registerNodeClass(['GenericName'], GenericNameSyntax);
export class TypeArgumentListSyntax extends SyntaxNode {
  get lessThanToken() { return this.slot(0); }
  withLessThanToken(value) { return this.withSlot(0, value); }
  get arguments() { return this.list(1, true); }
  withArguments(value) { return this.withSlot(1, value); }
  get greaterThanToken() { return this.slot(2); }
  withGreaterThanToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['TypeArgumentList'], TypeArgumentListSyntax);
export class AliasQualifiedNameSyntax extends SyntaxNode {
  get alias() { return this.slot(0); }
  withAlias(value) { return this.withSlot(0, value); }
  get colonColonToken() { return this.slot(1); }
  withColonColonToken(value) { return this.withSlot(1, value); }
  get name() { return this.slot(2); }
  withName(value) { return this.withSlot(2, value); }
}
registerNodeClass(['AliasQualifiedName'], AliasQualifiedNameSyntax);
export class PredefinedTypeSyntax extends SyntaxNode {
  get keyword() { return this.slot(0); }
  withKeyword(value) { return this.withSlot(0, value); }
}
registerNodeClass(['PredefinedType'], PredefinedTypeSyntax);
export class ArrayTypeSyntax extends SyntaxNode {
  get elementType() { return this.slot(0); }
  withElementType(value) { return this.withSlot(0, value); }
  get rankSpecifiers() { return this.list(1); }
  withRankSpecifiers(value) { return this.withSlot(1, value); }
}
registerNodeClass(['ArrayType'], ArrayTypeSyntax);
export class ArrayRankSpecifierSyntax extends SyntaxNode {
  get openBracketToken() { return this.slot(0); }
  withOpenBracketToken(value) { return this.withSlot(0, value); }
  get sizes() { return this.list(1, true); }
  withSizes(value) { return this.withSlot(1, value); }
  get closeBracketToken() { return this.slot(2); }
  withCloseBracketToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['ArrayRankSpecifier'], ArrayRankSpecifierSyntax);
export class PointerTypeSyntax extends SyntaxNode {
  get elementType() { return this.slot(0); }
  withElementType(value) { return this.withSlot(0, value); }
  get asteriskToken() { return this.slot(1); }
  withAsteriskToken(value) { return this.withSlot(1, value); }
}
registerNodeClass(['PointerType'], PointerTypeSyntax);
export class FunctionPointerTypeSyntax extends SyntaxNode {
  get delegateKeyword() { return this.slot(0); }
  withDelegateKeyword(value) { return this.withSlot(0, value); }
  get asteriskToken() { return this.slot(1); }
  withAsteriskToken(value) { return this.withSlot(1, value); }
  get callingConvention() { return this.slot(2); }
  withCallingConvention(value) { return this.withSlot(2, value); }
  get parameterList() { return this.slot(3); }
  withParameterList(value) { return this.withSlot(3, value); }
}
registerNodeClass(['FunctionPointerType'], FunctionPointerTypeSyntax);
export class FunctionPointerParameterListSyntax extends SyntaxNode {
  get lessThanToken() { return this.slot(0); }
  withLessThanToken(value) { return this.withSlot(0, value); }
  get parameters() { return this.list(1, true); }
  withParameters(value) { return this.withSlot(1, value); }
  get greaterThanToken() { return this.slot(2); }
  withGreaterThanToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['FunctionPointerParameterList'], FunctionPointerParameterListSyntax);
export class FunctionPointerCallingConventionSyntax extends SyntaxNode {
  get managedOrUnmanagedKeyword() { return this.slot(0); }
  withManagedOrUnmanagedKeyword(value) { return this.withSlot(0, value); }
  get unmanagedCallingConventionList() { return this.slot(1); }
  withUnmanagedCallingConventionList(value) { return this.withSlot(1, value); }
}
registerNodeClass(['FunctionPointerCallingConvention'], FunctionPointerCallingConventionSyntax);
export class FunctionPointerUnmanagedCallingConventionListSyntax extends SyntaxNode {
  get openBracketToken() { return this.slot(0); }
  withOpenBracketToken(value) { return this.withSlot(0, value); }
  get callingConventions() { return this.list(1, true); }
  withCallingConventions(value) { return this.withSlot(1, value); }
  get closeBracketToken() { return this.slot(2); }
  withCloseBracketToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['FunctionPointerUnmanagedCallingConventionList'], FunctionPointerUnmanagedCallingConventionListSyntax);
export class FunctionPointerUnmanagedCallingConventionSyntax extends SyntaxNode {
  get name() { return this.slot(0); }
  withName(value) { return this.withSlot(0, value); }
}
registerNodeClass(['FunctionPointerUnmanagedCallingConvention'], FunctionPointerUnmanagedCallingConventionSyntax);
export class FunctionPointerParameterSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get type() { return this.slot(2); }
  withType(value) { return this.withSlot(2, value); }
}
registerNodeClass(['FunctionPointerParameter'], FunctionPointerParameterSyntax);
export class NullableTypeSyntax extends SyntaxNode {
  get elementType() { return this.slot(0); }
  withElementType(value) { return this.withSlot(0, value); }
  get questionToken() { return this.slot(1); }
  withQuestionToken(value) { return this.withSlot(1, value); }
}
registerNodeClass(['NullableType'], NullableTypeSyntax);
export class TupleTypeSyntax extends SyntaxNode {
  get openParenToken() { return this.slot(0); }
  withOpenParenToken(value) { return this.withSlot(0, value); }
  get elements() { return this.list(1, true); }
  withElements(value) { return this.withSlot(1, value); }
  get closeParenToken() { return this.slot(2); }
  withCloseParenToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['TupleType'], TupleTypeSyntax);
export class TupleElementSyntax extends SyntaxNode {
  get type() { return this.slot(0); }
  withType(value) { return this.withSlot(0, value); }
  get identifier() { return this.slot(1); }
  withIdentifier(value) { return this.withSlot(1, value); }
}
registerNodeClass(['TupleElement'], TupleElementSyntax);
export class OmittedTypeArgumentSyntax extends SyntaxNode {
  get omittedTypeArgumentToken() { return this.slot(0); }
  withOmittedTypeArgumentToken(value) { return this.withSlot(0, value); }
}
registerNodeClass(['OmittedTypeArgument'], OmittedTypeArgumentSyntax);
export class RefTypeSyntax extends SyntaxNode {
  get refKeyword() { return this.slot(0); }
  withRefKeyword(value) { return this.withSlot(0, value); }
  get readOnlyKeyword() { return this.slot(1); }
  withReadOnlyKeyword(value) { return this.withSlot(1, value); }
  get type() { return this.slot(2); }
  withType(value) { return this.withSlot(2, value); }
}
registerNodeClass(['RefType'], RefTypeSyntax);
export class ScopedTypeSyntax extends SyntaxNode {
  get scopedKeyword() { return this.slot(0); }
  withScopedKeyword(value) { return this.withSlot(0, value); }
  get type() { return this.slot(1); }
  withType(value) { return this.withSlot(1, value); }
}
registerNodeClass(['ScopedType'], ScopedTypeSyntax);
export class ParenthesizedExpressionSyntax extends SyntaxNode {
  get openParenToken() { return this.slot(0); }
  withOpenParenToken(value) { return this.withSlot(0, value); }
  get expression() { return this.slot(1); }
  withExpression(value) { return this.withSlot(1, value); }
  get closeParenToken() { return this.slot(2); }
  withCloseParenToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['ParenthesizedExpression'], ParenthesizedExpressionSyntax);
export class TupleExpressionSyntax extends SyntaxNode {
  get openParenToken() { return this.slot(0); }
  withOpenParenToken(value) { return this.withSlot(0, value); }
  get arguments() { return this.list(1, true); }
  withArguments(value) { return this.withSlot(1, value); }
  get closeParenToken() { return this.slot(2); }
  withCloseParenToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['TupleExpression'], TupleExpressionSyntax);
export class PrefixUnaryExpressionSyntax extends SyntaxNode {
  get operatorToken() { return this.slot(0); }
  withOperatorToken(value) { return this.withSlot(0, value); }
  get operand() { return this.slot(1); }
  withOperand(value) { return this.withSlot(1, value); }
}
registerNodeClass(['UnaryPlusExpression', 'UnaryMinusExpression', 'BitwiseNotExpression', 'LogicalNotExpression', 'PreIncrementExpression', 'PreDecrementExpression', 'AddressOfExpression', 'PointerIndirectionExpression', 'IndexExpression'], PrefixUnaryExpressionSyntax);
export class AwaitExpressionSyntax extends SyntaxNode {
  get awaitKeyword() { return this.slot(0); }
  withAwaitKeyword(value) { return this.withSlot(0, value); }
  get expression() { return this.slot(1); }
  withExpression(value) { return this.withSlot(1, value); }
}
registerNodeClass(['AwaitExpression'], AwaitExpressionSyntax);
export class PostfixUnaryExpressionSyntax extends SyntaxNode {
  get operand() { return this.slot(0); }
  withOperand(value) { return this.withSlot(0, value); }
  get operatorToken() { return this.slot(1); }
  withOperatorToken(value) { return this.withSlot(1, value); }
}
registerNodeClass(['PostIncrementExpression', 'PostDecrementExpression', 'SuppressNullableWarningExpression'], PostfixUnaryExpressionSyntax);
export class MemberAccessExpressionSyntax extends SyntaxNode {
  get expression() { return this.slot(0); }
  withExpression(value) { return this.withSlot(0, value); }
  get operatorToken() { return this.slot(1); }
  withOperatorToken(value) { return this.withSlot(1, value); }
  get name() { return this.slot(2); }
  withName(value) { return this.withSlot(2, value); }
}
registerNodeClass(['SimpleMemberAccessExpression', 'PointerMemberAccessExpression'], MemberAccessExpressionSyntax);
export class ConditionalAccessExpressionSyntax extends SyntaxNode {
  get expression() { return this.slot(0); }
  withExpression(value) { return this.withSlot(0, value); }
  get operatorToken() { return this.slot(1); }
  withOperatorToken(value) { return this.withSlot(1, value); }
  get whenNotNull() { return this.slot(2); }
  withWhenNotNull(value) { return this.withSlot(2, value); }
}
registerNodeClass(['ConditionalAccessExpression'], ConditionalAccessExpressionSyntax);
export class MemberBindingExpressionSyntax extends SyntaxNode {
  get operatorToken() { return this.slot(0); }
  withOperatorToken(value) { return this.withSlot(0, value); }
  get name() { return this.slot(1); }
  withName(value) { return this.withSlot(1, value); }
}
registerNodeClass(['MemberBindingExpression'], MemberBindingExpressionSyntax);
export class ElementBindingExpressionSyntax extends SyntaxNode {
  get argumentList() { return this.slot(0); }
  withArgumentList(value) { return this.withSlot(0, value); }
}
registerNodeClass(['ElementBindingExpression'], ElementBindingExpressionSyntax);
export class RangeExpressionSyntax extends SyntaxNode {
  get leftOperand() { return this.slot(0); }
  withLeftOperand(value) { return this.withSlot(0, value); }
  get operatorToken() { return this.slot(1); }
  withOperatorToken(value) { return this.withSlot(1, value); }
  get rightOperand() { return this.slot(2); }
  withRightOperand(value) { return this.withSlot(2, value); }
}
registerNodeClass(['RangeExpression'], RangeExpressionSyntax);
export class ImplicitElementAccessSyntax extends SyntaxNode {
  get argumentList() { return this.slot(0); }
  withArgumentList(value) { return this.withSlot(0, value); }
}
registerNodeClass(['ImplicitElementAccess'], ImplicitElementAccessSyntax);
export class BinaryExpressionSyntax extends SyntaxNode {
  get left() { return this.slot(0); }
  withLeft(value) { return this.withSlot(0, value); }
  get operatorToken() { return this.slot(1); }
  withOperatorToken(value) { return this.withSlot(1, value); }
  get right() { return this.slot(2); }
  withRight(value) { return this.withSlot(2, value); }
}
registerNodeClass(['AddExpression', 'SubtractExpression', 'MultiplyExpression', 'DivideExpression', 'ModuloExpression', 'LeftShiftExpression', 'RightShiftExpression', 'UnsignedRightShiftExpression', 'LogicalOrExpression', 'LogicalAndExpression', 'BitwiseOrExpression', 'BitwiseAndExpression', 'ExclusiveOrExpression', 'EqualsExpression', 'NotEqualsExpression', 'LessThanExpression', 'LessThanOrEqualExpression', 'GreaterThanExpression', 'GreaterThanOrEqualExpression', 'IsExpression', 'AsExpression', 'CoalesceExpression'], BinaryExpressionSyntax);
export class AssignmentExpressionSyntax extends SyntaxNode {
  get left() { return this.slot(0); }
  withLeft(value) { return this.withSlot(0, value); }
  get operatorToken() { return this.slot(1); }
  withOperatorToken(value) { return this.withSlot(1, value); }
  get right() { return this.slot(2); }
  withRight(value) { return this.withSlot(2, value); }
}
registerNodeClass(['SimpleAssignmentExpression', 'AddAssignmentExpression', 'SubtractAssignmentExpression', 'MultiplyAssignmentExpression', 'DivideAssignmentExpression', 'ModuloAssignmentExpression', 'AndAssignmentExpression', 'ExclusiveOrAssignmentExpression', 'OrAssignmentExpression', 'LeftShiftAssignmentExpression', 'RightShiftAssignmentExpression', 'UnsignedRightShiftAssignmentExpression', 'CoalesceAssignmentExpression'], AssignmentExpressionSyntax);
export class ConditionalExpressionSyntax extends SyntaxNode {
  get condition() { return this.slot(0); }
  withCondition(value) { return this.withSlot(0, value); }
  get questionToken() { return this.slot(1); }
  withQuestionToken(value) { return this.withSlot(1, value); }
  get whenTrue() { return this.slot(2); }
  withWhenTrue(value) { return this.withSlot(2, value); }
  get colonToken() { return this.slot(3); }
  withColonToken(value) { return this.withSlot(3, value); }
  get whenFalse() { return this.slot(4); }
  withWhenFalse(value) { return this.withSlot(4, value); }
}
registerNodeClass(['ConditionalExpression'], ConditionalExpressionSyntax);
export class ThisExpressionSyntax extends SyntaxNode {
  get token() { return this.slot(0); }
  withToken(value) { return this.withSlot(0, value); }
}
registerNodeClass(['ThisExpression'], ThisExpressionSyntax);
export class BaseExpressionSyntax extends SyntaxNode {
  get token() { return this.slot(0); }
  withToken(value) { return this.withSlot(0, value); }
}
registerNodeClass(['BaseExpression'], BaseExpressionSyntax);
export class LiteralExpressionSyntax extends SyntaxNode {
  get token() { return this.slot(0); }
  withToken(value) { return this.withSlot(0, value); }
}
registerNodeClass(['NumericLiteralExpression', 'StringLiteralExpression', 'Utf8StringLiteralExpression', 'CharacterLiteralExpression', 'TrueLiteralExpression', 'FalseLiteralExpression', 'NullLiteralExpression', 'DefaultLiteralExpression', 'ArgListExpression'], LiteralExpressionSyntax);
export class FieldExpressionSyntax extends SyntaxNode {
  get token() { return this.slot(0); }
  withToken(value) { return this.withSlot(0, value); }
}
registerNodeClass(['FieldExpression'], FieldExpressionSyntax);
export class MakeRefExpressionSyntax extends SyntaxNode {
  get keyword() { return this.slot(0); }
  withKeyword(value) { return this.withSlot(0, value); }
  get openParenToken() { return this.slot(1); }
  withOpenParenToken(value) { return this.withSlot(1, value); }
  get expression() { return this.slot(2); }
  withExpression(value) { return this.withSlot(2, value); }
  get closeParenToken() { return this.slot(3); }
  withCloseParenToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['MakeRefExpression'], MakeRefExpressionSyntax);
export class RefTypeExpressionSyntax extends SyntaxNode {
  get keyword() { return this.slot(0); }
  withKeyword(value) { return this.withSlot(0, value); }
  get openParenToken() { return this.slot(1); }
  withOpenParenToken(value) { return this.withSlot(1, value); }
  get expression() { return this.slot(2); }
  withExpression(value) { return this.withSlot(2, value); }
  get closeParenToken() { return this.slot(3); }
  withCloseParenToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['RefTypeExpression'], RefTypeExpressionSyntax);
export class RefValueExpressionSyntax extends SyntaxNode {
  get keyword() { return this.slot(0); }
  withKeyword(value) { return this.withSlot(0, value); }
  get openParenToken() { return this.slot(1); }
  withOpenParenToken(value) { return this.withSlot(1, value); }
  get expression() { return this.slot(2); }
  withExpression(value) { return this.withSlot(2, value); }
  get comma() { return this.slot(3); }
  withComma(value) { return this.withSlot(3, value); }
  get type() { return this.slot(4); }
  withType(value) { return this.withSlot(4, value); }
  get closeParenToken() { return this.slot(5); }
  withCloseParenToken(value) { return this.withSlot(5, value); }
}
registerNodeClass(['RefValueExpression'], RefValueExpressionSyntax);
export class TypeOfExpressionSyntax extends SyntaxNode {
  get keyword() { return this.slot(0); }
  withKeyword(value) { return this.withSlot(0, value); }
  get openParenToken() { return this.slot(1); }
  withOpenParenToken(value) { return this.withSlot(1, value); }
  get type() { return this.slot(2); }
  withType(value) { return this.withSlot(2, value); }
  get closeParenToken() { return this.slot(3); }
  withCloseParenToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['TypeOfExpression'], TypeOfExpressionSyntax);
export class SizeOfExpressionSyntax extends SyntaxNode {
  get keyword() { return this.slot(0); }
  withKeyword(value) { return this.withSlot(0, value); }
  get openParenToken() { return this.slot(1); }
  withOpenParenToken(value) { return this.withSlot(1, value); }
  get type() { return this.slot(2); }
  withType(value) { return this.withSlot(2, value); }
  get closeParenToken() { return this.slot(3); }
  withCloseParenToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['SizeOfExpression'], SizeOfExpressionSyntax);
export class DefaultExpressionSyntax extends SyntaxNode {
  get keyword() { return this.slot(0); }
  withKeyword(value) { return this.withSlot(0, value); }
  get openParenToken() { return this.slot(1); }
  withOpenParenToken(value) { return this.withSlot(1, value); }
  get type() { return this.slot(2); }
  withType(value) { return this.withSlot(2, value); }
  get closeParenToken() { return this.slot(3); }
  withCloseParenToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['DefaultExpression'], DefaultExpressionSyntax);
export class CheckedExpressionSyntax extends SyntaxNode {
  get keyword() { return this.slot(0); }
  withKeyword(value) { return this.withSlot(0, value); }
  get openParenToken() { return this.slot(1); }
  withOpenParenToken(value) { return this.withSlot(1, value); }
  get expression() { return this.slot(2); }
  withExpression(value) { return this.withSlot(2, value); }
  get closeParenToken() { return this.slot(3); }
  withCloseParenToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['CheckedExpression', 'UncheckedExpression'], CheckedExpressionSyntax);
export class InvocationExpressionSyntax extends SyntaxNode {
  get expression() { return this.slot(0); }
  withExpression(value) { return this.withSlot(0, value); }
  get argumentList() { return this.slot(1); }
  withArgumentList(value) { return this.withSlot(1, value); }
}
registerNodeClass(['InvocationExpression'], InvocationExpressionSyntax);
export class ElementAccessExpressionSyntax extends SyntaxNode {
  get expression() { return this.slot(0); }
  withExpression(value) { return this.withSlot(0, value); }
  get argumentList() { return this.slot(1); }
  withArgumentList(value) { return this.withSlot(1, value); }
}
registerNodeClass(['ElementAccessExpression'], ElementAccessExpressionSyntax);
export class ArgumentListSyntax extends SyntaxNode {
  get openParenToken() { return this.slot(0); }
  withOpenParenToken(value) { return this.withSlot(0, value); }
  get arguments() { return this.list(1, true); }
  withArguments(value) { return this.withSlot(1, value); }
  get closeParenToken() { return this.slot(2); }
  withCloseParenToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['ArgumentList'], ArgumentListSyntax);
export class BracketedArgumentListSyntax extends SyntaxNode {
  get openBracketToken() { return this.slot(0); }
  withOpenBracketToken(value) { return this.withSlot(0, value); }
  get arguments() { return this.list(1, true); }
  withArguments(value) { return this.withSlot(1, value); }
  get closeBracketToken() { return this.slot(2); }
  withCloseBracketToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['BracketedArgumentList'], BracketedArgumentListSyntax);
export class ArgumentSyntax extends SyntaxNode {
  get nameColon() { return this.slot(0); }
  withNameColon(value) { return this.withSlot(0, value); }
  get refKindKeyword() { return this.slot(1); }
  withRefKindKeyword(value) { return this.withSlot(1, value); }
  get expression() { return this.slot(2); }
  withExpression(value) { return this.withSlot(2, value); }
}
registerNodeClass(['Argument'], ArgumentSyntax);
export class ExpressionColonSyntax extends SyntaxNode {
  get expression() { return this.slot(0); }
  withExpression(value) { return this.withSlot(0, value); }
  get colonToken() { return this.slot(1); }
  withColonToken(value) { return this.withSlot(1, value); }
}
registerNodeClass(['ExpressionColon'], ExpressionColonSyntax);
export class NameColonSyntax extends SyntaxNode {
  get name() { return this.slot(0); }
  withName(value) { return this.withSlot(0, value); }
  get colonToken() { return this.slot(1); }
  withColonToken(value) { return this.withSlot(1, value); }
}
registerNodeClass(['NameColon'], NameColonSyntax);
export class DeclarationExpressionSyntax extends SyntaxNode {
  get type() { return this.slot(0); }
  withType(value) { return this.withSlot(0, value); }
  get designation() { return this.slot(1); }
  withDesignation(value) { return this.withSlot(1, value); }
}
registerNodeClass(['DeclarationExpression'], DeclarationExpressionSyntax);
export class CastExpressionSyntax extends SyntaxNode {
  get openParenToken() { return this.slot(0); }
  withOpenParenToken(value) { return this.withSlot(0, value); }
  get type() { return this.slot(1); }
  withType(value) { return this.withSlot(1, value); }
  get closeParenToken() { return this.slot(2); }
  withCloseParenToken(value) { return this.withSlot(2, value); }
  get expression() { return this.slot(3); }
  withExpression(value) { return this.withSlot(3, value); }
}
registerNodeClass(['CastExpression'], CastExpressionSyntax);
export class AnonymousMethodExpressionSyntax extends SyntaxNode {
  get modifiers() { return this.list(0); }
  withModifiers(value) { return this.withSlot(0, value); }
  get delegateKeyword() { return this.slot(1); }
  withDelegateKeyword(value) { return this.withSlot(1, value); }
  get parameterList() { return this.slot(2); }
  withParameterList(value) { return this.withSlot(2, value); }
  get block() { return this.slot(3); }
  withBlock(value) { return this.withSlot(3, value); }
  get expressionBody() { return this.slot(4); }
  withExpressionBody(value) { return this.withSlot(4, value); }
}
registerNodeClass(['AnonymousMethodExpression'], AnonymousMethodExpressionSyntax);
export class SimpleLambdaExpressionSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get parameter() { return this.slot(2); }
  withParameter(value) { return this.withSlot(2, value); }
  get arrowToken() { return this.slot(3); }
  withArrowToken(value) { return this.withSlot(3, value); }
  get block() { return this.slot(4); }
  withBlock(value) { return this.withSlot(4, value); }
  get expressionBody() { return this.slot(5); }
  withExpressionBody(value) { return this.withSlot(5, value); }
}
registerNodeClass(['SimpleLambdaExpression'], SimpleLambdaExpressionSyntax);
export class RefExpressionSyntax extends SyntaxNode {
  get refKeyword() { return this.slot(0); }
  withRefKeyword(value) { return this.withSlot(0, value); }
  get expression() { return this.slot(1); }
  withExpression(value) { return this.withSlot(1, value); }
}
registerNodeClass(['RefExpression'], RefExpressionSyntax);
export class ParenthesizedLambdaExpressionSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get returnType() { return this.slot(2); }
  withReturnType(value) { return this.withSlot(2, value); }
  get parameterList() { return this.slot(3); }
  withParameterList(value) { return this.withSlot(3, value); }
  get arrowToken() { return this.slot(4); }
  withArrowToken(value) { return this.withSlot(4, value); }
  get block() { return this.slot(5); }
  withBlock(value) { return this.withSlot(5, value); }
  get expressionBody() { return this.slot(6); }
  withExpressionBody(value) { return this.withSlot(6, value); }
}
registerNodeClass(['ParenthesizedLambdaExpression'], ParenthesizedLambdaExpressionSyntax);
export class InitializerExpressionSyntax extends SyntaxNode {
  get openBraceToken() { return this.slot(0); }
  withOpenBraceToken(value) { return this.withSlot(0, value); }
  get expressions() { return this.list(1, true); }
  withExpressions(value) { return this.withSlot(1, value); }
  get closeBraceToken() { return this.slot(2); }
  withCloseBraceToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['ObjectInitializerExpression', 'CollectionInitializerExpression', 'ArrayInitializerExpression', 'ComplexElementInitializerExpression', 'WithInitializerExpression'], InitializerExpressionSyntax);
export class ImplicitObjectCreationExpressionSyntax extends SyntaxNode {
  get newKeyword() { return this.slot(0); }
  withNewKeyword(value) { return this.withSlot(0, value); }
  get argumentList() { return this.slot(1); }
  withArgumentList(value) { return this.withSlot(1, value); }
  get initializer() { return this.slot(2); }
  withInitializer(value) { return this.withSlot(2, value); }
}
registerNodeClass(['ImplicitObjectCreationExpression'], ImplicitObjectCreationExpressionSyntax);
export class ObjectCreationExpressionSyntax extends SyntaxNode {
  get newKeyword() { return this.slot(0); }
  withNewKeyword(value) { return this.withSlot(0, value); }
  get type() { return this.slot(1); }
  withType(value) { return this.withSlot(1, value); }
  get argumentList() { return this.slot(2); }
  withArgumentList(value) { return this.withSlot(2, value); }
  get initializer() { return this.slot(3); }
  withInitializer(value) { return this.withSlot(3, value); }
}
registerNodeClass(['ObjectCreationExpression'], ObjectCreationExpressionSyntax);
export class WithExpressionSyntax extends SyntaxNode {
  get expression() { return this.slot(0); }
  withExpression(value) { return this.withSlot(0, value); }
  get withKeyword() { return this.slot(1); }
  withWithKeyword(value) { return this.withSlot(1, value); }
  get initializer() { return this.slot(2); }
  withInitializer(value) { return this.withSlot(2, value); }
}
registerNodeClass(['WithExpression'], WithExpressionSyntax);
export class AnonymousObjectMemberDeclaratorSyntax extends SyntaxNode {
  get nameEquals() { return this.slot(0); }
  withNameEquals(value) { return this.withSlot(0, value); }
  get expression() { return this.slot(1); }
  withExpression(value) { return this.withSlot(1, value); }
}
registerNodeClass(['AnonymousObjectMemberDeclarator'], AnonymousObjectMemberDeclaratorSyntax);
export class AnonymousObjectCreationExpressionSyntax extends SyntaxNode {
  get newKeyword() { return this.slot(0); }
  withNewKeyword(value) { return this.withSlot(0, value); }
  get openBraceToken() { return this.slot(1); }
  withOpenBraceToken(value) { return this.withSlot(1, value); }
  get initializers() { return this.list(2, true); }
  withInitializers(value) { return this.withSlot(2, value); }
  get closeBraceToken() { return this.slot(3); }
  withCloseBraceToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['AnonymousObjectCreationExpression'], AnonymousObjectCreationExpressionSyntax);
export class ArrayCreationExpressionSyntax extends SyntaxNode {
  get newKeyword() { return this.slot(0); }
  withNewKeyword(value) { return this.withSlot(0, value); }
  get type() { return this.slot(1); }
  withType(value) { return this.withSlot(1, value); }
  get initializer() { return this.slot(2); }
  withInitializer(value) { return this.withSlot(2, value); }
}
registerNodeClass(['ArrayCreationExpression'], ArrayCreationExpressionSyntax);
export class ImplicitArrayCreationExpressionSyntax extends SyntaxNode {
  get newKeyword() { return this.slot(0); }
  withNewKeyword(value) { return this.withSlot(0, value); }
  get openBracketToken() { return this.slot(1); }
  withOpenBracketToken(value) { return this.withSlot(1, value); }
  get commas() { return this.list(2); }
  withCommas(value) { return this.withSlot(2, value); }
  get closeBracketToken() { return this.slot(3); }
  withCloseBracketToken(value) { return this.withSlot(3, value); }
  get initializer() { return this.slot(4); }
  withInitializer(value) { return this.withSlot(4, value); }
}
registerNodeClass(['ImplicitArrayCreationExpression'], ImplicitArrayCreationExpressionSyntax);
export class StackAllocArrayCreationExpressionSyntax extends SyntaxNode {
  get stackAllocKeyword() { return this.slot(0); }
  withStackAllocKeyword(value) { return this.withSlot(0, value); }
  get type() { return this.slot(1); }
  withType(value) { return this.withSlot(1, value); }
  get initializer() { return this.slot(2); }
  withInitializer(value) { return this.withSlot(2, value); }
}
registerNodeClass(['StackAllocArrayCreationExpression'], StackAllocArrayCreationExpressionSyntax);
export class ImplicitStackAllocArrayCreationExpressionSyntax extends SyntaxNode {
  get stackAllocKeyword() { return this.slot(0); }
  withStackAllocKeyword(value) { return this.withSlot(0, value); }
  get openBracketToken() { return this.slot(1); }
  withOpenBracketToken(value) { return this.withSlot(1, value); }
  get closeBracketToken() { return this.slot(2); }
  withCloseBracketToken(value) { return this.withSlot(2, value); }
  get initializer() { return this.slot(3); }
  withInitializer(value) { return this.withSlot(3, value); }
}
registerNodeClass(['ImplicitStackAllocArrayCreationExpression'], ImplicitStackAllocArrayCreationExpressionSyntax);
export class CollectionExpressionSyntax extends SyntaxNode {
  get openBracketToken() { return this.slot(0); }
  withOpenBracketToken(value) { return this.withSlot(0, value); }
  get elements() { return this.list(1, true); }
  withElements(value) { return this.withSlot(1, value); }
  get closeBracketToken() { return this.slot(2); }
  withCloseBracketToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['CollectionExpression'], CollectionExpressionSyntax);
export class ExpressionElementSyntax extends SyntaxNode {
  get expression() { return this.slot(0); }
  withExpression(value) { return this.withSlot(0, value); }
}
registerNodeClass(['ExpressionElement'], ExpressionElementSyntax);
export class SpreadElementSyntax extends SyntaxNode {
  get operatorToken() { return this.slot(0); }
  withOperatorToken(value) { return this.withSlot(0, value); }
  get expression() { return this.slot(1); }
  withExpression(value) { return this.withSlot(1, value); }
}
registerNodeClass(['SpreadElement'], SpreadElementSyntax);
export class WithElementSyntax extends SyntaxNode {
  get withKeyword() { return this.slot(0); }
  withWithKeyword(value) { return this.withSlot(0, value); }
  get argumentList() { return this.slot(1); }
  withArgumentList(value) { return this.withSlot(1, value); }
}
registerNodeClass(['WithElement'], WithElementSyntax);
export class QueryExpressionSyntax extends SyntaxNode {
  get fromClause() { return this.slot(0); }
  withFromClause(value) { return this.withSlot(0, value); }
  get body() { return this.slot(1); }
  withBody(value) { return this.withSlot(1, value); }
}
registerNodeClass(['QueryExpression'], QueryExpressionSyntax);
export class QueryBodySyntax extends SyntaxNode {
  get clauses() { return this.list(0); }
  withClauses(value) { return this.withSlot(0, value); }
  get selectOrGroup() { return this.slot(1); }
  withSelectOrGroup(value) { return this.withSlot(1, value); }
  get continuation() { return this.slot(2); }
  withContinuation(value) { return this.withSlot(2, value); }
}
registerNodeClass(['QueryBody'], QueryBodySyntax);
export class FromClauseSyntax extends SyntaxNode {
  get fromKeyword() { return this.slot(0); }
  withFromKeyword(value) { return this.withSlot(0, value); }
  get type() { return this.slot(1); }
  withType(value) { return this.withSlot(1, value); }
  get identifier() { return this.slot(2); }
  withIdentifier(value) { return this.withSlot(2, value); }
  get inKeyword() { return this.slot(3); }
  withInKeyword(value) { return this.withSlot(3, value); }
  get expression() { return this.slot(4); }
  withExpression(value) { return this.withSlot(4, value); }
}
registerNodeClass(['FromClause'], FromClauseSyntax);
export class LetClauseSyntax extends SyntaxNode {
  get letKeyword() { return this.slot(0); }
  withLetKeyword(value) { return this.withSlot(0, value); }
  get identifier() { return this.slot(1); }
  withIdentifier(value) { return this.withSlot(1, value); }
  get equalsToken() { return this.slot(2); }
  withEqualsToken(value) { return this.withSlot(2, value); }
  get expression() { return this.slot(3); }
  withExpression(value) { return this.withSlot(3, value); }
}
registerNodeClass(['LetClause'], LetClauseSyntax);
export class JoinClauseSyntax extends SyntaxNode {
  get joinKeyword() { return this.slot(0); }
  withJoinKeyword(value) { return this.withSlot(0, value); }
  get type() { return this.slot(1); }
  withType(value) { return this.withSlot(1, value); }
  get identifier() { return this.slot(2); }
  withIdentifier(value) { return this.withSlot(2, value); }
  get inKeyword() { return this.slot(3); }
  withInKeyword(value) { return this.withSlot(3, value); }
  get inExpression() { return this.slot(4); }
  withInExpression(value) { return this.withSlot(4, value); }
  get onKeyword() { return this.slot(5); }
  withOnKeyword(value) { return this.withSlot(5, value); }
  get leftExpression() { return this.slot(6); }
  withLeftExpression(value) { return this.withSlot(6, value); }
  get equalsKeyword() { return this.slot(7); }
  withEqualsKeyword(value) { return this.withSlot(7, value); }
  get rightExpression() { return this.slot(8); }
  withRightExpression(value) { return this.withSlot(8, value); }
  get into() { return this.slot(9); }
  withInto(value) { return this.withSlot(9, value); }
}
registerNodeClass(['JoinClause'], JoinClauseSyntax);
export class JoinIntoClauseSyntax extends SyntaxNode {
  get intoKeyword() { return this.slot(0); }
  withIntoKeyword(value) { return this.withSlot(0, value); }
  get identifier() { return this.slot(1); }
  withIdentifier(value) { return this.withSlot(1, value); }
}
registerNodeClass(['JoinIntoClause'], JoinIntoClauseSyntax);
export class WhereClauseSyntax extends SyntaxNode {
  get whereKeyword() { return this.slot(0); }
  withWhereKeyword(value) { return this.withSlot(0, value); }
  get condition() { return this.slot(1); }
  withCondition(value) { return this.withSlot(1, value); }
}
registerNodeClass(['WhereClause'], WhereClauseSyntax);
export class OrderByClauseSyntax extends SyntaxNode {
  get orderByKeyword() { return this.slot(0); }
  withOrderByKeyword(value) { return this.withSlot(0, value); }
  get orderings() { return this.list(1, true); }
  withOrderings(value) { return this.withSlot(1, value); }
}
registerNodeClass(['OrderByClause'], OrderByClauseSyntax);
export class OrderingSyntax extends SyntaxNode {
  get expression() { return this.slot(0); }
  withExpression(value) { return this.withSlot(0, value); }
  get ascendingOrDescendingKeyword() { return this.slot(1); }
  withAscendingOrDescendingKeyword(value) { return this.withSlot(1, value); }
}
registerNodeClass(['AscendingOrdering', 'DescendingOrdering'], OrderingSyntax);
export class SelectClauseSyntax extends SyntaxNode {
  get selectKeyword() { return this.slot(0); }
  withSelectKeyword(value) { return this.withSlot(0, value); }
  get expression() { return this.slot(1); }
  withExpression(value) { return this.withSlot(1, value); }
}
registerNodeClass(['SelectClause'], SelectClauseSyntax);
export class GroupClauseSyntax extends SyntaxNode {
  get groupKeyword() { return this.slot(0); }
  withGroupKeyword(value) { return this.withSlot(0, value); }
  get groupExpression() { return this.slot(1); }
  withGroupExpression(value) { return this.withSlot(1, value); }
  get byKeyword() { return this.slot(2); }
  withByKeyword(value) { return this.withSlot(2, value); }
  get byExpression() { return this.slot(3); }
  withByExpression(value) { return this.withSlot(3, value); }
}
registerNodeClass(['GroupClause'], GroupClauseSyntax);
export class QueryContinuationSyntax extends SyntaxNode {
  get intoKeyword() { return this.slot(0); }
  withIntoKeyword(value) { return this.withSlot(0, value); }
  get identifier() { return this.slot(1); }
  withIdentifier(value) { return this.withSlot(1, value); }
  get body() { return this.slot(2); }
  withBody(value) { return this.withSlot(2, value); }
}
registerNodeClass(['QueryContinuation'], QueryContinuationSyntax);
export class OmittedArraySizeExpressionSyntax extends SyntaxNode {
  get omittedArraySizeExpressionToken() { return this.slot(0); }
  withOmittedArraySizeExpressionToken(value) { return this.withSlot(0, value); }
}
registerNodeClass(['OmittedArraySizeExpression'], OmittedArraySizeExpressionSyntax);
export class InterpolatedStringExpressionSyntax extends SyntaxNode {
  get stringStartToken() { return this.slot(0); }
  withStringStartToken(value) { return this.withSlot(0, value); }
  get contents() { return this.list(1); }
  withContents(value) { return this.withSlot(1, value); }
  get stringEndToken() { return this.slot(2); }
  withStringEndToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['InterpolatedStringExpression'], InterpolatedStringExpressionSyntax);
export class InterpolatedStringTextSyntax extends SyntaxNode {
  get textToken() { return this.slot(0); }
  withTextToken(value) { return this.withSlot(0, value); }
}
registerNodeClass(['InterpolatedStringText'], InterpolatedStringTextSyntax);
export class InterpolationSyntax extends SyntaxNode {
  get openBraceToken() { return this.slot(0); }
  withOpenBraceToken(value) { return this.withSlot(0, value); }
  get expression() { return this.slot(1); }
  withExpression(value) { return this.withSlot(1, value); }
  get alignmentClause() { return this.slot(2); }
  withAlignmentClause(value) { return this.withSlot(2, value); }
  get formatClause() { return this.slot(3); }
  withFormatClause(value) { return this.withSlot(3, value); }
  get closeBraceToken() { return this.slot(4); }
  withCloseBraceToken(value) { return this.withSlot(4, value); }
}
registerNodeClass(['Interpolation'], InterpolationSyntax);
export class InterpolationAlignmentClauseSyntax extends SyntaxNode {
  get commaToken() { return this.slot(0); }
  withCommaToken(value) { return this.withSlot(0, value); }
  get value() { return this.slot(1); }
  withValue(value) { return this.withSlot(1, value); }
}
registerNodeClass(['InterpolationAlignmentClause'], InterpolationAlignmentClauseSyntax);
export class InterpolationFormatClauseSyntax extends SyntaxNode {
  get colonToken() { return this.slot(0); }
  withColonToken(value) { return this.withSlot(0, value); }
  get formatStringToken() { return this.slot(1); }
  withFormatStringToken(value) { return this.withSlot(1, value); }
}
registerNodeClass(['InterpolationFormatClause'], InterpolationFormatClauseSyntax);
export class IsPatternExpressionSyntax extends SyntaxNode {
  get expression() { return this.slot(0); }
  withExpression(value) { return this.withSlot(0, value); }
  get isKeyword() { return this.slot(1); }
  withIsKeyword(value) { return this.withSlot(1, value); }
  get pattern() { return this.slot(2); }
  withPattern(value) { return this.withSlot(2, value); }
}
registerNodeClass(['IsPatternExpression'], IsPatternExpressionSyntax);
export class ThrowExpressionSyntax extends SyntaxNode {
  get throwKeyword() { return this.slot(0); }
  withThrowKeyword(value) { return this.withSlot(0, value); }
  get expression() { return this.slot(1); }
  withExpression(value) { return this.withSlot(1, value); }
}
registerNodeClass(['ThrowExpression'], ThrowExpressionSyntax);
export class WhenClauseSyntax extends SyntaxNode {
  get whenKeyword() { return this.slot(0); }
  withWhenKeyword(value) { return this.withSlot(0, value); }
  get condition() { return this.slot(1); }
  withCondition(value) { return this.withSlot(1, value); }
}
registerNodeClass(['WhenClause'], WhenClauseSyntax);
export class SwitchExpressionSyntax extends SyntaxNode {
  get governingExpression() { return this.slot(0); }
  withGoverningExpression(value) { return this.withSlot(0, value); }
  get switchKeyword() { return this.slot(1); }
  withSwitchKeyword(value) { return this.withSlot(1, value); }
  get openBraceToken() { return this.slot(2); }
  withOpenBraceToken(value) { return this.withSlot(2, value); }
  get arms() { return this.list(3, true); }
  withArms(value) { return this.withSlot(3, value); }
  get closeBraceToken() { return this.slot(4); }
  withCloseBraceToken(value) { return this.withSlot(4, value); }
}
registerNodeClass(['SwitchExpression'], SwitchExpressionSyntax);
export class SwitchExpressionArmSyntax extends SyntaxNode {
  get pattern() { return this.slot(0); }
  withPattern(value) { return this.withSlot(0, value); }
  get whenClause() { return this.slot(1); }
  withWhenClause(value) { return this.withSlot(1, value); }
  get equalsGreaterThanToken() { return this.slot(2); }
  withEqualsGreaterThanToken(value) { return this.withSlot(2, value); }
  get expression() { return this.slot(3); }
  withExpression(value) { return this.withSlot(3, value); }
}
registerNodeClass(['SwitchExpressionArm'], SwitchExpressionArmSyntax);
export class DiscardPatternSyntax extends SyntaxNode {
  get underscoreToken() { return this.slot(0); }
  withUnderscoreToken(value) { return this.withSlot(0, value); }
}
registerNodeClass(['DiscardPattern'], DiscardPatternSyntax);
export class DeclarationPatternSyntax extends SyntaxNode {
  get type() { return this.slot(0); }
  withType(value) { return this.withSlot(0, value); }
  get designation() { return this.slot(1); }
  withDesignation(value) { return this.withSlot(1, value); }
}
registerNodeClass(['DeclarationPattern'], DeclarationPatternSyntax);
export class VarPatternSyntax extends SyntaxNode {
  get varKeyword() { return this.slot(0); }
  withVarKeyword(value) { return this.withSlot(0, value); }
  get designation() { return this.slot(1); }
  withDesignation(value) { return this.withSlot(1, value); }
}
registerNodeClass(['VarPattern'], VarPatternSyntax);
export class RecursivePatternSyntax extends SyntaxNode {
  get type() { return this.slot(0); }
  withType(value) { return this.withSlot(0, value); }
  get positionalPatternClause() { return this.slot(1); }
  withPositionalPatternClause(value) { return this.withSlot(1, value); }
  get propertyPatternClause() { return this.slot(2); }
  withPropertyPatternClause(value) { return this.withSlot(2, value); }
  get designation() { return this.slot(3); }
  withDesignation(value) { return this.withSlot(3, value); }
}
registerNodeClass(['RecursivePattern'], RecursivePatternSyntax);
export class PositionalPatternClauseSyntax extends SyntaxNode {
  get openParenToken() { return this.slot(0); }
  withOpenParenToken(value) { return this.withSlot(0, value); }
  get subpatterns() { return this.list(1, true); }
  withSubpatterns(value) { return this.withSlot(1, value); }
  get closeParenToken() { return this.slot(2); }
  withCloseParenToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['PositionalPatternClause'], PositionalPatternClauseSyntax);
export class PropertyPatternClauseSyntax extends SyntaxNode {
  get openBraceToken() { return this.slot(0); }
  withOpenBraceToken(value) { return this.withSlot(0, value); }
  get subpatterns() { return this.list(1, true); }
  withSubpatterns(value) { return this.withSlot(1, value); }
  get closeBraceToken() { return this.slot(2); }
  withCloseBraceToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['PropertyPatternClause'], PropertyPatternClauseSyntax);
export class SubpatternSyntax extends SyntaxNode {
  get expressionColon() { return this.slot(0); }
  withExpressionColon(value) { return this.withSlot(0, value); }
  get pattern() { return this.slot(1); }
  withPattern(value) { return this.withSlot(1, value); }
}
registerNodeClass(['Subpattern'], SubpatternSyntax);
export class ConstantPatternSyntax extends SyntaxNode {
  get expression() { return this.slot(0); }
  withExpression(value) { return this.withSlot(0, value); }
}
registerNodeClass(['ConstantPattern'], ConstantPatternSyntax);
export class ParenthesizedPatternSyntax extends SyntaxNode {
  get openParenToken() { return this.slot(0); }
  withOpenParenToken(value) { return this.withSlot(0, value); }
  get pattern() { return this.slot(1); }
  withPattern(value) { return this.withSlot(1, value); }
  get closeParenToken() { return this.slot(2); }
  withCloseParenToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['ParenthesizedPattern'], ParenthesizedPatternSyntax);
export class RelationalPatternSyntax extends SyntaxNode {
  get operatorToken() { return this.slot(0); }
  withOperatorToken(value) { return this.withSlot(0, value); }
  get expression() { return this.slot(1); }
  withExpression(value) { return this.withSlot(1, value); }
}
registerNodeClass(['RelationalPattern'], RelationalPatternSyntax);
export class TypePatternSyntax extends SyntaxNode {
  get type() { return this.slot(0); }
  withType(value) { return this.withSlot(0, value); }
}
registerNodeClass(['TypePattern'], TypePatternSyntax);
export class BinaryPatternSyntax extends SyntaxNode {
  get left() { return this.slot(0); }
  withLeft(value) { return this.withSlot(0, value); }
  get operatorToken() { return this.slot(1); }
  withOperatorToken(value) { return this.withSlot(1, value); }
  get right() { return this.slot(2); }
  withRight(value) { return this.withSlot(2, value); }
}
registerNodeClass(['OrPattern', 'AndPattern'], BinaryPatternSyntax);
export class UnaryPatternSyntax extends SyntaxNode {
  get operatorToken() { return this.slot(0); }
  withOperatorToken(value) { return this.withSlot(0, value); }
  get pattern() { return this.slot(1); }
  withPattern(value) { return this.withSlot(1, value); }
}
registerNodeClass(['NotPattern'], UnaryPatternSyntax);
export class ListPatternSyntax extends SyntaxNode {
  get openBracketToken() { return this.slot(0); }
  withOpenBracketToken(value) { return this.withSlot(0, value); }
  get patterns() { return this.list(1, true); }
  withPatterns(value) { return this.withSlot(1, value); }
  get closeBracketToken() { return this.slot(2); }
  withCloseBracketToken(value) { return this.withSlot(2, value); }
  get designation() { return this.slot(3); }
  withDesignation(value) { return this.withSlot(3, value); }
}
registerNodeClass(['ListPattern'], ListPatternSyntax);
export class SlicePatternSyntax extends SyntaxNode {
  get dotDotToken() { return this.slot(0); }
  withDotDotToken(value) { return this.withSlot(0, value); }
  get pattern() { return this.slot(1); }
  withPattern(value) { return this.withSlot(1, value); }
}
registerNodeClass(['SlicePattern'], SlicePatternSyntax);
export class SingleVariableDesignationSyntax extends SyntaxNode {
  get identifier() { return this.slot(0); }
  withIdentifier(value) { return this.withSlot(0, value); }
}
registerNodeClass(['SingleVariableDesignation'], SingleVariableDesignationSyntax);
export class DiscardDesignationSyntax extends SyntaxNode {
  get underscoreToken() { return this.slot(0); }
  withUnderscoreToken(value) { return this.withSlot(0, value); }
}
registerNodeClass(['DiscardDesignation'], DiscardDesignationSyntax);
export class ParenthesizedVariableDesignationSyntax extends SyntaxNode {
  get openParenToken() { return this.slot(0); }
  withOpenParenToken(value) { return this.withSlot(0, value); }
  get variables() { return this.list(1, true); }
  withVariables(value) { return this.withSlot(1, value); }
  get closeParenToken() { return this.slot(2); }
  withCloseParenToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['ParenthesizedVariableDesignation'], ParenthesizedVariableDesignationSyntax);
export class BlockSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get openBraceToken() { return this.slot(1); }
  withOpenBraceToken(value) { return this.withSlot(1, value); }
  get statements() { return this.list(2); }
  withStatements(value) { return this.withSlot(2, value); }
  get closeBraceToken() { return this.slot(3); }
  withCloseBraceToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['Block'], BlockSyntax);
export class LocalFunctionStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get returnType() { return this.slot(2); }
  withReturnType(value) { return this.withSlot(2, value); }
  get identifier() { return this.slot(3); }
  withIdentifier(value) { return this.withSlot(3, value); }
  get typeParameterList() { return this.slot(4); }
  withTypeParameterList(value) { return this.withSlot(4, value); }
  get parameterList() { return this.slot(5); }
  withParameterList(value) { return this.withSlot(5, value); }
  get constraintClauses() { return this.list(6); }
  withConstraintClauses(value) { return this.withSlot(6, value); }
  get body() { return this.slot(7); }
  withBody(value) { return this.withSlot(7, value); }
  get expressionBody() { return this.slot(8); }
  withExpressionBody(value) { return this.withSlot(8, value); }
  get semicolonToken() { return this.slot(9); }
  withSemicolonToken(value) { return this.withSlot(9, value); }
}
registerNodeClass(['LocalFunctionStatement'], LocalFunctionStatementSyntax);
export class LocalDeclarationStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get awaitKeyword() { return this.slot(1); }
  withAwaitKeyword(value) { return this.withSlot(1, value); }
  get usingKeyword() { return this.slot(2); }
  withUsingKeyword(value) { return this.withSlot(2, value); }
  get modifiers() { return this.list(3); }
  withModifiers(value) { return this.withSlot(3, value); }
  get declaration() { return this.slot(4); }
  withDeclaration(value) { return this.withSlot(4, value); }
  get semicolonToken() { return this.slot(5); }
  withSemicolonToken(value) { return this.withSlot(5, value); }
}
registerNodeClass(['LocalDeclarationStatement'], LocalDeclarationStatementSyntax);
export class VariableDeclarationSyntax extends SyntaxNode {
  get type() { return this.slot(0); }
  withType(value) { return this.withSlot(0, value); }
  get variables() { return this.list(1, true); }
  withVariables(value) { return this.withSlot(1, value); }
}
registerNodeClass(['VariableDeclaration'], VariableDeclarationSyntax);
export class VariableDeclaratorSyntax extends SyntaxNode {
  get identifier() { return this.slot(0); }
  withIdentifier(value) { return this.withSlot(0, value); }
  get argumentList() { return this.slot(1); }
  withArgumentList(value) { return this.withSlot(1, value); }
  get initializer() { return this.slot(2); }
  withInitializer(value) { return this.withSlot(2, value); }
}
registerNodeClass(['VariableDeclarator'], VariableDeclaratorSyntax);
export class EqualsValueClauseSyntax extends SyntaxNode {
  get equalsToken() { return this.slot(0); }
  withEqualsToken(value) { return this.withSlot(0, value); }
  get value() { return this.slot(1); }
  withValue(value) { return this.withSlot(1, value); }
}
registerNodeClass(['EqualsValueClause'], EqualsValueClauseSyntax);
export class ExpressionStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get expression() { return this.slot(1); }
  withExpression(value) { return this.withSlot(1, value); }
  get semicolonToken() { return this.slot(2); }
  withSemicolonToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['ExpressionStatement'], ExpressionStatementSyntax);
export class EmptyStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get semicolonToken() { return this.slot(1); }
  withSemicolonToken(value) { return this.withSlot(1, value); }
}
registerNodeClass(['EmptyStatement'], EmptyStatementSyntax);
export class LabeledStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get identifier() { return this.slot(1); }
  withIdentifier(value) { return this.withSlot(1, value); }
  get colonToken() { return this.slot(2); }
  withColonToken(value) { return this.withSlot(2, value); }
  get statement() { return this.slot(3); }
  withStatement(value) { return this.withSlot(3, value); }
}
registerNodeClass(['LabeledStatement'], LabeledStatementSyntax);
export class GotoStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get gotoKeyword() { return this.slot(1); }
  withGotoKeyword(value) { return this.withSlot(1, value); }
  get caseOrDefaultKeyword() { return this.slot(2); }
  withCaseOrDefaultKeyword(value) { return this.withSlot(2, value); }
  get expression() { return this.slot(3); }
  withExpression(value) { return this.withSlot(3, value); }
  get semicolonToken() { return this.slot(4); }
  withSemicolonToken(value) { return this.withSlot(4, value); }
}
registerNodeClass(['GotoStatement', 'GotoCaseStatement', 'GotoDefaultStatement'], GotoStatementSyntax);
export class BreakStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get breakKeyword() { return this.slot(1); }
  withBreakKeyword(value) { return this.withSlot(1, value); }
  get label() { return this.slot(2); }
  withLabel(value) { return this.withSlot(2, value); }
  get semicolonToken() { return this.slot(3); }
  withSemicolonToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['BreakStatement'], BreakStatementSyntax);
export class ContinueStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get continueKeyword() { return this.slot(1); }
  withContinueKeyword(value) { return this.withSlot(1, value); }
  get label() { return this.slot(2); }
  withLabel(value) { return this.withSlot(2, value); }
  get semicolonToken() { return this.slot(3); }
  withSemicolonToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['ContinueStatement'], ContinueStatementSyntax);
export class ReturnStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get returnKeyword() { return this.slot(1); }
  withReturnKeyword(value) { return this.withSlot(1, value); }
  get expression() { return this.slot(2); }
  withExpression(value) { return this.withSlot(2, value); }
  get semicolonToken() { return this.slot(3); }
  withSemicolonToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['ReturnStatement'], ReturnStatementSyntax);
export class ThrowStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get throwKeyword() { return this.slot(1); }
  withThrowKeyword(value) { return this.withSlot(1, value); }
  get expression() { return this.slot(2); }
  withExpression(value) { return this.withSlot(2, value); }
  get semicolonToken() { return this.slot(3); }
  withSemicolonToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['ThrowStatement'], ThrowStatementSyntax);
export class YieldStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get yieldKeyword() { return this.slot(1); }
  withYieldKeyword(value) { return this.withSlot(1, value); }
  get returnOrBreakKeyword() { return this.slot(2); }
  withReturnOrBreakKeyword(value) { return this.withSlot(2, value); }
  get expression() { return this.slot(3); }
  withExpression(value) { return this.withSlot(3, value); }
  get semicolonToken() { return this.slot(4); }
  withSemicolonToken(value) { return this.withSlot(4, value); }
}
registerNodeClass(['YieldReturnStatement', 'YieldBreakStatement'], YieldStatementSyntax);
export class WhileStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get whileKeyword() { return this.slot(1); }
  withWhileKeyword(value) { return this.withSlot(1, value); }
  get openParenToken() { return this.slot(2); }
  withOpenParenToken(value) { return this.withSlot(2, value); }
  get condition() { return this.slot(3); }
  withCondition(value) { return this.withSlot(3, value); }
  get closeParenToken() { return this.slot(4); }
  withCloseParenToken(value) { return this.withSlot(4, value); }
  get statement() { return this.slot(5); }
  withStatement(value) { return this.withSlot(5, value); }
}
registerNodeClass(['WhileStatement'], WhileStatementSyntax);
export class DoStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get doKeyword() { return this.slot(1); }
  withDoKeyword(value) { return this.withSlot(1, value); }
  get statement() { return this.slot(2); }
  withStatement(value) { return this.withSlot(2, value); }
  get whileKeyword() { return this.slot(3); }
  withWhileKeyword(value) { return this.withSlot(3, value); }
  get openParenToken() { return this.slot(4); }
  withOpenParenToken(value) { return this.withSlot(4, value); }
  get condition() { return this.slot(5); }
  withCondition(value) { return this.withSlot(5, value); }
  get closeParenToken() { return this.slot(6); }
  withCloseParenToken(value) { return this.withSlot(6, value); }
  get semicolonToken() { return this.slot(7); }
  withSemicolonToken(value) { return this.withSlot(7, value); }
}
registerNodeClass(['DoStatement'], DoStatementSyntax);
export class ForStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get forKeyword() { return this.slot(1); }
  withForKeyword(value) { return this.withSlot(1, value); }
  get openParenToken() { return this.slot(2); }
  withOpenParenToken(value) { return this.withSlot(2, value); }
  get declaration() { return this.slot(3); }
  withDeclaration(value) { return this.withSlot(3, value); }
  get initializers() { return this.list(4, true); }
  withInitializers(value) { return this.withSlot(4, value); }
  get firstSemicolonToken() { return this.slot(5); }
  withFirstSemicolonToken(value) { return this.withSlot(5, value); }
  get condition() { return this.slot(6); }
  withCondition(value) { return this.withSlot(6, value); }
  get secondSemicolonToken() { return this.slot(7); }
  withSecondSemicolonToken(value) { return this.withSlot(7, value); }
  get incrementors() { return this.list(8, true); }
  withIncrementors(value) { return this.withSlot(8, value); }
  get closeParenToken() { return this.slot(9); }
  withCloseParenToken(value) { return this.withSlot(9, value); }
  get statement() { return this.slot(10); }
  withStatement(value) { return this.withSlot(10, value); }
}
registerNodeClass(['ForStatement'], ForStatementSyntax);
export class ForEachStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get awaitKeyword() { return this.slot(1); }
  withAwaitKeyword(value) { return this.withSlot(1, value); }
  get forEachKeyword() { return this.slot(2); }
  withForEachKeyword(value) { return this.withSlot(2, value); }
  get openParenToken() { return this.slot(3); }
  withOpenParenToken(value) { return this.withSlot(3, value); }
  get type() { return this.slot(4); }
  withType(value) { return this.withSlot(4, value); }
  get identifier() { return this.slot(5); }
  withIdentifier(value) { return this.withSlot(5, value); }
  get inKeyword() { return this.slot(6); }
  withInKeyword(value) { return this.withSlot(6, value); }
  get expression() { return this.slot(7); }
  withExpression(value) { return this.withSlot(7, value); }
  get closeParenToken() { return this.slot(8); }
  withCloseParenToken(value) { return this.withSlot(8, value); }
  get statement() { return this.slot(9); }
  withStatement(value) { return this.withSlot(9, value); }
}
registerNodeClass(['ForEachStatement'], ForEachStatementSyntax);
export class ForEachVariableStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get awaitKeyword() { return this.slot(1); }
  withAwaitKeyword(value) { return this.withSlot(1, value); }
  get forEachKeyword() { return this.slot(2); }
  withForEachKeyword(value) { return this.withSlot(2, value); }
  get openParenToken() { return this.slot(3); }
  withOpenParenToken(value) { return this.withSlot(3, value); }
  get variable() { return this.slot(4); }
  withVariable(value) { return this.withSlot(4, value); }
  get inKeyword() { return this.slot(5); }
  withInKeyword(value) { return this.withSlot(5, value); }
  get expression() { return this.slot(6); }
  withExpression(value) { return this.withSlot(6, value); }
  get closeParenToken() { return this.slot(7); }
  withCloseParenToken(value) { return this.withSlot(7, value); }
  get statement() { return this.slot(8); }
  withStatement(value) { return this.withSlot(8, value); }
}
registerNodeClass(['ForEachVariableStatement'], ForEachVariableStatementSyntax);
export class UsingStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get awaitKeyword() { return this.slot(1); }
  withAwaitKeyword(value) { return this.withSlot(1, value); }
  get usingKeyword() { return this.slot(2); }
  withUsingKeyword(value) { return this.withSlot(2, value); }
  get openParenToken() { return this.slot(3); }
  withOpenParenToken(value) { return this.withSlot(3, value); }
  get declaration() { return this.slot(4); }
  withDeclaration(value) { return this.withSlot(4, value); }
  get expression() { return this.slot(5); }
  withExpression(value) { return this.withSlot(5, value); }
  get closeParenToken() { return this.slot(6); }
  withCloseParenToken(value) { return this.withSlot(6, value); }
  get statement() { return this.slot(7); }
  withStatement(value) { return this.withSlot(7, value); }
}
registerNodeClass(['UsingStatement'], UsingStatementSyntax);
export class FixedStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get fixedKeyword() { return this.slot(1); }
  withFixedKeyword(value) { return this.withSlot(1, value); }
  get openParenToken() { return this.slot(2); }
  withOpenParenToken(value) { return this.withSlot(2, value); }
  get declaration() { return this.slot(3); }
  withDeclaration(value) { return this.withSlot(3, value); }
  get closeParenToken() { return this.slot(4); }
  withCloseParenToken(value) { return this.withSlot(4, value); }
  get statement() { return this.slot(5); }
  withStatement(value) { return this.withSlot(5, value); }
}
registerNodeClass(['FixedStatement'], FixedStatementSyntax);
export class CheckedStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get keyword() { return this.slot(1); }
  withKeyword(value) { return this.withSlot(1, value); }
  get block() { return this.slot(2); }
  withBlock(value) { return this.withSlot(2, value); }
}
registerNodeClass(['CheckedStatement', 'UncheckedStatement'], CheckedStatementSyntax);
export class UnsafeStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get unsafeKeyword() { return this.slot(1); }
  withUnsafeKeyword(value) { return this.withSlot(1, value); }
  get block() { return this.slot(2); }
  withBlock(value) { return this.withSlot(2, value); }
}
registerNodeClass(['UnsafeStatement'], UnsafeStatementSyntax);
export class LockStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get lockKeyword() { return this.slot(1); }
  withLockKeyword(value) { return this.withSlot(1, value); }
  get openParenToken() { return this.slot(2); }
  withOpenParenToken(value) { return this.withSlot(2, value); }
  get expression() { return this.slot(3); }
  withExpression(value) { return this.withSlot(3, value); }
  get closeParenToken() { return this.slot(4); }
  withCloseParenToken(value) { return this.withSlot(4, value); }
  get statement() { return this.slot(5); }
  withStatement(value) { return this.withSlot(5, value); }
}
registerNodeClass(['LockStatement'], LockStatementSyntax);
export class IfStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get ifKeyword() { return this.slot(1); }
  withIfKeyword(value) { return this.withSlot(1, value); }
  get openParenToken() { return this.slot(2); }
  withOpenParenToken(value) { return this.withSlot(2, value); }
  get condition() { return this.slot(3); }
  withCondition(value) { return this.withSlot(3, value); }
  get closeParenToken() { return this.slot(4); }
  withCloseParenToken(value) { return this.withSlot(4, value); }
  get statement() { return this.slot(5); }
  withStatement(value) { return this.withSlot(5, value); }
  get else() { return this.slot(6); }
  withElse(value) { return this.withSlot(6, value); }
}
registerNodeClass(['IfStatement'], IfStatementSyntax);
export class ElseClauseSyntax extends SyntaxNode {
  get elseKeyword() { return this.slot(0); }
  withElseKeyword(value) { return this.withSlot(0, value); }
  get statement() { return this.slot(1); }
  withStatement(value) { return this.withSlot(1, value); }
}
registerNodeClass(['ElseClause'], ElseClauseSyntax);
export class SwitchStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get switchKeyword() { return this.slot(1); }
  withSwitchKeyword(value) { return this.withSlot(1, value); }
  get openParenToken() { return this.slot(2); }
  withOpenParenToken(value) { return this.withSlot(2, value); }
  get expression() { return this.slot(3); }
  withExpression(value) { return this.withSlot(3, value); }
  get closeParenToken() { return this.slot(4); }
  withCloseParenToken(value) { return this.withSlot(4, value); }
  get openBraceToken() { return this.slot(5); }
  withOpenBraceToken(value) { return this.withSlot(5, value); }
  get sections() { return this.list(6); }
  withSections(value) { return this.withSlot(6, value); }
  get closeBraceToken() { return this.slot(7); }
  withCloseBraceToken(value) { return this.withSlot(7, value); }
}
registerNodeClass(['SwitchStatement'], SwitchStatementSyntax);
export class SwitchSectionSyntax extends SyntaxNode {
  get labels() { return this.list(0); }
  withLabels(value) { return this.withSlot(0, value); }
  get statements() { return this.list(1); }
  withStatements(value) { return this.withSlot(1, value); }
}
registerNodeClass(['SwitchSection'], SwitchSectionSyntax);
export class CasePatternSwitchLabelSyntax extends SyntaxNode {
  get keyword() { return this.slot(0); }
  withKeyword(value) { return this.withSlot(0, value); }
  get pattern() { return this.slot(1); }
  withPattern(value) { return this.withSlot(1, value); }
  get whenClause() { return this.slot(2); }
  withWhenClause(value) { return this.withSlot(2, value); }
  get colonToken() { return this.slot(3); }
  withColonToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['CasePatternSwitchLabel'], CasePatternSwitchLabelSyntax);
export class CaseSwitchLabelSyntax extends SyntaxNode {
  get keyword() { return this.slot(0); }
  withKeyword(value) { return this.withSlot(0, value); }
  get value() { return this.slot(1); }
  withValue(value) { return this.withSlot(1, value); }
  get colonToken() { return this.slot(2); }
  withColonToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['CaseSwitchLabel'], CaseSwitchLabelSyntax);
export class DefaultSwitchLabelSyntax extends SyntaxNode {
  get keyword() { return this.slot(0); }
  withKeyword(value) { return this.withSlot(0, value); }
  get colonToken() { return this.slot(1); }
  withColonToken(value) { return this.withSlot(1, value); }
}
registerNodeClass(['DefaultSwitchLabel'], DefaultSwitchLabelSyntax);
export class TryStatementSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get tryKeyword() { return this.slot(1); }
  withTryKeyword(value) { return this.withSlot(1, value); }
  get block() { return this.slot(2); }
  withBlock(value) { return this.withSlot(2, value); }
  get catches() { return this.list(3); }
  withCatches(value) { return this.withSlot(3, value); }
  get finally() { return this.slot(4); }
  withFinally(value) { return this.withSlot(4, value); }
}
registerNodeClass(['TryStatement'], TryStatementSyntax);
export class CatchClauseSyntax extends SyntaxNode {
  get catchKeyword() { return this.slot(0); }
  withCatchKeyword(value) { return this.withSlot(0, value); }
  get declaration() { return this.slot(1); }
  withDeclaration(value) { return this.withSlot(1, value); }
  get filter() { return this.slot(2); }
  withFilter(value) { return this.withSlot(2, value); }
  get block() { return this.slot(3); }
  withBlock(value) { return this.withSlot(3, value); }
}
registerNodeClass(['CatchClause'], CatchClauseSyntax);
export class CatchDeclarationSyntax extends SyntaxNode {
  get openParenToken() { return this.slot(0); }
  withOpenParenToken(value) { return this.withSlot(0, value); }
  get type() { return this.slot(1); }
  withType(value) { return this.withSlot(1, value); }
  get identifier() { return this.slot(2); }
  withIdentifier(value) { return this.withSlot(2, value); }
  get closeParenToken() { return this.slot(3); }
  withCloseParenToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['CatchDeclaration'], CatchDeclarationSyntax);
export class CatchFilterClauseSyntax extends SyntaxNode {
  get whenKeyword() { return this.slot(0); }
  withWhenKeyword(value) { return this.withSlot(0, value); }
  get openParenToken() { return this.slot(1); }
  withOpenParenToken(value) { return this.withSlot(1, value); }
  get filterExpression() { return this.slot(2); }
  withFilterExpression(value) { return this.withSlot(2, value); }
  get closeParenToken() { return this.slot(3); }
  withCloseParenToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['CatchFilterClause'], CatchFilterClauseSyntax);
export class FinallyClauseSyntax extends SyntaxNode {
  get finallyKeyword() { return this.slot(0); }
  withFinallyKeyword(value) { return this.withSlot(0, value); }
  get block() { return this.slot(1); }
  withBlock(value) { return this.withSlot(1, value); }
}
registerNodeClass(['FinallyClause'], FinallyClauseSyntax);
export class DocumentationCommentTriviaSyntax extends SyntaxNode {
  get content() { return this.list(0); }
  withContent(value) { return this.withSlot(0, value); }
  get endOfComment() { return this.slot(1); }
  withEndOfComment(value) { return this.withSlot(1, value); }
}
registerNodeClass(['SingleLineDocumentationCommentTrivia', 'MultiLineDocumentationCommentTrivia'], DocumentationCommentTriviaSyntax);
export class XmlElementSyntax extends SyntaxNode {
  get startTag() { return this.slot(0); }
  withStartTag(value) { return this.withSlot(0, value); }
  get content() { return this.list(1); }
  withContent(value) { return this.withSlot(1, value); }
  get endTag() { return this.slot(2); }
  withEndTag(value) { return this.withSlot(2, value); }
}
registerNodeClass(['XmlElement'], XmlElementSyntax);
export class XmlElementStartTagSyntax extends SyntaxNode {
  get lessThanToken() { return this.slot(0); }
  withLessThanToken(value) { return this.withSlot(0, value); }
  get name() { return this.slot(1); }
  withName(value) { return this.withSlot(1, value); }
  get attributes() { return this.list(2); }
  withAttributes(value) { return this.withSlot(2, value); }
  get greaterThanToken() { return this.slot(3); }
  withGreaterThanToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['XmlElementStartTag'], XmlElementStartTagSyntax);
export class XmlElementEndTagSyntax extends SyntaxNode {
  get lessThanSlashToken() { return this.slot(0); }
  withLessThanSlashToken(value) { return this.withSlot(0, value); }
  get name() { return this.slot(1); }
  withName(value) { return this.withSlot(1, value); }
  get greaterThanToken() { return this.slot(2); }
  withGreaterThanToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['XmlElementEndTag'], XmlElementEndTagSyntax);
export class XmlEmptyElementSyntax extends SyntaxNode {
  get lessThanToken() { return this.slot(0); }
  withLessThanToken(value) { return this.withSlot(0, value); }
  get name() { return this.slot(1); }
  withName(value) { return this.withSlot(1, value); }
  get attributes() { return this.list(2); }
  withAttributes(value) { return this.withSlot(2, value); }
  get slashGreaterThanToken() { return this.slot(3); }
  withSlashGreaterThanToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['XmlEmptyElement'], XmlEmptyElementSyntax);
export class XmlNameSyntax extends SyntaxNode {
  get prefix() { return this.slot(0); }
  withPrefix(value) { return this.withSlot(0, value); }
  get localName() { return this.slot(1); }
  withLocalName(value) { return this.withSlot(1, value); }
}
registerNodeClass(['XmlName'], XmlNameSyntax);
export class XmlPrefixSyntax extends SyntaxNode {
  get prefix() { return this.slot(0); }
  withPrefix(value) { return this.withSlot(0, value); }
  get colonToken() { return this.slot(1); }
  withColonToken(value) { return this.withSlot(1, value); }
}
registerNodeClass(['XmlPrefix'], XmlPrefixSyntax);
export class XmlTextAttributeSyntax extends SyntaxNode {
  get name() { return this.slot(0); }
  withName(value) { return this.withSlot(0, value); }
  get equalsToken() { return this.slot(1); }
  withEqualsToken(value) { return this.withSlot(1, value); }
  get startQuoteToken() { return this.slot(2); }
  withStartQuoteToken(value) { return this.withSlot(2, value); }
  get textTokens() { return this.list(3); }
  withTextTokens(value) { return this.withSlot(3, value); }
  get endQuoteToken() { return this.slot(4); }
  withEndQuoteToken(value) { return this.withSlot(4, value); }
}
registerNodeClass(['XmlTextAttribute'], XmlTextAttributeSyntax);
export class XmlCrefAttributeSyntax extends SyntaxNode {
  get name() { return this.slot(0); }
  withName(value) { return this.withSlot(0, value); }
  get equalsToken() { return this.slot(1); }
  withEqualsToken(value) { return this.withSlot(1, value); }
  get startQuoteToken() { return this.slot(2); }
  withStartQuoteToken(value) { return this.withSlot(2, value); }
  get cref() { return this.slot(3); }
  withCref(value) { return this.withSlot(3, value); }
  get endQuoteToken() { return this.slot(4); }
  withEndQuoteToken(value) { return this.withSlot(4, value); }
}
registerNodeClass(['XmlCrefAttribute'], XmlCrefAttributeSyntax);
export class XmlNameAttributeSyntax extends SyntaxNode {
  get name() { return this.slot(0); }
  withName(value) { return this.withSlot(0, value); }
  get equalsToken() { return this.slot(1); }
  withEqualsToken(value) { return this.withSlot(1, value); }
  get startQuoteToken() { return this.slot(2); }
  withStartQuoteToken(value) { return this.withSlot(2, value); }
  get identifier() { return this.slot(3); }
  withIdentifier(value) { return this.withSlot(3, value); }
  get endQuoteToken() { return this.slot(4); }
  withEndQuoteToken(value) { return this.withSlot(4, value); }
}
registerNodeClass(['XmlNameAttribute'], XmlNameAttributeSyntax);
export class XmlTextSyntax extends SyntaxNode {
  get textTokens() { return this.list(0); }
  withTextTokens(value) { return this.withSlot(0, value); }
}
registerNodeClass(['XmlText'], XmlTextSyntax);
export class XmlCDataSectionSyntax extends SyntaxNode {
  get startCDataToken() { return this.slot(0); }
  withStartCDataToken(value) { return this.withSlot(0, value); }
  get textTokens() { return this.list(1); }
  withTextTokens(value) { return this.withSlot(1, value); }
  get endCDataToken() { return this.slot(2); }
  withEndCDataToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['XmlCDataSection'], XmlCDataSectionSyntax);
export class XmlProcessingInstructionSyntax extends SyntaxNode {
  get startProcessingInstructionToken() { return this.slot(0); }
  withStartProcessingInstructionToken(value) { return this.withSlot(0, value); }
  get name() { return this.slot(1); }
  withName(value) { return this.withSlot(1, value); }
  get textTokens() { return this.list(2); }
  withTextTokens(value) { return this.withSlot(2, value); }
  get endProcessingInstructionToken() { return this.slot(3); }
  withEndProcessingInstructionToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['XmlProcessingInstruction'], XmlProcessingInstructionSyntax);
export class XmlCommentSyntax extends SyntaxNode {
  get lessThanExclamationMinusMinusToken() { return this.slot(0); }
  withLessThanExclamationMinusMinusToken(value) { return this.withSlot(0, value); }
  get textTokens() { return this.list(1); }
  withTextTokens(value) { return this.withSlot(1, value); }
  get minusMinusGreaterThanToken() { return this.slot(2); }
  withMinusMinusGreaterThanToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['XmlComment'], XmlCommentSyntax);
export class TypeCrefSyntax extends SyntaxNode {
  get type() { return this.slot(0); }
  withType(value) { return this.withSlot(0, value); }
}
registerNodeClass(['TypeCref'], TypeCrefSyntax);
export class QualifiedCrefSyntax extends SyntaxNode {
  get container() { return this.slot(0); }
  withContainer(value) { return this.withSlot(0, value); }
  get dotToken() { return this.slot(1); }
  withDotToken(value) { return this.withSlot(1, value); }
  get member() { return this.slot(2); }
  withMember(value) { return this.withSlot(2, value); }
}
registerNodeClass(['QualifiedCref'], QualifiedCrefSyntax);
export class NameMemberCrefSyntax extends SyntaxNode {
  get name() { return this.slot(0); }
  withName(value) { return this.withSlot(0, value); }
  get parameters() { return this.slot(1); }
  withParameters(value) { return this.withSlot(1, value); }
}
registerNodeClass(['NameMemberCref'], NameMemberCrefSyntax);
export class IndexerMemberCrefSyntax extends SyntaxNode {
  get thisKeyword() { return this.slot(0); }
  withThisKeyword(value) { return this.withSlot(0, value); }
  get parameters() { return this.slot(1); }
  withParameters(value) { return this.withSlot(1, value); }
}
registerNodeClass(['IndexerMemberCref'], IndexerMemberCrefSyntax);
export class OperatorMemberCrefSyntax extends SyntaxNode {
  get operatorKeyword() { return this.slot(0); }
  withOperatorKeyword(value) { return this.withSlot(0, value); }
  get checkedKeyword() { return this.slot(1); }
  withCheckedKeyword(value) { return this.withSlot(1, value); }
  get operatorToken() { return this.slot(2); }
  withOperatorToken(value) { return this.withSlot(2, value); }
  get parameters() { return this.slot(3); }
  withParameters(value) { return this.withSlot(3, value); }
}
registerNodeClass(['OperatorMemberCref'], OperatorMemberCrefSyntax);
export class ConversionOperatorMemberCrefSyntax extends SyntaxNode {
  get implicitOrExplicitKeyword() { return this.slot(0); }
  withImplicitOrExplicitKeyword(value) { return this.withSlot(0, value); }
  get operatorKeyword() { return this.slot(1); }
  withOperatorKeyword(value) { return this.withSlot(1, value); }
  get checkedKeyword() { return this.slot(2); }
  withCheckedKeyword(value) { return this.withSlot(2, value); }
  get type() { return this.slot(3); }
  withType(value) { return this.withSlot(3, value); }
  get parameters() { return this.slot(4); }
  withParameters(value) { return this.withSlot(4, value); }
}
registerNodeClass(['ConversionOperatorMemberCref'], ConversionOperatorMemberCrefSyntax);
export class CrefParameterListSyntax extends SyntaxNode {
  get openToken() { return this.slot(0); }
  withOpenToken(value) { return this.withSlot(0, value); }
  get parameters() { return this.list(1, true); }
  withParameters(value) { return this.withSlot(1, value); }
  get closeToken() { return this.slot(2); }
  withCloseToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['CrefParameterList', 'CrefBracketedParameterList'], CrefParameterListSyntax);
export class CrefParameterSyntax extends SyntaxNode {
  get refKindKeyword() { return this.slot(0); }
  withRefKindKeyword(value) { return this.withSlot(0, value); }
  get readOnlyKeyword() { return this.slot(1); }
  withReadOnlyKeyword(value) { return this.withSlot(1, value); }
  get type() { return this.slot(2); }
  withType(value) { return this.withSlot(2, value); }
}
registerNodeClass(['CrefParameter'], CrefParameterSyntax);
export class ExtensionBlockDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get keyword() { return this.slot(2); }
  withKeyword(value) { return this.withSlot(2, value); }
  get typeParameterList() { return this.slot(3); }
  withTypeParameterList(value) { return this.withSlot(3, value); }
  get parameterList() { return this.slot(4); }
  withParameterList(value) { return this.withSlot(4, value); }
  get constraintClauses() { return this.list(5); }
  withConstraintClauses(value) { return this.withSlot(5, value); }
  get openBraceToken() { return this.slot(6); }
  withOpenBraceToken(value) { return this.withSlot(6, value); }
  get members() { return this.list(7); }
  withMembers(value) { return this.withSlot(7, value); }
  get closeBraceToken() { return this.slot(8); }
  withCloseBraceToken(value) { return this.withSlot(8, value); }
  get semicolonToken() { return this.slot(9); }
  withSemicolonToken(value) { return this.withSlot(9, value); }
}
registerNodeClass(['ExtensionBlockDeclaration'], ExtensionBlockDeclarationSyntax);
export class UnionDeclarationSyntax extends SyntaxNode {
  get attributeLists() { return this.list(0); }
  withAttributeLists(value) { return this.withSlot(0, value); }
  get modifiers() { return this.list(1); }
  withModifiers(value) { return this.withSlot(1, value); }
  get keyword() { return this.slot(2); }
  withKeyword(value) { return this.withSlot(2, value); }
  get identifier() { return this.slot(3); }
  withIdentifier(value) { return this.withSlot(3, value); }
  get typeParameterList() { return this.slot(4); }
  withTypeParameterList(value) { return this.withSlot(4, value); }
  get caseTypes() { return this.slot(5); }
  withCaseTypes(value) { return this.withSlot(5, value); }
  get baseList() { return this.slot(6); }
  withBaseList(value) { return this.withSlot(6, value); }
  get constraintClauses() { return this.list(7); }
  withConstraintClauses(value) { return this.withSlot(7, value); }
  get openBraceToken() { return this.slot(8); }
  withOpenBraceToken(value) { return this.withSlot(8, value); }
  get members() { return this.list(9); }
  withMembers(value) { return this.withSlot(9, value); }
  get closeBraceToken() { return this.slot(10); }
  withCloseBraceToken(value) { return this.withSlot(10, value); }
  get semicolonToken() { return this.slot(11); }
  withSemicolonToken(value) { return this.withSlot(11, value); }
}
registerNodeClass(['UnionDeclaration'], UnionDeclarationSyntax);
export class UnionCaseTypeListSyntax extends SyntaxNode {
  get openParenToken() { return this.slot(0); }
  withOpenParenToken(value) { return this.withSlot(0, value); }
  get types() { return this.list(1, true); }
  withTypes(value) { return this.withSlot(1, value); }
  get closeParenToken() { return this.slot(2); }
  withCloseParenToken(value) { return this.withSlot(2, value); }
}
registerNodeClass(['UnionCaseTypeList'], UnionCaseTypeListSyntax);
export class UnsafeExpressionSyntax extends SyntaxNode {
  get unsafeKeyword() { return this.slot(0); }
  withUnsafeKeyword(value) { return this.withSlot(0, value); }
  get openParenToken() { return this.slot(1); }
  withOpenParenToken(value) { return this.withSlot(1, value); }
  get expression() { return this.slot(2); }
  withExpression(value) { return this.withSlot(2, value); }
  get closeParenToken() { return this.slot(3); }
  withCloseParenToken(value) { return this.withSlot(3, value); }
}
registerNodeClass(['UnsafeExpression'], UnsafeExpressionSyntax);
/** Factories returning detached nodes; children may be red or green elements, arrays for lists, or null. */
export const SyntaxFactory = Object.freeze({
  compilationUnit(externs, usings, attributeLists, members, endOfFileToken) { return make('CompilationUnit', [externs, usings, attributeLists, members, endOfFileToken]); },
  externAliasDirective(externKeyword, aliasKeyword, identifier, semicolonToken) { return make('ExternAliasDirective', [externKeyword, aliasKeyword, identifier, semicolonToken]); },
  usingDirective(globalKeyword, usingKeyword, staticKeyword, unsafeKeyword, alias, namespaceOrType, semicolonToken) { return make('UsingDirective', [globalKeyword, usingKeyword, staticKeyword, unsafeKeyword, alias, namespaceOrType, semicolonToken]); },
  nameEquals(name, equalsToken) { return make('NameEquals', [name, equalsToken]); },
  namespaceDeclaration(attributeLists, modifiers, namespaceKeyword, name, openBraceToken, externs, usings, members, closeBraceToken, semicolonToken) { return make('NamespaceDeclaration', [attributeLists, modifiers, namespaceKeyword, name, openBraceToken, externs, usings, members, closeBraceToken, semicolonToken]); },
  fileScopedNamespaceDeclaration(attributeLists, modifiers, namespaceKeyword, name, semicolonToken, externs, usings, members) { return make('FileScopedNamespaceDeclaration', [attributeLists, modifiers, namespaceKeyword, name, semicolonToken, externs, usings, members]); },
  attributeList(openBracketToken, target, attributes, closeBracketToken) { return make('AttributeList', [openBracketToken, target, attributes, closeBracketToken]); },
  attributeTargetSpecifier(identifier, colonToken) { return make('AttributeTargetSpecifier', [identifier, colonToken]); },
  attribute(name, argumentList) { return make('Attribute', [name, argumentList]); },
  attributeArgumentList(openParenToken, arguments_, closeParenToken) { return make('AttributeArgumentList', [openParenToken, arguments_, closeParenToken]); },
  attributeArgument(nameEquals, nameColon, expression) { return make('AttributeArgument', [nameEquals, nameColon, expression]); },
  globalStatement(attributeLists, modifiers, statement) { return make('GlobalStatement', [attributeLists, modifiers, statement]); },
  typeParameterList(lessThanToken, parameters, greaterThanToken) { return make('TypeParameterList', [lessThanToken, parameters, greaterThanToken]); },
  typeParameter(attributeLists, varianceKeyword, identifier) { return make('TypeParameter', [attributeLists, varianceKeyword, identifier]); },
  typeDeclaration(kind, attributeLists, modifiers, keyword, identifier, typeParameterList, parameterList, baseList, constraintClauses, openBraceToken, members, closeBraceToken, semicolonToken) { return make(kind, [attributeLists, modifiers, keyword, identifier, typeParameterList, parameterList, baseList, constraintClauses, openBraceToken, members, closeBraceToken, semicolonToken]); },
  recordDeclaration(kind, attributeLists, modifiers, keyword, classOrStructKeyword, identifier, typeParameterList, parameterList, baseList, constraintClauses, openBraceToken, members, closeBraceToken, semicolonToken) { return make(kind, [attributeLists, modifiers, keyword, classOrStructKeyword, identifier, typeParameterList, parameterList, baseList, constraintClauses, openBraceToken, members, closeBraceToken, semicolonToken]); },
  enumDeclaration(attributeLists, modifiers, enumKeyword, identifier, baseList, openBraceToken, members, closeBraceToken, semicolonToken) { return make('EnumDeclaration', [attributeLists, modifiers, enumKeyword, identifier, baseList, openBraceToken, members, closeBraceToken, semicolonToken]); },
  delegateDeclaration(attributeLists, modifiers, delegateKeyword, returnType, identifier, typeParameterList, parameterList, constraintClauses, semicolonToken) { return make('DelegateDeclaration', [attributeLists, modifiers, delegateKeyword, returnType, identifier, typeParameterList, parameterList, constraintClauses, semicolonToken]); },
  enumMemberDeclaration(attributeLists, modifiers, identifier, equalsValue) { return make('EnumMemberDeclaration', [attributeLists, modifiers, identifier, equalsValue]); },
  baseList(colonToken, types) { return make('BaseList', [colonToken, types]); },
  simpleBaseType(type) { return make('SimpleBaseType', [type]); },
  primaryConstructorBaseType(type, argumentList) { return make('PrimaryConstructorBaseType', [type, argumentList]); },
  typeParameterConstraintClause(whereKeyword, name, colonToken, constraints) { return make('TypeParameterConstraintClause', [whereKeyword, name, colonToken, constraints]); },
  constructorConstraint(newKeyword, openParenToken, closeParenToken) { return make('ConstructorConstraint', [newKeyword, openParenToken, closeParenToken]); },
  classOrStructConstraint(kind, classOrStructKeyword, questionToken) { return make(kind, [classOrStructKeyword, questionToken]); },
  typeConstraint(type) { return make('TypeConstraint', [type]); },
  defaultConstraint(defaultKeyword) { return make('DefaultConstraint', [defaultKeyword]); },
  allowsConstraintClause(allowsKeyword, constraints) { return make('AllowsConstraintClause', [allowsKeyword, constraints]); },
  refStructConstraint(refKeyword, structKeyword) { return make('RefStructConstraint', [refKeyword, structKeyword]); },
  fieldDeclaration(attributeLists, modifiers, declaration, semicolonToken) { return make('FieldDeclaration', [attributeLists, modifiers, declaration, semicolonToken]); },
  eventFieldDeclaration(attributeLists, modifiers, eventKeyword, declaration, semicolonToken) { return make('EventFieldDeclaration', [attributeLists, modifiers, eventKeyword, declaration, semicolonToken]); },
  explicitInterfaceSpecifier(name, dotToken) { return make('ExplicitInterfaceSpecifier', [name, dotToken]); },
  methodDeclaration(attributeLists, modifiers, returnType, explicitInterfaceSpecifier, identifier, typeParameterList, parameterList, constraintClauses, body, expressionBody, semicolonToken) { return make('MethodDeclaration', [attributeLists, modifiers, returnType, explicitInterfaceSpecifier, identifier, typeParameterList, parameterList, constraintClauses, body, expressionBody, semicolonToken]); },
  operatorDeclaration(attributeLists, modifiers, returnType, explicitInterfaceSpecifier, operatorKeyword, checkedKeyword, operatorToken, parameterList, body, expressionBody, semicolonToken) { return make('OperatorDeclaration', [attributeLists, modifiers, returnType, explicitInterfaceSpecifier, operatorKeyword, checkedKeyword, operatorToken, parameterList, body, expressionBody, semicolonToken]); },
  conversionOperatorDeclaration(attributeLists, modifiers, implicitOrExplicitKeyword, explicitInterfaceSpecifier, operatorKeyword, checkedKeyword, type, parameterList, body, expressionBody, semicolonToken) { return make('ConversionOperatorDeclaration', [attributeLists, modifiers, implicitOrExplicitKeyword, explicitInterfaceSpecifier, operatorKeyword, checkedKeyword, type, parameterList, body, expressionBody, semicolonToken]); },
  constructorDeclaration(attributeLists, modifiers, identifier, parameterList, initializer, body, expressionBody, semicolonToken) { return make('ConstructorDeclaration', [attributeLists, modifiers, identifier, parameterList, initializer, body, expressionBody, semicolonToken]); },
  constructorInitializer(kind, colonToken, thisOrBaseKeyword, argumentList) { return make(kind, [colonToken, thisOrBaseKeyword, argumentList]); },
  destructorDeclaration(attributeLists, modifiers, tildeToken, identifier, parameterList, body, expressionBody, semicolonToken) { return make('DestructorDeclaration', [attributeLists, modifiers, tildeToken, identifier, parameterList, body, expressionBody, semicolonToken]); },
  propertyDeclaration(attributeLists, modifiers, type, explicitInterfaceSpecifier, identifier, accessorList, expressionBody, initializer, semicolonToken) { return make('PropertyDeclaration', [attributeLists, modifiers, type, explicitInterfaceSpecifier, identifier, accessorList, expressionBody, initializer, semicolonToken]); },
  arrowExpressionClause(arrowToken, expression) { return make('ArrowExpressionClause', [arrowToken, expression]); },
  eventDeclaration(attributeLists, modifiers, eventKeyword, type, explicitInterfaceSpecifier, identifier, accessorList, semicolonToken) { return make('EventDeclaration', [attributeLists, modifiers, eventKeyword, type, explicitInterfaceSpecifier, identifier, accessorList, semicolonToken]); },
  indexerDeclaration(attributeLists, modifiers, type, explicitInterfaceSpecifier, thisKeyword, parameterList, accessorList, expressionBody, semicolonToken) { return make('IndexerDeclaration', [attributeLists, modifiers, type, explicitInterfaceSpecifier, thisKeyword, parameterList, accessorList, expressionBody, semicolonToken]); },
  accessorList(openBraceToken, accessors, closeBraceToken) { return make('AccessorList', [openBraceToken, accessors, closeBraceToken]); },
  accessorDeclaration(kind, attributeLists, modifiers, keyword, body, expressionBody, semicolonToken) { return make(kind, [attributeLists, modifiers, keyword, body, expressionBody, semicolonToken]); },
  parameterList(openParenToken, parameters, closeParenToken) { return make('ParameterList', [openParenToken, parameters, closeParenToken]); },
  bracketedParameterList(openBracketToken, parameters, closeBracketToken) { return make('BracketedParameterList', [openBracketToken, parameters, closeBracketToken]); },
  parameter(attributeLists, modifiers, type, identifier, default_) { return make('Parameter', [attributeLists, modifiers, type, identifier, default_]); },
  incompleteMember(attributeLists, modifiers, type) { return make('IncompleteMember', [attributeLists, modifiers, type]); },
  identifierName(identifier) { return make('IdentifierName', [identifier]); },
  qualifiedName(left, dotToken, right) { return make('QualifiedName', [left, dotToken, right]); },
  genericName(identifier, typeArgumentList) { return make('GenericName', [identifier, typeArgumentList]); },
  typeArgumentList(lessThanToken, arguments_, greaterThanToken) { return make('TypeArgumentList', [lessThanToken, arguments_, greaterThanToken]); },
  aliasQualifiedName(alias, colonColonToken, name) { return make('AliasQualifiedName', [alias, colonColonToken, name]); },
  predefinedType(keyword) { return make('PredefinedType', [keyword]); },
  arrayType(elementType, rankSpecifiers) { return make('ArrayType', [elementType, rankSpecifiers]); },
  arrayRankSpecifier(openBracketToken, sizes, closeBracketToken) { return make('ArrayRankSpecifier', [openBracketToken, sizes, closeBracketToken]); },
  pointerType(elementType, asteriskToken) { return make('PointerType', [elementType, asteriskToken]); },
  functionPointerType(delegateKeyword, asteriskToken, callingConvention, parameterList) { return make('FunctionPointerType', [delegateKeyword, asteriskToken, callingConvention, parameterList]); },
  functionPointerParameterList(lessThanToken, parameters, greaterThanToken) { return make('FunctionPointerParameterList', [lessThanToken, parameters, greaterThanToken]); },
  functionPointerCallingConvention(managedOrUnmanagedKeyword, unmanagedCallingConventionList) { return make('FunctionPointerCallingConvention', [managedOrUnmanagedKeyword, unmanagedCallingConventionList]); },
  functionPointerUnmanagedCallingConventionList(openBracketToken, callingConventions, closeBracketToken) { return make('FunctionPointerUnmanagedCallingConventionList', [openBracketToken, callingConventions, closeBracketToken]); },
  functionPointerUnmanagedCallingConvention(name) { return make('FunctionPointerUnmanagedCallingConvention', [name]); },
  functionPointerParameter(attributeLists, modifiers, type) { return make('FunctionPointerParameter', [attributeLists, modifiers, type]); },
  nullableType(elementType, questionToken) { return make('NullableType', [elementType, questionToken]); },
  tupleType(openParenToken, elements, closeParenToken) { return make('TupleType', [openParenToken, elements, closeParenToken]); },
  tupleElement(type, identifier) { return make('TupleElement', [type, identifier]); },
  omittedTypeArgument(omittedTypeArgumentToken) { return make('OmittedTypeArgument', [omittedTypeArgumentToken]); },
  refType(refKeyword, readOnlyKeyword, type) { return make('RefType', [refKeyword, readOnlyKeyword, type]); },
  scopedType(scopedKeyword, type) { return make('ScopedType', [scopedKeyword, type]); },
  parenthesizedExpression(openParenToken, expression, closeParenToken) { return make('ParenthesizedExpression', [openParenToken, expression, closeParenToken]); },
  tupleExpression(openParenToken, arguments_, closeParenToken) { return make('TupleExpression', [openParenToken, arguments_, closeParenToken]); },
  prefixUnaryExpression(kind, operatorToken, operand) { return make(kind, [operatorToken, operand]); },
  awaitExpression(awaitKeyword, expression) { return make('AwaitExpression', [awaitKeyword, expression]); },
  postfixUnaryExpression(kind, operand, operatorToken) { return make(kind, [operand, operatorToken]); },
  memberAccessExpression(kind, expression, operatorToken, name) { return make(kind, [expression, operatorToken, name]); },
  conditionalAccessExpression(expression, operatorToken, whenNotNull) { return make('ConditionalAccessExpression', [expression, operatorToken, whenNotNull]); },
  memberBindingExpression(operatorToken, name) { return make('MemberBindingExpression', [operatorToken, name]); },
  elementBindingExpression(argumentList) { return make('ElementBindingExpression', [argumentList]); },
  rangeExpression(leftOperand, operatorToken, rightOperand) { return make('RangeExpression', [leftOperand, operatorToken, rightOperand]); },
  implicitElementAccess(argumentList) { return make('ImplicitElementAccess', [argumentList]); },
  binaryExpression(kind, left, operatorToken, right) { return make(kind, [left, operatorToken, right]); },
  assignmentExpression(kind, left, operatorToken, right) { return make(kind, [left, operatorToken, right]); },
  conditionalExpression(condition, questionToken, whenTrue, colonToken, whenFalse) { return make('ConditionalExpression', [condition, questionToken, whenTrue, colonToken, whenFalse]); },
  thisExpression(token) { return make('ThisExpression', [token]); },
  baseExpression(token) { return make('BaseExpression', [token]); },
  literalExpression(kind, token) { return make(kind, [token]); },
  fieldExpression(token) { return make('FieldExpression', [token]); },
  makeRefExpression(keyword, openParenToken, expression, closeParenToken) { return make('MakeRefExpression', [keyword, openParenToken, expression, closeParenToken]); },
  refTypeExpression(keyword, openParenToken, expression, closeParenToken) { return make('RefTypeExpression', [keyword, openParenToken, expression, closeParenToken]); },
  refValueExpression(keyword, openParenToken, expression, comma, type, closeParenToken) { return make('RefValueExpression', [keyword, openParenToken, expression, comma, type, closeParenToken]); },
  typeOfExpression(keyword, openParenToken, type, closeParenToken) { return make('TypeOfExpression', [keyword, openParenToken, type, closeParenToken]); },
  sizeOfExpression(keyword, openParenToken, type, closeParenToken) { return make('SizeOfExpression', [keyword, openParenToken, type, closeParenToken]); },
  defaultExpression(keyword, openParenToken, type, closeParenToken) { return make('DefaultExpression', [keyword, openParenToken, type, closeParenToken]); },
  checkedExpression(kind, keyword, openParenToken, expression, closeParenToken) { return make(kind, [keyword, openParenToken, expression, closeParenToken]); },
  invocationExpression(expression, argumentList) { return make('InvocationExpression', [expression, argumentList]); },
  elementAccessExpression(expression, argumentList) { return make('ElementAccessExpression', [expression, argumentList]); },
  argumentList(openParenToken, arguments_, closeParenToken) { return make('ArgumentList', [openParenToken, arguments_, closeParenToken]); },
  bracketedArgumentList(openBracketToken, arguments_, closeBracketToken) { return make('BracketedArgumentList', [openBracketToken, arguments_, closeBracketToken]); },
  argument(nameColon, refKindKeyword, expression) { return make('Argument', [nameColon, refKindKeyword, expression]); },
  expressionColon(expression, colonToken) { return make('ExpressionColon', [expression, colonToken]); },
  nameColon(name, colonToken) { return make('NameColon', [name, colonToken]); },
  declarationExpression(type, designation) { return make('DeclarationExpression', [type, designation]); },
  castExpression(openParenToken, type, closeParenToken, expression) { return make('CastExpression', [openParenToken, type, closeParenToken, expression]); },
  anonymousMethodExpression(modifiers, delegateKeyword, parameterList, block, expressionBody) { return make('AnonymousMethodExpression', [modifiers, delegateKeyword, parameterList, block, expressionBody]); },
  simpleLambdaExpression(attributeLists, modifiers, parameter, arrowToken, block, expressionBody) { return make('SimpleLambdaExpression', [attributeLists, modifiers, parameter, arrowToken, block, expressionBody]); },
  refExpression(refKeyword, expression) { return make('RefExpression', [refKeyword, expression]); },
  parenthesizedLambdaExpression(attributeLists, modifiers, returnType, parameterList, arrowToken, block, expressionBody) { return make('ParenthesizedLambdaExpression', [attributeLists, modifiers, returnType, parameterList, arrowToken, block, expressionBody]); },
  initializerExpression(kind, openBraceToken, expressions, closeBraceToken) { return make(kind, [openBraceToken, expressions, closeBraceToken]); },
  implicitObjectCreationExpression(newKeyword, argumentList, initializer) { return make('ImplicitObjectCreationExpression', [newKeyword, argumentList, initializer]); },
  objectCreationExpression(newKeyword, type, argumentList, initializer) { return make('ObjectCreationExpression', [newKeyword, type, argumentList, initializer]); },
  withExpression(expression, withKeyword, initializer) { return make('WithExpression', [expression, withKeyword, initializer]); },
  anonymousObjectMemberDeclarator(nameEquals, expression) { return make('AnonymousObjectMemberDeclarator', [nameEquals, expression]); },
  anonymousObjectCreationExpression(newKeyword, openBraceToken, initializers, closeBraceToken) { return make('AnonymousObjectCreationExpression', [newKeyword, openBraceToken, initializers, closeBraceToken]); },
  arrayCreationExpression(newKeyword, type, initializer) { return make('ArrayCreationExpression', [newKeyword, type, initializer]); },
  implicitArrayCreationExpression(newKeyword, openBracketToken, commas, closeBracketToken, initializer) { return make('ImplicitArrayCreationExpression', [newKeyword, openBracketToken, commas, closeBracketToken, initializer]); },
  stackAllocArrayCreationExpression(stackAllocKeyword, type, initializer) { return make('StackAllocArrayCreationExpression', [stackAllocKeyword, type, initializer]); },
  implicitStackAllocArrayCreationExpression(stackAllocKeyword, openBracketToken, closeBracketToken, initializer) { return make('ImplicitStackAllocArrayCreationExpression', [stackAllocKeyword, openBracketToken, closeBracketToken, initializer]); },
  collectionExpression(openBracketToken, elements, closeBracketToken) { return make('CollectionExpression', [openBracketToken, elements, closeBracketToken]); },
  expressionElement(expression) { return make('ExpressionElement', [expression]); },
  spreadElement(operatorToken, expression) { return make('SpreadElement', [operatorToken, expression]); },
  withElement(withKeyword, argumentList) { return make('WithElement', [withKeyword, argumentList]); },
  queryExpression(fromClause, body) { return make('QueryExpression', [fromClause, body]); },
  queryBody(clauses, selectOrGroup, continuation) { return make('QueryBody', [clauses, selectOrGroup, continuation]); },
  fromClause(fromKeyword, type, identifier, inKeyword, expression) { return make('FromClause', [fromKeyword, type, identifier, inKeyword, expression]); },
  letClause(letKeyword, identifier, equalsToken, expression) { return make('LetClause', [letKeyword, identifier, equalsToken, expression]); },
  joinClause(joinKeyword, type, identifier, inKeyword, inExpression, onKeyword, leftExpression, equalsKeyword, rightExpression, into) { return make('JoinClause', [joinKeyword, type, identifier, inKeyword, inExpression, onKeyword, leftExpression, equalsKeyword, rightExpression, into]); },
  joinIntoClause(intoKeyword, identifier) { return make('JoinIntoClause', [intoKeyword, identifier]); },
  whereClause(whereKeyword, condition) { return make('WhereClause', [whereKeyword, condition]); },
  orderByClause(orderByKeyword, orderings) { return make('OrderByClause', [orderByKeyword, orderings]); },
  ordering(kind, expression, ascendingOrDescendingKeyword) { return make(kind, [expression, ascendingOrDescendingKeyword]); },
  selectClause(selectKeyword, expression) { return make('SelectClause', [selectKeyword, expression]); },
  groupClause(groupKeyword, groupExpression, byKeyword, byExpression) { return make('GroupClause', [groupKeyword, groupExpression, byKeyword, byExpression]); },
  queryContinuation(intoKeyword, identifier, body) { return make('QueryContinuation', [intoKeyword, identifier, body]); },
  omittedArraySizeExpression(omittedArraySizeExpressionToken) { return make('OmittedArraySizeExpression', [omittedArraySizeExpressionToken]); },
  interpolatedStringExpression(stringStartToken, contents, stringEndToken) { return make('InterpolatedStringExpression', [stringStartToken, contents, stringEndToken]); },
  interpolatedStringText(textToken) { return make('InterpolatedStringText', [textToken]); },
  interpolation(openBraceToken, expression, alignmentClause, formatClause, closeBraceToken) { return make('Interpolation', [openBraceToken, expression, alignmentClause, formatClause, closeBraceToken]); },
  interpolationAlignmentClause(commaToken, value) { return make('InterpolationAlignmentClause', [commaToken, value]); },
  interpolationFormatClause(colonToken, formatStringToken) { return make('InterpolationFormatClause', [colonToken, formatStringToken]); },
  isPatternExpression(expression, isKeyword, pattern) { return make('IsPatternExpression', [expression, isKeyword, pattern]); },
  throwExpression(throwKeyword, expression) { return make('ThrowExpression', [throwKeyword, expression]); },
  whenClause(whenKeyword, condition) { return make('WhenClause', [whenKeyword, condition]); },
  switchExpression(governingExpression, switchKeyword, openBraceToken, arms, closeBraceToken) { return make('SwitchExpression', [governingExpression, switchKeyword, openBraceToken, arms, closeBraceToken]); },
  switchExpressionArm(pattern, whenClause, equalsGreaterThanToken, expression) { return make('SwitchExpressionArm', [pattern, whenClause, equalsGreaterThanToken, expression]); },
  discardPattern(underscoreToken) { return make('DiscardPattern', [underscoreToken]); },
  declarationPattern(type, designation) { return make('DeclarationPattern', [type, designation]); },
  varPattern(varKeyword, designation) { return make('VarPattern', [varKeyword, designation]); },
  recursivePattern(type, positionalPatternClause, propertyPatternClause, designation) { return make('RecursivePattern', [type, positionalPatternClause, propertyPatternClause, designation]); },
  positionalPatternClause(openParenToken, subpatterns, closeParenToken) { return make('PositionalPatternClause', [openParenToken, subpatterns, closeParenToken]); },
  propertyPatternClause(openBraceToken, subpatterns, closeBraceToken) { return make('PropertyPatternClause', [openBraceToken, subpatterns, closeBraceToken]); },
  subpattern(expressionColon, pattern) { return make('Subpattern', [expressionColon, pattern]); },
  constantPattern(expression) { return make('ConstantPattern', [expression]); },
  parenthesizedPattern(openParenToken, pattern, closeParenToken) { return make('ParenthesizedPattern', [openParenToken, pattern, closeParenToken]); },
  relationalPattern(operatorToken, expression) { return make('RelationalPattern', [operatorToken, expression]); },
  typePattern(type) { return make('TypePattern', [type]); },
  binaryPattern(kind, left, operatorToken, right) { return make(kind, [left, operatorToken, right]); },
  unaryPattern(operatorToken, pattern) { return make('NotPattern', [operatorToken, pattern]); },
  listPattern(openBracketToken, patterns, closeBracketToken, designation) { return make('ListPattern', [openBracketToken, patterns, closeBracketToken, designation]); },
  slicePattern(dotDotToken, pattern) { return make('SlicePattern', [dotDotToken, pattern]); },
  singleVariableDesignation(identifier) { return make('SingleVariableDesignation', [identifier]); },
  discardDesignation(underscoreToken) { return make('DiscardDesignation', [underscoreToken]); },
  parenthesizedVariableDesignation(openParenToken, variables, closeParenToken) { return make('ParenthesizedVariableDesignation', [openParenToken, variables, closeParenToken]); },
  block(attributeLists, openBraceToken, statements, closeBraceToken) { return make('Block', [attributeLists, openBraceToken, statements, closeBraceToken]); },
  localFunctionStatement(attributeLists, modifiers, returnType, identifier, typeParameterList, parameterList, constraintClauses, body, expressionBody, semicolonToken) { return make('LocalFunctionStatement', [attributeLists, modifiers, returnType, identifier, typeParameterList, parameterList, constraintClauses, body, expressionBody, semicolonToken]); },
  localDeclarationStatement(attributeLists, awaitKeyword, usingKeyword, modifiers, declaration, semicolonToken) { return make('LocalDeclarationStatement', [attributeLists, awaitKeyword, usingKeyword, modifiers, declaration, semicolonToken]); },
  variableDeclaration(type, variables) { return make('VariableDeclaration', [type, variables]); },
  variableDeclarator(identifier, argumentList, initializer) { return make('VariableDeclarator', [identifier, argumentList, initializer]); },
  equalsValueClause(equalsToken, value) { return make('EqualsValueClause', [equalsToken, value]); },
  expressionStatement(attributeLists, expression, semicolonToken) { return make('ExpressionStatement', [attributeLists, expression, semicolonToken]); },
  emptyStatement(attributeLists, semicolonToken) { return make('EmptyStatement', [attributeLists, semicolonToken]); },
  labeledStatement(attributeLists, identifier, colonToken, statement) { return make('LabeledStatement', [attributeLists, identifier, colonToken, statement]); },
  gotoStatement(kind, attributeLists, gotoKeyword, caseOrDefaultKeyword, expression, semicolonToken) { return make(kind, [attributeLists, gotoKeyword, caseOrDefaultKeyword, expression, semicolonToken]); },
  breakStatement(attributeLists, breakKeyword, label, semicolonToken) { return make('BreakStatement', [attributeLists, breakKeyword, label, semicolonToken]); },
  continueStatement(attributeLists, continueKeyword, label, semicolonToken) { return make('ContinueStatement', [attributeLists, continueKeyword, label, semicolonToken]); },
  returnStatement(attributeLists, returnKeyword, expression, semicolonToken) { return make('ReturnStatement', [attributeLists, returnKeyword, expression, semicolonToken]); },
  throwStatement(attributeLists, throwKeyword, expression, semicolonToken) { return make('ThrowStatement', [attributeLists, throwKeyword, expression, semicolonToken]); },
  yieldStatement(kind, attributeLists, yieldKeyword, returnOrBreakKeyword, expression, semicolonToken) { return make(kind, [attributeLists, yieldKeyword, returnOrBreakKeyword, expression, semicolonToken]); },
  whileStatement(attributeLists, whileKeyword, openParenToken, condition, closeParenToken, statement) { return make('WhileStatement', [attributeLists, whileKeyword, openParenToken, condition, closeParenToken, statement]); },
  doStatement(attributeLists, doKeyword, statement, whileKeyword, openParenToken, condition, closeParenToken, semicolonToken) { return make('DoStatement', [attributeLists, doKeyword, statement, whileKeyword, openParenToken, condition, closeParenToken, semicolonToken]); },
  forStatement(attributeLists, forKeyword, openParenToken, declaration, initializers, firstSemicolonToken, condition, secondSemicolonToken, incrementors, closeParenToken, statement) { return make('ForStatement', [attributeLists, forKeyword, openParenToken, declaration, initializers, firstSemicolonToken, condition, secondSemicolonToken, incrementors, closeParenToken, statement]); },
  forEachStatement(attributeLists, awaitKeyword, forEachKeyword, openParenToken, type, identifier, inKeyword, expression, closeParenToken, statement) { return make('ForEachStatement', [attributeLists, awaitKeyword, forEachKeyword, openParenToken, type, identifier, inKeyword, expression, closeParenToken, statement]); },
  forEachVariableStatement(attributeLists, awaitKeyword, forEachKeyword, openParenToken, variable, inKeyword, expression, closeParenToken, statement) { return make('ForEachVariableStatement', [attributeLists, awaitKeyword, forEachKeyword, openParenToken, variable, inKeyword, expression, closeParenToken, statement]); },
  usingStatement(attributeLists, awaitKeyword, usingKeyword, openParenToken, declaration, expression, closeParenToken, statement) { return make('UsingStatement', [attributeLists, awaitKeyword, usingKeyword, openParenToken, declaration, expression, closeParenToken, statement]); },
  fixedStatement(attributeLists, fixedKeyword, openParenToken, declaration, closeParenToken, statement) { return make('FixedStatement', [attributeLists, fixedKeyword, openParenToken, declaration, closeParenToken, statement]); },
  checkedStatement(kind, attributeLists, keyword, block) { return make(kind, [attributeLists, keyword, block]); },
  unsafeStatement(attributeLists, unsafeKeyword, block) { return make('UnsafeStatement', [attributeLists, unsafeKeyword, block]); },
  lockStatement(attributeLists, lockKeyword, openParenToken, expression, closeParenToken, statement) { return make('LockStatement', [attributeLists, lockKeyword, openParenToken, expression, closeParenToken, statement]); },
  ifStatement(attributeLists, ifKeyword, openParenToken, condition, closeParenToken, statement, else_) { return make('IfStatement', [attributeLists, ifKeyword, openParenToken, condition, closeParenToken, statement, else_]); },
  elseClause(elseKeyword, statement) { return make('ElseClause', [elseKeyword, statement]); },
  switchStatement(attributeLists, switchKeyword, openParenToken, expression, closeParenToken, openBraceToken, sections, closeBraceToken) { return make('SwitchStatement', [attributeLists, switchKeyword, openParenToken, expression, closeParenToken, openBraceToken, sections, closeBraceToken]); },
  switchSection(labels, statements) { return make('SwitchSection', [labels, statements]); },
  casePatternSwitchLabel(keyword, pattern, whenClause, colonToken) { return make('CasePatternSwitchLabel', [keyword, pattern, whenClause, colonToken]); },
  caseSwitchLabel(keyword, value, colonToken) { return make('CaseSwitchLabel', [keyword, value, colonToken]); },
  defaultSwitchLabel(keyword, colonToken) { return make('DefaultSwitchLabel', [keyword, colonToken]); },
  tryStatement(attributeLists, tryKeyword, block, catches, finally_) { return make('TryStatement', [attributeLists, tryKeyword, block, catches, finally_]); },
  catchClause(catchKeyword, declaration, filter, block) { return make('CatchClause', [catchKeyword, declaration, filter, block]); },
  catchDeclaration(openParenToken, type, identifier, closeParenToken) { return make('CatchDeclaration', [openParenToken, type, identifier, closeParenToken]); },
  catchFilterClause(whenKeyword, openParenToken, filterExpression, closeParenToken) { return make('CatchFilterClause', [whenKeyword, openParenToken, filterExpression, closeParenToken]); },
  finallyClause(finallyKeyword, block) { return make('FinallyClause', [finallyKeyword, block]); },
  documentationCommentTrivia(kind, content, endOfComment) { return make(kind, [content, endOfComment]); },
  xmlElement(startTag, content, endTag) { return make('XmlElement', [startTag, content, endTag]); },
  xmlElementStartTag(lessThanToken, name, attributes, greaterThanToken) { return make('XmlElementStartTag', [lessThanToken, name, attributes, greaterThanToken]); },
  xmlElementEndTag(lessThanSlashToken, name, greaterThanToken) { return make('XmlElementEndTag', [lessThanSlashToken, name, greaterThanToken]); },
  xmlEmptyElement(lessThanToken, name, attributes, slashGreaterThanToken) { return make('XmlEmptyElement', [lessThanToken, name, attributes, slashGreaterThanToken]); },
  xmlName(prefix, localName) { return make('XmlName', [prefix, localName]); },
  xmlPrefix(prefix, colonToken) { return make('XmlPrefix', [prefix, colonToken]); },
  xmlTextAttribute(name, equalsToken, startQuoteToken, textTokens, endQuoteToken) { return make('XmlTextAttribute', [name, equalsToken, startQuoteToken, textTokens, endQuoteToken]); },
  xmlCrefAttribute(name, equalsToken, startQuoteToken, cref, endQuoteToken) { return make('XmlCrefAttribute', [name, equalsToken, startQuoteToken, cref, endQuoteToken]); },
  xmlNameAttribute(name, equalsToken, startQuoteToken, identifier, endQuoteToken) { return make('XmlNameAttribute', [name, equalsToken, startQuoteToken, identifier, endQuoteToken]); },
  xmlText(textTokens) { return make('XmlText', [textTokens]); },
  xmlCDataSection(startCDataToken, textTokens, endCDataToken) { return make('XmlCDataSection', [startCDataToken, textTokens, endCDataToken]); },
  xmlProcessingInstruction(startProcessingInstructionToken, name, textTokens, endProcessingInstructionToken) { return make('XmlProcessingInstruction', [startProcessingInstructionToken, name, textTokens, endProcessingInstructionToken]); },
  xmlComment(lessThanExclamationMinusMinusToken, textTokens, minusMinusGreaterThanToken) { return make('XmlComment', [lessThanExclamationMinusMinusToken, textTokens, minusMinusGreaterThanToken]); },
  typeCref(type) { return make('TypeCref', [type]); },
  qualifiedCref(container, dotToken, member) { return make('QualifiedCref', [container, dotToken, member]); },
  nameMemberCref(name, parameters) { return make('NameMemberCref', [name, parameters]); },
  indexerMemberCref(thisKeyword, parameters) { return make('IndexerMemberCref', [thisKeyword, parameters]); },
  operatorMemberCref(operatorKeyword, checkedKeyword, operatorToken, parameters) { return make('OperatorMemberCref', [operatorKeyword, checkedKeyword, operatorToken, parameters]); },
  conversionOperatorMemberCref(implicitOrExplicitKeyword, operatorKeyword, checkedKeyword, type, parameters) { return make('ConversionOperatorMemberCref', [implicitOrExplicitKeyword, operatorKeyword, checkedKeyword, type, parameters]); },
  crefParameterList(kind, openToken, parameters, closeToken) { return make(kind, [openToken, parameters, closeToken]); },
  crefParameter(refKindKeyword, readOnlyKeyword, type) { return make('CrefParameter', [refKindKeyword, readOnlyKeyword, type]); },
  extensionBlockDeclaration(attributeLists, modifiers, keyword, typeParameterList, parameterList, constraintClauses, openBraceToken, members, closeBraceToken, semicolonToken) { return make('ExtensionBlockDeclaration', [attributeLists, modifiers, keyword, typeParameterList, parameterList, constraintClauses, openBraceToken, members, closeBraceToken, semicolonToken]); },
  unionDeclaration(attributeLists, modifiers, keyword, identifier, typeParameterList, caseTypes, baseList, constraintClauses, openBraceToken, members, closeBraceToken, semicolonToken) { return make('UnionDeclaration', [attributeLists, modifiers, keyword, identifier, typeParameterList, caseTypes, baseList, constraintClauses, openBraceToken, members, closeBraceToken, semicolonToken]); },
  unionCaseTypeList(openParenToken, types, closeParenToken) { return make('UnionCaseTypeList', [openParenToken, types, closeParenToken]); },
  unsafeExpression(unsafeKeyword, openParenToken, expression, closeParenToken) { return make('UnsafeExpression', [unsafeKeyword, openParenToken, expression, closeParenToken]); }
});
