using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace GenericInstantiationOracle;

internal sealed class CaseMatrix(TypeObservations types, CaseObservations observations)
{
    private static readonly Type Integer = typeof(int);
    private static readonly Type Text = typeof(string);
    private static readonly Type Box = typeof(Fixture.Box<>);
    private static readonly Type Pair = typeof(Fixture.Pair<,>);
    private static readonly Type Other = typeof(Fixture.Other<>);
    private static readonly Type MethodOwner = typeof(Fixture.MethodOwner<>);

    public static Dictionary<string, int> DefinitionTokens() => new(StringComparer.Ordinal)
    {
        ["box"] = Box.MetadataToken, ["pair"] = Pair.MetadataToken, ["other"] = Other.MetadataToken,
        ["cell"] = typeof(Fixture.Cell<>).MetadataToken, ["variant"] = typeof(Fixture.IVariant<>).MetadataToken,
        ["derived"] = typeof(Fixture.Derived<>).MetadataToken, ["reorder"] = typeof(Fixture.Reorder<,>).MetadataToken,
        ["node"] = typeof(Fixture.Node<>).MetadataToken, ["outer"] = typeof(Fixture.Outer<>).MetadataToken,
        ["inner"] = typeof(Fixture.Outer<>.Inner<>).MetadataToken,
        ["inheritedInner"] = typeof(Fixture.Outer<>.NonGenericInner).MetadataToken,
        ["constrained"] = typeof(Fixture.Constrained<>).MetadataToken, ["methodOwner"] = MethodOwner.MetadataToken,
        ["contract"] = typeof(Fixture.IContract<>).MetadataToken,
        ["left"] = typeof(Fixture.ILeft<>).MetadataToken, ["right"] = typeof(Fixture.IRight<>).MetadataToken
    };

    public void Definitions()
    {
        foreach (var (id, token) in DefinitionTokens())
            observations.Resolve("definition-" + id, Box.Assembly, "fixture", token);
        observations.Instantiate("box-own-parameters", Box, Box.GetGenericArguments());
        observations.Same("definition-box", "box-own-parameters");
        observations.Instantiate("box-integer", Box, [Integer]);
        observations.Instantiate("box-integer-repeat", Box, [Integer]);
        observations.Add("box-integer-typeof", new { op = "instantiate", definition = types.Shape(Box),
            arguments = new[] { types.Shape(Integer) } }, () => typeof(Fixture.Box<int>));
        observations.Same("box-integer", "box-integer-repeat");
        observations.Same("box-integer", "box-integer-typeof");
        observations.Instantiate("pair-integer-string", Pair, [Integer, Text]);
        observations.Instantiate("pair-string-integer", Pair, [Text, Integer]);
        observations.Same("pair-integer-string", "pair-string-integer");
        observations.Instantiate("pair-partial", Pair, [Text, Other.GetGenericArguments()[0]]);
        observations.Instantiate("box-other-parameter", Box, Other.GetGenericArguments());
        observations.Instantiate("box-method-owner-parameter", Box, MethodOwner.GetGenericArguments());
        observations.Same("box-other-parameter", "box-method-owner-parameter");
        observations.Instantiate("cell-integer", typeof(Fixture.Cell<>), [Integer]);
        observations.Instantiate("variant-string", typeof(Fixture.IVariant<>), [Text]);
    }

    public void Graphs()
    {
        observations.Instantiate("derived-integer", typeof(Fixture.Derived<>), [Integer]);
        observations.Instantiate("reorder-integer-string", typeof(Fixture.Reorder<,>), [Integer, Text]);
        observations.Instantiate("node-integer", typeof(Fixture.Node<>), [Integer]);
        observations.Instantiate("node-node-integer", typeof(Fixture.Node<>), [typeof(Fixture.Node<int>)]);
        observations.Add("node-base-argument", new { op = "baseArgument", of = "node-integer", index = 0 },
            () => typeof(Fixture.Node<int>).BaseType!.GetGenericArguments()[0]);
        observations.Same("node-integer", "node-base-argument");
        observations.Add("node-contract-argument", new { op = "interfaceArgument", of = "node-integer",
            definition = types.Shape(typeof(Fixture.IContract<>)), index = 0 },
            () => typeof(Fixture.Node<int>).GetInterfaces().Single().GetGenericArguments()[0]);
        observations.Same("node-node-integer", "node-contract-argument");
        observations.Instantiate("nested-closed", typeof(Fixture.Outer<>.Inner<>), [Integer, Text]);
        observations.Instantiate("nested-partial", typeof(Fixture.Outer<>.Inner<>), [Integer, Other.GetGenericArguments()[0]]);
        observations.Instantiate("nested-inherited-arity", typeof(Fixture.Outer<>.NonGenericInner), [Integer]);
    }

