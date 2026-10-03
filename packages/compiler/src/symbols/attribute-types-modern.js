/**
 * Attribute classes of the base class library that C# 9 to 13 features are written with (SF-A02-E09, E10, E11),
 * in the row shape of ./attribute-types.js: [namespace, name, valid targets, allow multiple, constructors, named
 * arguments]. They are declared with the C# 1 and 2 classes of that module; the binder modules that interpret them
 * (binder/csharp9.js and its siblings) find them by full name.
 */

/** @param {object} T the AttributeTargets values */
export function modernAttributes(T) {
  const compilerServices = 'System.Runtime.CompilerServices',
    codeAnalysis = 'System.Diagnostics.CodeAnalysis',
    types = T.Class | T.Struct | T.Enum | T.Interface | T.Delegate,
    members = T.Constructor | T.Method | T.Property | T.Field | T.Event,
    storage = T.Field | T.Parameter | T.Property,
    results = storage | T.ReturnValue,
    memberNames = [1, 2, 3, 4].map(count => Array.from({ length: count }, (_, index) => [index ? 'member' + (index + 1) : 'member', 's'])),
    skipLocalsInit = T.Module | T.Class | T.Struct | T.Interface | T.Constructor | T.Method | T.Property | T.Event;
  return [
    // C# 8: the nullable analysis attributes (interpreted by nullable/attributes.js)
    [codeAnalysis, 'AllowNullAttribute', storage, false, [[]], []],
    [codeAnalysis, 'DisallowNullAttribute', storage, false, [[]], []],
    [codeAnalysis, 'MaybeNullAttribute', results, false, [[]], []],
    [codeAnalysis, 'NotNullAttribute', results, false, [[]], []],
    [codeAnalysis, 'MaybeNullWhenAttribute', T.Parameter, false, [[['returnValue', 'b']]], []],
    [codeAnalysis, 'NotNullWhenAttribute', T.Parameter, false, [[['returnValue', 'b']]], []],
    [codeAnalysis, 'NotNullIfNotNullAttribute', T.Parameter | T.Property | T.ReturnValue, true, [[['parameterName', 's']]], []],
    [codeAnalysis, 'DoesNotReturnAttribute', T.Method, false, [[]], []],
    [codeAnalysis, 'DoesNotReturnIfAttribute', T.Parameter, false, [[['parameterValue', 'b']]], []],
    // C# 9
    ['System.Runtime.InteropServices', 'UnmanagedCallersOnlyAttribute', T.Method, false, [[]], [['EntryPoint', 's', 'field']]],
    [compilerServices, 'ModuleInitializerAttribute', T.Method, false, [[]], []],
    [compilerServices, 'SkipLocalsInitAttribute', skipLocalsInit, false, [[]], []],
    // The table has no `params` constructors: `params string[] members` is declared as the overloads with one to four names.
    [codeAnalysis, 'MemberNotNullAttribute', T.Method | T.Property, true, memberNames, []],
    [codeAnalysis, 'MemberNotNullWhenAttribute', T.Method | T.Property, true, memberNames.map(names => [['returnValue', 'b'], ...names]), []],
    // C# 10
    [compilerServices, 'AsyncMethodBuilderAttribute', types | T.Method, false, [[['builderType', 't']]], []],
    [compilerServices, 'InterpolatedStringHandlerAttribute', T.Class | T.Struct, false, [[]], []],
    // `params string[]` is not declared: one to three argument names.
    [compilerServices, 'InterpolatedStringHandlerArgumentAttribute', T.Parameter, false,
      [[['argument', 's']], [['first', 's'], ['second', 's']], [['first', 's'], ['second', 's'], ['third', 's']]], []],
    // C# 11
    [codeAnalysis, 'SetsRequiredMembersAttribute', T.Constructor, false, [[]], []],
    [codeAnalysis, 'UnscopedRefAttribute', T.Method | T.Property | T.Parameter, false, [[]], []],
    // C# 12
    [compilerServices, 'InlineArrayAttribute', T.Struct, false, [[['length', 'i']]], []],
    [compilerServices, 'CollectionBuilderAttribute', T.Class | T.Struct | T.Interface, false, [[['builderType', 't'], ['methodName', 's']]], []],
    [codeAnalysis, 'ExperimentalAttribute', T.Assembly | T.Module | types | members, false, [[['diagnosticId', 's']]], [['UrlFormat', 's']]],
    // C# 13
    [compilerServices, 'OverloadResolutionPriorityAttribute', T.Method | T.Constructor | T.Property, false, [[['priority', 'i']]], []],
  ];
}
