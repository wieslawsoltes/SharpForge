using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace GenericInstantiationOracle;

internal sealed record ImageScope(string Image, string Context);

internal sealed class TypeObservations
{
    private readonly ConditionalWeakTable<Assembly, ImageScope> scopes = new();

    public void Register(Assembly assembly, string image, string context = "default") =>
        scopes.Add(assembly, new ImageScope(image, context));

    private ImageScope Scope(Assembly assembly) => scopes.TryGetValue(assembly, out var scope)
        ? scope : throw new InvalidOperationException("Unregistered non-BCL observation assembly: " + assembly.FullName);

    private static bool IsBcl(Type type) => type.Assembly == typeof(object).Assembly;

    public object Shape(Type type, int depth = 0)
    {
        if (depth > 32) throw new InvalidOperationException("Native type descriptor depth exceeded");
        if (type.IsFunctionPointer)
            return new { kind = "functionPointer", returnType = Shape(type.GetFunctionPointerReturnType(), depth + 1),
                parameters = type.GetFunctionPointerParameterTypes().Select(item => Shape(item, depth + 1)).ToArray(),
                unmanaged = type.IsUnmanagedFunctionPointer,
                callingConventions = type.GetFunctionPointerCallingConventions().Select(item => item.FullName).ToArray() };
        if (type.HasElementType)
            return new { kind = type.IsByRef ? "byref" : type.IsPointer ? "pointer" : type.IsSZArray ? "szarray" : "array",
                element = Shape(type.GetElementType()!, depth + 1), rank = type.IsArray ? type.GetArrayRank() : (int?)null };
        if (type.IsGenericParameter)
        {
            var scope = Scope(type.Assembly);
            return new { kind = "parameter", image = scope.Image, context = scope.Context,
                ownerToken = type.DeclaringMethod?.MetadataToken ?? type.DeclaringType!.MetadataToken,
                scope = type.DeclaringMethod is null ? "type" : "method", index = type.GenericParameterPosition };
        }
        if (type.IsConstructedGenericType)
            return new { kind = "generic", definition = Shape(type.GetGenericTypeDefinition(), depth + 1),
                arguments = type.GetGenericArguments().Select(item => Shape(item, depth + 1)).ToArray() };
        if (IsBcl(type)) return new { kind = "intrinsic", name = type.FullName };
        var owner = Scope(type.Assembly);
        return new { kind = "definition", image = owner.Image, context = owner.Context, token = type.MetadataToken };
    }

    public object Describe(Type type)
    {
        var signatureType = type.HasElementType || type.IsFunctionPointer || type.IsGenericParameter;
        var owner = signatureType || IsBcl(type) ? null : Scope(type.Assembly);
        return new
        {
            shape = Shape(type),
            containsGenericParameters = type.ContainsGenericParameters,
            isGenericType = type.IsGenericType,
            isGenericTypeDefinition = type.IsGenericTypeDefinition,
            isInterface = type.IsInterface,
            isValueType = type.IsValueType,
            genericDefinition = type.IsGenericType ? Shape(type.GetGenericTypeDefinition()) : null,
            genericArguments = type.IsGenericType ? type.GetGenericArguments().Select(item => Shape(item)).ToArray() : Array.Empty<object>(),
            declaringType = type.IsFunctionPointer || type.DeclaringType is null ? null : Shape(type.DeclaringType),
            baseType = type.IsFunctionPointer || type.BaseType is null ? null : Shape(type.BaseType),
            interfaces = type.IsFunctionPointer ? Array.Empty<object>()
                : type.GetInterfaces().Select(item => Shape(item)).OrderBy(Key, StringComparer.Ordinal).ToArray(),
            isCollectible = type.IsCollectible,
            genericParameterAttributes = type.IsGenericTypeDefinition
                ? type.GetGenericArguments().Select(item => (int)item.GenericParameterAttributes).ToArray() : Array.Empty<int>(),
            metadataToken = signatureType ? (int?)null : type.MetadataToken,
            module = owner?.Image,
            context = owner?.Context,
            nativeName = type.IsFunctionPointer ? null : type.Name,
            nativeFullName = type.IsFunctionPointer ? null : type.FullName,
            nativeAssembly = signatureType ? null : type.Assembly.FullName
        };
    }

    private static string Key(object value) => JsonSerializer.Serialize(value);
}

internal sealed record NativeError(string managedType, int hresult);
internal sealed record NativeCase(string id, object request, object? result, NativeError? error, string comparison);
internal sealed record IdentityObservation(string left, string right, string status,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] bool? same, string[] unavailable);
internal sealed record NativeScope(Type[]? TypeArguments = null, Type[]? MethodArguments = null, string Comparison = "parity");

internal sealed class CaseObservations(TypeObservations types)
{
    public List<NativeCase> Cases { get; } = [];
    public List<IdentityObservation> Identities { get; } = [];
    private readonly Dictionary<string, Type> values = new(StringComparer.Ordinal);

    public void Add(string id, object request, Func<Type> operation, string comparison = "parity")
    {
        var value = operation();
        values.Add(id, value);
        Cases.Add(new NativeCase(id, request, types.Describe(value), null, comparison));
    }

    public void Reject(string id, object request, Func<Type> operation, string comparison = "rejection")
    {
        try
        {
            operation();
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or TypeLoadException
            or BadImageFormatException or NotSupportedException)
        {
            Cases.Add(new NativeCase(id, request, null, new NativeError(error.GetType().FullName!, error.HResult), comparison));
            return;
        }
        throw new InvalidOperationException("Native negative case unexpectedly succeeded: " + id);
    }

    public void Compatibility(string id, object request, Func<Type> operation)
    {
        Type value;
        try
        {
            value = operation();
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or TypeLoadException
            or BadImageFormatException or NotSupportedException)
        {
            Cases.Add(new NativeCase(id, request, null, new NativeError(error.GetType().FullName!, error.HResult), "native-compatibility"));
            return;
        }
        values.Add(id, value);
        Cases.Add(new NativeCase(id, request, types.Describe(value), null, "native-compatibility"));
    }

    public void Same(string left, string right)
    {
        if (!Cases.Any(item => item.id == left) || !Cases.Any(item => item.id == right))
            throw new InvalidOperationException("An identity endpoint is absent from the observation matrix.");
        var missing = new[] { left, right }.Where(id => !values.ContainsKey(id)).ToArray();
        Identities.Add(new IdentityObservation(left, right, missing.Length == 0 ? "observed" : "unavailable",
            missing.Length == 0 ? ReferenceEquals(values[left], values[right]) : null, missing));
    }

    public void Instantiate(string id, Type definition, Type[] arguments, string comparison = "parity") =>
        Add(id, new { op = "instantiate", definition = types.Shape(definition),
            arguments = arguments.Select(item => types.Shape(item)).ToArray() },
            () => definition.MakeGenericType(arguments), comparison);

    public void Resolve(string id, Assembly assembly, string image, int token, NativeScope? scope = null)
    {
        Add(id, new { op = "resolve", image, token,
            typeArguments = scope?.TypeArguments?.Select(item => types.Shape(item)).ToArray(),
            methodArguments = scope?.MethodArguments?.Select(item => types.Shape(item)).ToArray() },
            () => assembly.ManifestModule.ResolveType(token, scope?.TypeArguments, scope?.MethodArguments), scope?.Comparison ?? "parity");
    }
}