    public void Elements()
    {
        Element("vector-closed", "szarray", typeof(Fixture.Box<int>), type => type.MakeArrayType());
        Element("vector-open", "szarray", Box, type => type.MakeArrayType());
        Element("rank-one-closed", "array", typeof(Fixture.Box<int>), type => type.MakeArrayType(1), 1);
        Element("matrix-closed", "array", typeof(Fixture.Box<int>), type => type.MakeArrayType(2), 2);
        Element("jagged-open", "szarray", Box.MakeArrayType(), type => type.MakeArrayType());
        Element("pointer-open", "pointer", Box, type => type.MakePointerType());
        Element("byref-open", "byref", Box, type => type.MakeByRefType());
        observations.Instantiate("box-open-vector", Box, [Other.MakeArrayType()]);
    }

    private void Element(string id, string kind, Type element, Func<Type, Type> operation, int? rank = null)
    {
        observations.Add(id, new { op = "element", kind, element = types.Shape(element), rank }, () => operation(element));
    }

    public void Consumers(NativeImage[] images, IReadOnlyDictionary<string, Assembly> assemblies)
    {
        foreach (var image in images.Where(item => item.id is "consumerA" or "consumerB"))
        {
            observations.Resolve(image.id + "-box-integer", assemblies[image.id], image.id, image.specifications["boxInteger"]);
            observations.Resolve(image.id + "-list-integer", assemblies[image.id], image.id, image.specifications["listInteger"],
                new NativeScope(Comparison: "identity-only-bcl"));
            observations.Same("box-integer", image.id + "-box-integer");
        }
        observations.Instantiate("list-integer", typeof(List<>), [Integer], "identity-only-bcl");
        observations.Same("consumerA-list-integer", "consumerB-list-integer");
        observations.Same("list-integer", "consumerA-list-integer");
    }

    public void Scopes(NativeImage image, Assembly assembly)
    {
        var specs = image.specifications;
        var typeParameter = Other.GetGenericArguments()[0];
        var methodParameter = MethodOwner.GetMethod("M")!.GetGenericArguments()[0];
        var closed = new NativeScope([Integer], [Text]);
        var swapped = new NativeScope([Text], [Integer]);
        var open = new NativeScope([typeParameter], [methodParameter]);
        observations.Resolve("scope-pair-closed", assembly, image.id, specs["scopePair"], closed);
        observations.Resolve("scope-pair-repeat", assembly, image.id, specs["scopePair"], closed);
        observations.Resolve("scope-pair-swapped", assembly, image.id, specs["scopePair"], swapped);
        observations.Resolve("scope-pair-open", assembly, image.id, specs["scopePair"], open);
        observations.Same("scope-pair-closed", "pair-integer-string");
        observations.Same("scope-pair-closed", "scope-pair-repeat");
        observations.Same("scope-pair-swapped", "pair-string-integer");
        foreach (var name in new[] { "scopeType", "scopeMethod", "scopeArray", "scopeMatrix", "scopeNested" })
        {
            observations.Resolve(name + "-closed", assembly, image.id, specs[name], closed);
            observations.Resolve(name + "-open", assembly, image.id, specs[name], open);
        }
        foreach (var name in new[] { "scopePointer", "scopeByRef", "managedFunction", "nativeFunction", "nestedFunction" })
            observations.Compatibility(name + "-resolved", new { op = "resolve", image = image.id, token = specs[name],
                typeArguments = new[] { types.Shape(Integer) }, methodArguments = new[] { types.Shape(Text) } },
                () => assembly.ManifestModule.ResolveType(specs[name], [Integer], [Text]));
        MissingScope("scope-no-environment", image, assembly, null, null);
        MissingScope("scope-no-method-environment", image, assembly, [Integer], null);
        MissingScope("scope-no-type-environment", image, assembly, null, [Text]);
        observations.Reject("scope-undersized", new { op = "resolve", image = image.id, token = specs["secondVariable"],
            typeArguments = new[] { types.Shape(Integer) } },
            () => assembly.ManifestModule.ResolveType(specs["secondVariable"], [Integer], null));
    }

    private void MissingScope(string id, NativeImage image, Assembly assembly, Type[]? typeArguments, Type[]? methodArguments)
    {
        var token = image.specifications["scopePair"];
        observations.Reject(id, new { op = "resolve", image = image.id, token,
            typeArguments = typeArguments?.Select(item => types.Shape(item)).ToArray(),
            methodArguments = methodArguments?.Select(item => types.Shape(item)).ToArray() },
            () => assembly.ManifestModule.ResolveType(token, typeArguments, methodArguments));
    }

