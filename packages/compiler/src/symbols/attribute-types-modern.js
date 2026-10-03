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
    skipLocalsInit = T.Module | T.Class | T.Struct | T.Interface | T.Constructor | T.Method | T.Property | T.Event;
  return [
    // C# 9
    [compilerServices, 'ModuleInitializerAttribute', T.Method, false, [[]], []],
    [compilerServices, 'SkipLocalsInitAttribute', skipLocalsInit, false, [[]], []],
    // C# 10
    [compilerServices, 'CallerArgumentExpressionAttribute', T.Parameter, false, [[['parameterName', 's']]], []],
    [compilerServices, 'AsyncMethodBuilderAttribute', types | T.Method, false, [[['builderType', 't']]], []],
    [compilerServices, 'InterpolatedStringHandlerAttribute', T.Class | T.Struct, false, [[]], []],
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
