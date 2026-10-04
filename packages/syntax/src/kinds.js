/**
 * SyntaxKind enumeration: token, trivia and node kinds named after Roslyn's SyntaxKind members.
 * Numeric ids are frozen (tests/fixtures snapshot): the lists below are append-only, never reorder or remove an entry.
 */
export const tokenKindNames = Object.freeze([
  'TildeToken', 'ExclamationToken', 'DollarToken', 'PercentToken', 'CaretToken', 'AmpersandToken', 'AsteriskToken', 'OpenParenToken',
  'CloseParenToken', 'MinusToken', 'PlusToken', 'EqualsToken', 'OpenBraceToken', 'CloseBraceToken', 'OpenBracketToken', 'CloseBracketToken',
  'BarToken', 'BackslashToken', 'ColonToken', 'SemicolonToken', 'DoubleQuoteToken', 'SingleQuoteToken', 'LessThanToken', 'CommaToken',
  'GreaterThanToken', 'DotToken', 'QuestionToken', 'HashToken', 'SlashToken', 'DotDotToken', 'BarBarToken', 'AmpersandAmpersandToken',
  'MinusMinusToken', 'PlusPlusToken', 'ColonColonToken', 'QuestionQuestionToken', 'MinusGreaterThanToken', 'ExclamationEqualsToken',
  'EqualsEqualsToken', 'EqualsGreaterThanToken', 'LessThanEqualsToken', 'LessThanLessThanToken', 'LessThanLessThanEqualsToken',
  'GreaterThanEqualsToken', 'GreaterThanGreaterThanToken', 'GreaterThanGreaterThanEqualsToken', 'SlashEqualsToken', 'AsteriskEqualsToken',
  'BarEqualsToken', 'AmpersandEqualsToken', 'PlusEqualsToken', 'MinusEqualsToken', 'CaretEqualsToken', 'PercentEqualsToken',
  'QuestionQuestionEqualsToken', 'GreaterThanGreaterThanGreaterThanToken', 'GreaterThanGreaterThanGreaterThanEqualsToken', 'AbstractKeyword',
  'AsKeyword', 'BaseKeyword', 'BoolKeyword', 'BreakKeyword', 'ByteKeyword', 'CaseKeyword', 'CatchKeyword', 'CharKeyword', 'CheckedKeyword',
  'ClassKeyword', 'ConstKeyword', 'ContinueKeyword', 'DecimalKeyword', 'DefaultKeyword', 'DelegateKeyword', 'DoKeyword', 'DoubleKeyword',
  'ElseKeyword', 'EnumKeyword', 'EventKeyword', 'ExplicitKeyword', 'ExternKeyword', 'FalseKeyword', 'FinallyKeyword', 'FixedKeyword', 'FloatKeyword',
  'ForKeyword', 'ForEachKeyword', 'GotoKeyword', 'IfKeyword', 'ImplicitKeyword', 'InKeyword', 'IntKeyword', 'InterfaceKeyword', 'InternalKeyword',
  'IsKeyword', 'LockKeyword', 'LongKeyword', 'NamespaceKeyword', 'NewKeyword', 'NullKeyword', 'ObjectKeyword', 'OperatorKeyword', 'OutKeyword',
  'OverrideKeyword', 'ParamsKeyword', 'PrivateKeyword', 'ProtectedKeyword', 'PublicKeyword', 'ReadOnlyKeyword', 'RefKeyword', 'ReturnKeyword',
  'SByteKeyword', 'SealedKeyword', 'ShortKeyword', 'SizeOfKeyword', 'StackAllocKeyword', 'StaticKeyword', 'StringKeyword', 'StructKeyword',
  'SwitchKeyword', 'ThisKeyword', 'ThrowKeyword', 'TrueKeyword', 'TryKeyword', 'TypeOfKeyword', 'UIntKeyword', 'ULongKeyword', 'UncheckedKeyword',
  'UnsafeKeyword', 'UShortKeyword', 'UsingKeyword', 'VirtualKeyword', 'VoidKeyword', 'VolatileKeyword', 'WhileKeyword', 'ArgListKeyword',
  'MakeRefKeyword', 'RefTypeKeyword', 'RefValueKeyword', 'YieldKeyword', 'PartialKeyword', 'AliasKeyword', 'GlobalKeyword', 'AssemblyKeyword',
  'ModuleKeyword', 'TypeKeyword', 'FieldKeyword', 'MethodKeyword', 'ParamKeyword', 'PropertyKeyword', 'TypeVarKeyword', 'GetKeyword', 'SetKeyword',
  'AddKeyword', 'RemoveKeyword', 'WhereKeyword', 'FromKeyword', 'GroupKeyword', 'JoinKeyword', 'IntoKeyword', 'LetKeyword', 'ByKeyword',
  'SelectKeyword', 'OrderByKeyword', 'OnKeyword', 'EqualsKeyword', 'AscendingKeyword', 'DescendingKeyword', 'NameOfKeyword', 'AsyncKeyword',
  'AwaitKeyword', 'WhenKeyword', 'OrKeyword', 'AndKeyword', 'NotKeyword', 'WithKeyword', 'InitKeyword', 'RecordKeyword', 'ManagedKeyword',
  'UnmanagedKeyword', 'RequiredKeyword', 'ScopedKeyword', 'FileKeyword', 'AllowsKeyword', 'ExtensionKeyword', 'VarKeyword', 'UnderscoreToken',
  'ElifKeyword', 'EndIfKeyword', 'RegionKeyword', 'EndRegionKeyword', 'DefineKeyword', 'UndefKeyword', 'WarningKeyword', 'ErrorKeyword',
  'LineKeyword', 'PragmaKeyword', 'HiddenKeyword', 'ChecksumKeyword', 'DisableKeyword', 'RestoreKeyword', 'ReferenceKeyword', 'LoadKeyword',
  'NullableKeyword', 'EnableKeyword', 'WarningsKeyword', 'AnnotationsKeyword', 'OmittedTypeArgumentToken', 'OmittedArraySizeExpressionToken',
  'EndOfDirectiveToken', 'EndOfDocumentationCommentToken', 'EndOfFileToken', 'BadToken', 'IdentifierToken', 'NumericLiteralToken',
  'CharacterLiteralToken', 'StringLiteralToken', 'XmlEntityLiteralToken', 'XmlTextLiteralToken', 'XmlTextLiteralNewLineToken',
  'InterpolatedStringToken', 'InterpolatedStringTextToken', 'SingleLineRawStringLiteralToken', 'MultiLineRawStringLiteralToken',
  'Utf8StringLiteralToken', 'Utf8SingleLineRawStringLiteralToken', 'Utf8MultiLineRawStringLiteralToken', 'InterpolatedStringStartToken',
  'InterpolatedStringEndToken', 'InterpolatedVerbatimStringStartToken', 'InterpolatedSingleLineRawStringStartToken',
  'InterpolatedMultiLineRawStringStartToken', 'InterpolatedRawStringEndToken', 'LessThanSlashToken', 'SlashGreaterThanToken', 'XmlCommentStartToken',
  'XmlCommentEndToken', 'XmlCDataStartToken', 'XmlCDataEndToken', 'XmlProcessingInstructionStartToken', 'XmlProcessingInstructionEndToken',
  'UnionKeyword', 'ClosedKeyword', 'SafeKeyword'
]);
export const triviaKindNames = Object.freeze([
  'EndOfLineTrivia', 'WhitespaceTrivia', 'SingleLineCommentTrivia', 'MultiLineCommentTrivia', 'DocumentationCommentExteriorTrivia',
  'SingleLineDocumentationCommentTrivia', 'MultiLineDocumentationCommentTrivia', 'DisabledTextTrivia', 'PreprocessingMessageTrivia',
  'IfDirectiveTrivia', 'ElifDirectiveTrivia', 'ElseDirectiveTrivia', 'EndIfDirectiveTrivia', 'RegionDirectiveTrivia', 'EndRegionDirectiveTrivia',
  'DefineDirectiveTrivia', 'UndefDirectiveTrivia', 'ErrorDirectiveTrivia', 'WarningDirectiveTrivia', 'LineDirectiveTrivia',
  'PragmaWarningDirectiveTrivia', 'PragmaChecksumDirectiveTrivia', 'ReferenceDirectiveTrivia', 'BadDirectiveTrivia', 'SkippedTokensTrivia',
  'ConflictMarkerTrivia', 'LoadDirectiveTrivia', 'ShebangDirectiveTrivia', 'NullableDirectiveTrivia', 'LineSpanDirectiveTrivia',
  'IgnoredDirectiveTrivia'
]);
export const nodeKindNames = Object.freeze([
  'SyntaxList', 'CompilationUnit', 'ExternAliasDirective', 'UsingDirective', 'NameEquals', 'NamespaceDeclaration', 'FileScopedNamespaceDeclaration',
  'AttributeList', 'AttributeTargetSpecifier', 'Attribute', 'AttributeArgumentList', 'AttributeArgument', 'GlobalStatement', 'TypeParameterList',
  'TypeParameter', 'ClassDeclaration', 'StructDeclaration', 'InterfaceDeclaration', 'RecordDeclaration', 'RecordStructDeclaration', 'EnumDeclaration',
  'DelegateDeclaration', 'EnumMemberDeclaration', 'BaseList', 'SimpleBaseType', 'PrimaryConstructorBaseType', 'TypeParameterConstraintClause',
  'ConstructorConstraint', 'ClassConstraint', 'StructConstraint', 'TypeConstraint', 'DefaultConstraint', 'AllowsConstraintClause',
  'RefStructConstraint', 'FieldDeclaration', 'EventFieldDeclaration', 'ExplicitInterfaceSpecifier', 'MethodDeclaration', 'OperatorDeclaration',
  'ConversionOperatorDeclaration', 'ConstructorDeclaration', 'BaseConstructorInitializer', 'ThisConstructorInitializer', 'DestructorDeclaration',
  'PropertyDeclaration', 'ArrowExpressionClause', 'EventDeclaration', 'IndexerDeclaration', 'AccessorList', 'GetAccessorDeclaration',
  'SetAccessorDeclaration', 'InitAccessorDeclaration', 'AddAccessorDeclaration', 'RemoveAccessorDeclaration', 'UnknownAccessorDeclaration',
  'ParameterList', 'BracketedParameterList', 'Parameter', 'IncompleteMember', 'IdentifierName', 'QualifiedName', 'GenericName', 'TypeArgumentList',
  'AliasQualifiedName', 'PredefinedType', 'ArrayType', 'ArrayRankSpecifier', 'PointerType', 'FunctionPointerType', 'FunctionPointerParameterList',
  'FunctionPointerCallingConvention', 'FunctionPointerUnmanagedCallingConventionList', 'FunctionPointerUnmanagedCallingConvention',
  'FunctionPointerParameter', 'NullableType', 'TupleType', 'TupleElement', 'OmittedTypeArgument', 'RefType', 'ScopedType', 'ParenthesizedExpression',
  'TupleExpression', 'UnaryPlusExpression', 'UnaryMinusExpression', 'BitwiseNotExpression', 'LogicalNotExpression', 'PreIncrementExpression',
  'PreDecrementExpression', 'AddressOfExpression', 'PointerIndirectionExpression', 'IndexExpression', 'AwaitExpression', 'PostIncrementExpression',
  'PostDecrementExpression', 'SuppressNullableWarningExpression', 'SimpleMemberAccessExpression', 'PointerMemberAccessExpression',
  'ConditionalAccessExpression', 'MemberBindingExpression', 'ElementBindingExpression', 'RangeExpression', 'ImplicitElementAccess', 'AddExpression',
  'SubtractExpression', 'MultiplyExpression', 'DivideExpression', 'ModuloExpression', 'LeftShiftExpression', 'RightShiftExpression',
  'UnsignedRightShiftExpression', 'LogicalOrExpression', 'LogicalAndExpression', 'BitwiseOrExpression', 'BitwiseAndExpression',
  'ExclusiveOrExpression', 'EqualsExpression', 'NotEqualsExpression', 'LessThanExpression', 'LessThanOrEqualExpression', 'GreaterThanExpression',
  'GreaterThanOrEqualExpression', 'IsExpression', 'AsExpression', 'CoalesceExpression', 'SimpleAssignmentExpression', 'AddAssignmentExpression',
  'SubtractAssignmentExpression', 'MultiplyAssignmentExpression', 'DivideAssignmentExpression', 'ModuloAssignmentExpression',
  'AndAssignmentExpression', 'ExclusiveOrAssignmentExpression', 'OrAssignmentExpression', 'LeftShiftAssignmentExpression',
  'RightShiftAssignmentExpression', 'UnsignedRightShiftAssignmentExpression', 'CoalesceAssignmentExpression', 'ConditionalExpression',
  'ThisExpression', 'BaseExpression', 'NumericLiteralExpression', 'StringLiteralExpression', 'Utf8StringLiteralExpression',
  'CharacterLiteralExpression', 'TrueLiteralExpression', 'FalseLiteralExpression', 'NullLiteralExpression', 'DefaultLiteralExpression',
  'ArgListExpression', 'FieldExpression', 'TypeOfExpression', 'SizeOfExpression', 'DefaultExpression', 'CheckedExpression', 'UncheckedExpression',
  'InvocationExpression', 'ElementAccessExpression', 'ArgumentList', 'BracketedArgumentList', 'Argument', 'ExpressionColon', 'NameColon',
  'DeclarationExpression', 'CastExpression', 'AnonymousMethodExpression', 'SimpleLambdaExpression', 'RefExpression', 'ParenthesizedLambdaExpression',
  'ObjectInitializerExpression', 'CollectionInitializerExpression', 'ArrayInitializerExpression', 'ComplexElementInitializerExpression',
  'WithInitializerExpression', 'ImplicitObjectCreationExpression', 'ObjectCreationExpression', 'WithExpression', 'AnonymousObjectMemberDeclarator',
  'AnonymousObjectCreationExpression', 'ArrayCreationExpression', 'ImplicitArrayCreationExpression', 'StackAllocArrayCreationExpression',
  'ImplicitStackAllocArrayCreationExpression', 'CollectionExpression', 'ExpressionElement', 'SpreadElement', 'WithElement', 'QueryExpression',
  'QueryBody', 'FromClause', 'LetClause', 'JoinClause', 'JoinIntoClause', 'WhereClause', 'OrderByClause', 'AscendingOrdering', 'DescendingOrdering',
  'SelectClause', 'GroupClause', 'QueryContinuation', 'OmittedArraySizeExpression', 'InterpolatedStringExpression', 'InterpolatedStringText',
  'Interpolation', 'InterpolationAlignmentClause', 'InterpolationFormatClause', 'IsPatternExpression', 'ThrowExpression', 'WhenClause',
  'SwitchExpression', 'SwitchExpressionArm', 'DiscardPattern', 'DeclarationPattern', 'VarPattern', 'RecursivePattern', 'PositionalPatternClause',
  'PropertyPatternClause', 'Subpattern', 'ConstantPattern', 'ParenthesizedPattern', 'RelationalPattern', 'TypePattern', 'OrPattern', 'AndPattern',
  'NotPattern', 'ListPattern', 'SlicePattern', 'SingleVariableDesignation', 'DiscardDesignation', 'ParenthesizedVariableDesignation', 'Block',
  'LocalFunctionStatement', 'LocalDeclarationStatement', 'VariableDeclaration', 'VariableDeclarator', 'EqualsValueClause', 'ExpressionStatement',
  'EmptyStatement', 'LabeledStatement', 'GotoStatement', 'GotoCaseStatement', 'GotoDefaultStatement', 'BreakStatement', 'ContinueStatement',
  'ReturnStatement', 'ThrowStatement', 'YieldReturnStatement', 'YieldBreakStatement', 'WhileStatement', 'DoStatement', 'ForStatement',
  'ForEachStatement', 'ForEachVariableStatement', 'UsingStatement', 'FixedStatement', 'CheckedStatement', 'UncheckedStatement', 'UnsafeStatement',
  'LockStatement', 'IfStatement', 'ElseClause', 'SwitchStatement', 'SwitchSection', 'CasePatternSwitchLabel', 'CaseSwitchLabel', 'DefaultSwitchLabel',
  'TryStatement', 'CatchClause', 'CatchDeclaration', 'CatchFilterClause', 'FinallyClause', 'XmlElement', 'XmlElementStartTag', 'XmlElementEndTag',
  'XmlEmptyElement', 'XmlName', 'XmlPrefix', 'XmlTextAttribute', 'XmlCrefAttribute', 'XmlNameAttribute', 'XmlText', 'XmlCDataSection', 'XmlComment',
  'XmlProcessingInstruction', 'TypeCref', 'QualifiedCref', 'NameMemberCref', 'IndexerMemberCref', 'OperatorMemberCref',
  'ConversionOperatorMemberCref', 'CrefParameterList', 'CrefBracketedParameterList', 'CrefParameter', 'ExtensionBlockDeclaration', 'UnionDeclaration',
  'UnionCaseTypeList', 'UnsafeExpression',
  'MakeRefExpression', 'RefTypeExpression', 'RefValueExpression'
]);
const bases = [
    [tokenKindNames, 8193],
    [triviaKindNames, 8539],
    [nodeKindNames, 8616]
  ],
  ids = { None: 0 },
  names = new Map([[0, 'None']]);
for (const [list, base] of bases)
  list.forEach((name, index) => {
    ids[name] = base + index;
    names.set(base + index, name);
  });
/** Kind name to frozen numeric id: SyntaxKind.IfStatement, SyntaxKind.OpenBraceToken, ... */
export const SyntaxKind = Object.freeze(ids);
/** The kind name for a numeric id, or undefined. */
export function syntaxKindName(id) {
  return names.get(id);
}
const tokenSet = new Set(tokenKindNames),
  triviaSet = new Set(triviaKindNames),
  nodeSet = new Set(nodeKindNames);
export function isTokenKind(kind) {
  return tokenSet.has(kind);
}
export function isTriviaKind(kind) {
  return triviaSet.has(kind);
}
/** Node kinds, including the two documentation comment kinds, which name both a trivia and its structure node. */
export function isNodeKind(kind) {
  return nodeSet.has(kind) || kind === 'SingleLineDocumentationCommentTrivia' || kind === 'MultiLineDocumentationCommentTrivia';
}
export function isKeywordKind(kind) {
  return tokenSet.has(kind) && kind.endsWith('Keyword');
}
export function isDirectiveKind(kind) {
  return triviaSet.has(kind) && kind.endsWith('DirectiveTrivia');
}
