/**
 * The language feature catalog shared by the parser, the feature gate and the compiler: one row per feature with
 * its id, display name, introducing C# version (7.1-7.3 are distinct; 15 means preview), the Roslyn MessageID where
 * one exists, and the diagnostic reported when the feature is used one language version too low.
 */
const selectedVersionCodes = {
  1: 'CS8022',
  2: 'CS8023',
  3: 'CS8024',
  4: 'CS8025',
  5: 'CS8026',
  6: 'CS8059',
  7: 'CS8107',
  7.1: 'CS8302',
  7.2: 'CS8320',
  7.3: 'CS8370',
  8: 'CS8400',
  9: 'CS8773',
  10: 'CS8936',
  11: 'CS9058',
  12: 'CS9202',
  13: 'CS9260',
  14: 'CS8652'
};
const order = [1, 2, 3, 4, 5, 6, 7, 7.1, 7.2, 7.3, 8, 9, 10, 11, 12, 13, 14, 15];
/** Diagnostic code for "feature is not available in C# <selected>". */
export function featureNotAvailableCode(selectedNumber) {
  return selectedVersionCodes[selectedNumber] ?? 'CS8652';
}
/** Rows are `Id|display name`; ids starting with `-` have no Roslyn MessageID (baseline C# 1 constructs and SharpForge preview features). */
const table = [
  [
    1,
    '-Classes|classes;-Structs|structs;-Interfaces|interfaces;-Enums|enums;-Delegates|delegates;-Namespaces|namespaces;-UsingDirectives|using ' +
      'directives;-UsingAlias|using alias directives;-Fields|fields;-Constants|constants;-Methods|methods;-Properties|properties;-Indexers|indexers;' +
      '-Events|events;-OperatorOverloading|user-defined operators;-ConversionOperators|user-defined conversions;-Constructors|instance constructors;' +
      '-StaticConstructors|static constructors;-Destructors|destructors;-ConstructorInitializers|constructor initializers;-NestedTypes|nested types;' +
      '-Attributes|attributes;ModuleAttrLoc|module as an attribute target specifier;-AttributeTargets|attribute target specifiers;-Inheritance|base ' +
      'type lists;-VirtualMembers|virtual, override and abstract members;-SealedMembers|sealed members;-NewModifier|member hiding with new;' +
      '-ExternMembers|extern members;-VolatileFields|volatile fields;-RefOutParameters|ref and out parameters;-ParamsArrays|params arrays;' +
      '-Arrays|single-dimensional arrays;-MultiDimensionalArrays|multi-dimensional arrays;-JaggedArrays|jagged arrays;-ArrayInitializers|array ' +
      'initializers;-IfStatement|if statement;-SwitchStatement|switch statement;-WhileStatement|while statement;-DoStatement|do statement;' +
      '-ForStatement|for statement;-ForEachStatement|foreach statement;-GotoStatement|goto statement;-LabeledStatement|labeled statements;' +
      '-BreakContinue|break and continue;-ReturnStatement|return statement;-ThrowStatement|throw statement;-TryCatchFinally|try, catch and finally;' +
      '-LockStatement|lock statement;-UsingStatement|using statement;-CheckedUnchecked|checked and unchecked;-UnsafeCode|unsafe code;' +
      '-Pointers|pointer types;-FixedStatement|fixed statement;-StackAlloc|stackalloc;-SizeOf|sizeof;-TypeOf|typeof;-IsAsOperators|is and as ' +
      'operators;-CastExpressions|cast expressions;-ConditionalOperator|conditional operator;-CompoundAssignment|compound assignment;' +
      '-ShiftOperators|shift operators;-VerbatimStrings|verbatim string literals;-VerbatimIdentifiers|verbatim identifiers;-UnicodeEscapes|Unicode ' +
      'escape sequences;-HexLiterals|hexadecimal literals;-RealLiterals|real literals;-DecimalLiterals|decimal literals;-CharLiterals|character ' +
      'literals;-ConditionalCompilation|conditional compilation directives;-RegionDirectives|region directives;-LineDirectives|line directives;' +
      '-DiagnosticDirectives|error and warning directives;-XmlDocComments|XML documentation comments;-ObjectCreation|object creation;' +
      '-DelegateCreation|delegate creation;-LocalConstants|local constants;-MultipleDeclarators|multiple declarators'
  ],
  [
    2,
    'Generics|generics;AnonDelegates|anonymous methods;GlobalNamespace|namespace alias qualifier;FixedBuffer|fixed size buffers;Pragma|#pragma;' +
      'StaticClasses|static classes;PartialTypes|partial types;Nullable|nullable types;Iterators|iterators;Default|default operator;' +
      'PropertyAccessorMods|access modifiers on properties;ExternAlias|extern alias;SwitchOnBool|switch on boolean type;-GenericConstraints|generic ' +
      'constraints;-GenericMethods|generic methods;-NullCoalescing|null coalescing operator;-YieldStatement|yield statement;' +
      '-MethodGroupConversions|method group conversions;-CovarianceForDelegates|delegate covariance and contravariance;-FriendAssemblies|friend ' +
      'assemblies;-PragmaWarning|#pragma warning;-PragmaChecksum|#pragma checksum;-AliasQualifiedNames|alias-qualified names'
  ],
  [
    3,
    'ImplicitArray|implicitly typed array;AnonymousTypes|anonymous types;ObjectInitializer|object initializer;CollectionInitializer|collection ' +
      'initializer;Lambda|lambda expression;QueryExpression|query expression;ExtensionMethod|extension method;PartialMethod|partial method;' +
      'ImplicitLocal|implicitly typed local variable;AutoImplementedProperties|automatically implemented properties;-ExpressionTrees|expression ' +
      'trees;-QueryContinuation|query continuations;-QueryJoin|query join clauses;-QueryGroupBy|query group clauses;-QueryOrderBy|query orderby ' +
      'clauses;-QueryLet|query let clauses'
  ],
  [
    4,
    'TypeVariance|type variance;NamedArgument|named argument;OptionalParameter|optional parameter;Dynamic|dynamic;-EmbeddedInteropTypes|embedded ' +
      'interop types;-IndexedProperties|indexed properties'
  ],
  [5, 'Async|async function;-CallerInfoAttributes|caller info attributes;-AwaitExpression|await expressions'],
  [
    6,
    'ExceptionFilter|exception filter;AutoPropertyInitializer|auto property initializer;NullPropagatingOperator|null propagating operator;' +
      'ExpressionBodiedMethod|expression-bodied method;ExpressionBodiedProperty|expression-bodied property;' +
      'ExpressionBodiedIndexer|expression-bodied indexer;Nameof|nameof operator;DictionaryInitializer|dictionary initializer;UsingStatic|using ' +
      'static;InterpolatedStrings|interpolated strings;-AwaitInCatchAndFinally|await in catch blocks and finally blocks;' +
      'ReadonlyAutoImplementedProperties|readonly automatically implemented properties;-ExtensionAddMethods|extension Add methods in collection ' +
      'initializers;-ParameterlessStructInitializers|improved overload resolution'
  ],
  [
    7,
    'BinaryLiteral|binary literals;DigitSeparator|digit separators;LocalFunctions|local functions;RefLocalsReturns|byref locals and returns;' +
      'PatternMatching|pattern matching;ThrowExpression|throw expression;Tuples|tuples;OutVar|out variable declaration;' +
      'ExpressionBodiedAccessor|expression body property accessor;ExpressionBodiedDeOrConstructor|expression body constructor and destructor;' +
      'Discards|discards;-Deconstruction|deconstruction;-GeneralizedAsyncReturnTypes|generalized async return types;-IsPatternExpression|is pattern ' +
      'expressions;-CaseGuards|case guards'
  ],
  [
    7.1,
    'AsyncMain|async main;DefaultLiteral|default literal;InferredTupleNames|inferred tuple element names;GenericPatternMatching|generic pattern-matching'
  ],
  [
    7.2,
    'LeadingDigitSeparator|leading digit separator;NonTrailingNamedArguments|non-trailing named arguments;PrivateProtected|private protected;' +
      'ReadOnlyReferences|readonly references;RefStructs|ref structs;ReadOnlyStructs|readonly structs;RefExtensionMethods|ref extension methods;' +
      'RefConditional|ref conditional expression'
  ],
  [
    7.3,
    'AttributesOnBackingFields|attributes on backing fields;ImprovedOverloadCandidates|improved overload candidates;RefReassignment|ref ' +
      'reassignment;RefFor|ref for-loop variables;RefForEach|ref foreach iteration variables;EnumGenericTypeConstraint|enum generic type ' +
      'constraints;DelegateGenericTypeConstraint|delegate generic type constraints;UnmanagedGenericTypeConstraint|unmanaged generic type ' +
      'constraints;StackAllocInitializer|stackalloc initializer;TupleEquality|tuple equality;' +
      'ExpressionVariablesInQueriesAndInitializers|declaration of expression variables in member initializers and queries;' +
      'ExtensibleFixedStatement|extensible fixed statement;IndexingMovableFixedBuffers|indexing movable fixed buffers'
  ],
  [
    8,
    'AltInterpolatedVerbatimStrings|alternative interpolated verbatim strings;CoalesceAssignmentExpression|coalescing assignment;' +
      'UnconstrainedTypeParameterInNullCoalescingOperator|unconstrained type parameters in null coalescing operator;' +
      'NotNullGenericTypeConstraint|notnull generic type constraint;IndexOperator|index operator;RangeOperator|range operator;AsyncStreams|async ' +
      'streams;RecursivePatterns|recursive patterns;UsingDeclarations|using declarations;DisposalPattern|pattern-based disposal;' +
      'StaticLocalFunctions|static local functions;NameShadowingInNestedFunctions|name shadowing in nested functions;' +
      'UnmanagedConstructedTypes|unmanaged constructed types;ObsoleteOnPropertyAccessor|obsolete on property accessor;ReadOnlyMembers|readonly ' +
      'members;-DefaultInterfaceImplementation|default interface implementation;-OverrideWithConstraints|constraints for override and explicit ' +
      'interface implementation methods;NestedStackalloc|stackalloc in nested expressions;NullableReferenceTypes|nullable reference types;' +
      'NullPointerConstantPattern|null pointer constant pattern;SwitchExpression|switch expression;AsyncUsing|asynchronous using;' +
      '-PropertyPatterns|property patterns;-PositionalPatterns|positional patterns;-NullForgivingOperator|null-forgiving operator;' +
      '-NullableDirective|#nullable directive'
  ],
  [
    9,
    '-TopLevelStatements|top-level statements;InitOnlySetters|init-only setters;Records|records;ImplicitObjectCreation|target-typed object ' +
      'creation;TargetTypedConditional|target-typed conditional expression;CovariantReturnsForOverrides|covariant returns;' +
      'StaticAnonymousFunction|static anonymous function;ExternLocalFunctions|extern local functions;ModuleInitializers|module initializers;' +
      'FunctionPointers|function pointers;NativeInt|native-sized integers;LocalFunctionAttributes|local function attributes;' +
      'LambdaDiscardParameters|lambda discard parameters;ExtensionGetEnumerator|extension GetEnumerator;ExtensionGetAsyncEnumerator|extension ' +
      'GetAsyncEnumerator;-PragmaWarningEnable|pragma warning enable;AndPattern|and pattern;OrPattern|or pattern;NotPattern|not pattern;' +
      'TypePattern|type pattern;ParenthesizedPattern|parenthesized pattern;RelationalPattern|relational pattern;' +
      'DefaultTypeParameterConstraint|default type parameter constraints;ExtendedPartialMethods|extended partial methods;' +
      'MemberNotNull|MemberNotNull attribute;VarianceSafetyForStaticInterfaceMembers|variance safety for static interface members;' +
      '-WithExpressions|with expressions;-UnmanagedCallingConventions|unmanaged calling conventions'
  ],
  [
    10,
    'MixedDeclarationsAndExpressionsInDeconstruction|mixed declarations and expressions in deconstruction;SealedToStringInRecord|sealed ToString ' +
      'in record;RecordStructs|record structs;WithOnStructs|with on structs;WithOnAnonymousTypes|with on anonymous types;' +
      'PositionalFieldsInRecords|positional fields in records;GlobalUsing|global using directive;InferredDelegateType|inferred delegate type;' +
      'LambdaAttributes|lambda attributes;LambdaReturnType|lambda return type;-AsyncMethodBuilderOverride|async method builder override;' +
      'ImplicitImplementationOfNonPublicMembers|implicit implementation of non-public members;-LineSpanDirective|line span directive;' +
      'ImprovedInterpolatedStrings|interpolated string handlers;FileScopedNamespace|file-scoped namespace;' +
      'ParameterlessStructConstructors|parameterless struct constructors;StructFieldInitializers|struct field initializers;' +
      'ExtendedPropertyPatterns|extended property patterns;ConstantInterpolatedStrings|constant interpolated strings;' +
      '-CallerArgumentExpression|CallerArgumentExpression attribute'
  ],
  [
    11,
    'RawStringLiterals|raw string literals;StaticAbstractMembersInInterfaces|static abstract members in interfaces;' +
      'NewLinesInInterpolations|newlines in interpolations;ListPattern|list pattern;RequiredMembers|required members;GenericAttributes|generic ' +
      'attributes;CheckedUserDefinedOperators|checked user-defined operators;AutoDefaultStructs|auto default struct fields;' +
      'CacheStaticMethodGroupConversion|cache static method group conversion;UnsignedRightShift|unsigned right shift;-ExtendedNameofScope|extended ' +
      'nameof scope;RelaxedShiftOperator|relaxed shift operator;Utf8StringLiterals|UTF-8 string literals;SpanCharConstantPattern|pattern matching ' +
      'ReadOnly/Span<char> on constant string;FileTypes|file types;-NumericIntPtr|numeric IntPtr;RefFields|ref fields;-ScopedRef|scoped ref ' +
      'parameters and locals;-SlicePattern|slice pattern'
  ],
  [
    12,
    'PrimaryConstructors|primary constructors;UsingTypeAlias|using type alias;InstanceMemberInNameof|instance member in nameof;' +
      'CollectionExpressions|collection expressions;RefReadonlyParameters|ref readonly parameters;LambdaOptionalParameters|lambda optional ' +
      'parameters;LambdaParamsArray|lambda params array;InlineArrays|inline arrays;-ExperimentalAttribute|Experimental attribute;' +
      '-SpreadElement|collection spread elements'
  ],
  [
    13,
    'ParamsCollections|params collections;StringEscapeCharacter|string escape character;ImplicitIndexerInitializer|implicit indexer initializer;' +
      'RefUnsafeInIteratorAsync|ref and unsafe in async and iterator methods;RefStructInterfaces|ref struct interfaces;' +
      'AllowsRefStructConstraint|allows ref struct constraint;LockObject|Lock object;OverloadResolutionPriority|overload resolution priority;' +
      'PartialProperties|partial properties'
  ],
  [
    14,
    'FieldKeyword|field keyword;FirstClassSpan|first-class Span types;UnboundGenericTypesInNameof|unbound generic types in nameof operator;' +
      'SimpleLambdaParameterModifiers|simple lambda parameter modifiers;PartialEventsAndConstructors|partial events and constructors;' +
      'Extensions|extensions;ExpressionOptionalAndNamedArguments|expression trees with optional and named arguments;' +
      'NullConditionalAssignment|null-conditional assignment;UserDefinedCompoundAssignmentOperators|user-defined compound assignment operators;' +
      '-IgnoredDirectives|ignored directives'
  ],
  [
    15,
    '-CollectionExpressionArguments|collection expression arguments;-LabeledBreakContinue|labeled break and continue;-ExtensionIndexers|extension ' +
      'indexers;-Unions|unions;-ClosedClasses|closed classes;-ClosedEnums|closed enums;-SafeModifier|safe modifier;-UnsafeExpressions|unsafe ' +
      'expressions'
  ]
];
function build() {
  const rows = [];
  for (const [version, list] of table)
    for (const entry of list.split(';')) {
      const [rawId, name] = entry.split('|'),
        id = rawId.replace(/^-/, ''),
        preview = version === 15,
        index = order.indexOf(version);
      rows.push(
        Object.freeze({
          id,
          name,
          version,
          preview,
          messageId: rawId.startsWith('-') ? null : 'IDS_Feature' + id,
          code: preview ? 'CS8652' : index > 0 ? selectedVersionCodes[order[index - 1]] : null
        })
      );
    }
  return Object.freeze(rows);
}
/** Every catalog row: { id, name, version, preview, messageId, code }. */
export const languageFeatures = build();
const byId = new Map(languageFeatures.map(row => [row.id, row]));
/** Looks up a catalog row by feature id; undefined for unknown ids. */
export function languageFeature(id) {
  return byId.get(id);
}
/** The language version one step below `version` in release order (7.3 for 8, 7 for 7.1), or null for C# 1. */
export function previousLanguageVersion(version) {
  const index = order.indexOf(version);
  return index > 0 ? order[index - 1] : null;
}