    public void FunctionPointers()
    {
        var open = MethodOwner.GetMethod("Shapes")!;
        var closed = typeof(Fixture.MethodOwner<int>).GetMethod("Shapes")!.MakeGenericMethod(Text);
        ObserveParameter("function-open", open, 0);
        ObserveParameter("function-closed", closed, 0);
        ObserveParameter("function-cdecl", closed, 1);
        ObserveParameter("function-nested", MethodOwner.GetMethod("Nested")!, 0);
        var pointer = Integer.MakePointerType();
        var function = closed.GetParameters()[0].ParameterType;
        foreach (var (id, argument) in new[] { ("pointer", pointer), ("function", function) })
            observations.Compatibility("wrapped-" + id + "-argument",
                new { op = "instantiate", definition = types.Shape(Box),
                    arguments = new[] { new { kind = "szarray", element = types.Shape(argument), rank = 1 } } },
                () => Box.MakeGenericType(argument.MakeArrayType()));
    }

    private void ObserveParameter(string id, MethodInfo method, int index)
    {
        observations.Add(id, new { op = "methodParameterDescriptor", image = "fixture", token = method.MetadataToken,
            index, typeArguments = method.DeclaringType!.GetGenericArguments().Select(item => types.Shape(item)).ToArray(),
            methodArguments = method.IsGenericMethod
                ? method.GetGenericArguments().Select(item => types.Shape(item)).ToArray() : Array.Empty<object>() },
            () => method.GetParameters()[index].ParameterType, "signature-descriptor");
    }

    public void Rejections()
    {
        observations.Reject("null-arguments", new Dictionary<string, object?>
            { ["op"] = "instantiate", ["definition"] = types.Shape(Box), ["arguments"] = null },
            () => Box.MakeGenericType(null!));
        observations.Reject("null-argument-entry", new { op = "instantiate", definition = types.Shape(Box), arguments = new object?[] { null } },
            () => Box.MakeGenericType(new Type[] { null! }));
        foreach (var (id, definition, arguments) in new[]
        {
            ("non-generic-definition", Integer, new[] { Integer }),
            ("constructed-definition", typeof(Fixture.Box<int>), new[] { Integer }),
            ("missing-argument", Box, Type.EmptyTypes),
            ("excess-arguments", Box, new[] { Integer, Text }),
            ("nested-wrong-arity", typeof(Fixture.Outer<>.Inner<>), new[] { Integer })
        })
            observations.Reject(id, new { op = "instantiate", definition = types.Shape(definition),
                arguments = arguments.Select(item => types.Shape(item)).ToArray() }, () => definition.MakeGenericType(arguments));
        var function = typeof(Fixture.MethodOwner<int>).GetMethod("Shapes")!.MakeGenericMethod(Text).GetParameters()[0].ParameterType;
        foreach (var (id, argument) in new[] { ("void", typeof(void)), ("pointer", Integer.MakePointerType()),
            ("byref", Integer.MakeByRefType()), ("function", function) })
            observations.Reject("invalid-" + id + "-argument", new { op = "instantiate", definition = types.Shape(Box),
                arguments = new[] { types.Shape(argument) } }, () => Box.MakeGenericType(argument));
        observations.Instantiate("constraint-valid-native", typeof(Fixture.Constrained<>), [Text], "constraint-unsupported-2463");
        observations.Reject("constraint-invalid-native", new { op = "instantiate", definition = types.Shape(typeof(Fixture.Constrained<>)),
            arguments = new[] { types.Shape(Integer) } }, () => typeof(Fixture.Constrained<>).MakeGenericType(Integer),
            "constraint-unsupported-2463");
    }

    public void MetadataOnly(NativeImage[] images, IReadOnlyDictionary<string, Assembly> assemblies)
    {
        var nested = images.Single(image => image.id == "nested");
        var assembly = assemblies[nested.id];
        foreach (var (id, token) in nested.definitions)
            observations.Resolve("metadata-" + id, assembly, nested.id, token);
        var unmarked = assembly.ManifestModule.ResolveType(nested.definitions["unmarkedArity"]);
        observations.Instantiate("unmarked-arity-closed", unmarked, [Integer, Text]);
        observations.Reject("unmarked-wrong-arity", new { op = "instantiate", definition = types.Shape(unmarked),
            arguments = new[] { types.Shape(Integer) } }, () => unmarked.MakeGenericType(Integer));
        var malformed = images.Single(image => image.id == "malformed");
        foreach (var (id, token) in malformed.specifications)
            observations.Compatibility("malformed-" + id, new { op = "resolve", image = malformed.id, token },
                () => assemblies[malformed.id].ManifestModule.ResolveType(token));
        var circular = images.Single(image => image.id == "circular");
        observations.Reject("circular-inheritance", new { op = "resolve", image = circular.id, token = circular.definitions["left"] },
            () => assemblies[circular.id].ManifestModule.ResolveType(circular.definitions["left"]));
    }
}
