using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace GenericClosureOracle;

internal sealed record DefinitionReference(string image, string context, int token);
internal sealed record BoundArgument(object shape, Func<NativeTypes, Type> resolve);
internal sealed record BoundRequest(object request, Func<NativeTypes, Type> execute);

internal sealed class RequestBindings(IReadOnlyDictionary<string, ClosureImage> images)
{
    private static string Context(JsonElement source)
    {
        var context = source.TryGetProperty("context", out var value) ? value.GetString()! : "default";
        if (context != "default") throw new InvalidOperationException("The closure matrix defines one context per isolated process");
        return context;
    }

    private DefinitionReference Definition(JsonElement source, string alias = "definition")
    {
        var image = source.GetProperty("image").GetString()!;
        var token = images[image].definitions[source.GetProperty(alias).GetString()!];
        return new DefinitionReference(image, Context(source), token);
    }

    private static object Shape(DefinitionReference reference) =>
        new { kind = "definition", reference.image, reference.context, reference.token };

    private BoundArgument Argument(JsonElement source, int depth = 0)
    {
        if (depth > 32) throw new InvalidOperationException("Authored request argument exceeds 32 levels");
        var kind = source.GetProperty("kind").GetString();
        if (kind == "intrinsic")
        {
            var name = source.GetProperty("name").GetString()!;
            var type = name switch
            {
                "System.Int32" => typeof(int),
                "System.String" => typeof(string),
                "System.Object" => typeof(object),
                _ => throw new InvalidOperationException("Unknown authored intrinsic: " + name)
            };
            return new BoundArgument(new { kind, name }, _ => type);
        }
        if (kind == "parameter")
        {
            var owner = Definition(source, "owner");
            var scope = source.GetProperty("scope").GetString()!;
            var index = source.GetProperty("index").GetInt32();
            if (scope != "type" || index < 0) throw new InvalidOperationException("Invalid authored closure formal reference");
            var shape = new { kind, owner.image, owner.context, ownerToken = owner.token, scope, index };
            return new BoundArgument(shape, types => types.Parameter(owner, index));
        }
        if (kind == "definition")
        {
            var reference = Definition(source);
            return new BoundArgument(Shape(reference), types => types.Resolve(reference, "resolveArguments"));
        }
        if (kind == "szarray")
        {
            var element = Argument(source.GetProperty("element"), depth + 1);
            return new BoundArgument(new { kind, element = element.shape }, types => types.Array(element));
        }
        if (kind == "generic")
        {
            var definition = Definition(source.GetProperty("definition"));
            var arguments = source.GetProperty("arguments").EnumerateArray().Select(item => Argument(item, depth + 1)).ToArray();
            var shape = new { kind, definition = Shape(definition), arguments = arguments.Select(item => item.shape).ToArray() };
            return new BoundArgument(shape, types => types.Instantiate(definition, arguments, "resolveArguments"));
        }
        throw new InvalidOperationException("Unknown authored request argument kind: " + kind);
    }

    public BoundRequest Bind(JsonElement source)
    {
        var operation = source.GetProperty("op").GetString()!;
        var image = source.GetProperty("image").GetString()!;
        var context = Context(source);
        if (operation == "resolve")
        {
            var token = source.TryGetProperty("specification", out var specification)
                ? images[image].specifications[specification.GetString()!]
                : images[image].definitions[source.GetProperty("definition").GetString()!];
            var reference = new DefinitionReference(image, context, token);
            return new BoundRequest(new { op = operation, image, context, token }, types => types.Resolve(reference, "resolveType"));
        }
        if (operation == "instantiate")
        {
            var definition = Definition(source);
            var arguments = source.GetProperty("arguments").EnumerateArray().Select(item => Argument(item)).ToArray();
            var request = new { op = operation, image, context, token = definition.token,
                definition = Shape(definition), arguments = arguments.Select(item => item.shape).ToArray() };
            return new BoundRequest(request, types => types.Instantiate(definition, arguments, "makeGenericType"));
        }
        throw new InvalidOperationException("Unknown authored native operation: " + operation);
    }

    public KeyValuePair<string, BoundRequest>[] Operations(JsonElement item)
    {
        var primary = Bind(item.GetProperty("request"));
        var result = new List<KeyValuePair<string, BoundRequest>> { new("primary", primary), new("repeat", primary) };
        if (item.TryGetProperty("companions", out var companions))
            result.AddRange(companions.EnumerateArray().Select(source =>
                new KeyValuePair<string, BoundRequest>(source.GetProperty("id").GetString()!, Bind(source))));
        if (result.Select(pair => pair.Key).Distinct(StringComparer.Ordinal).Count() != result.Count)
            throw new InvalidOperationException("Duplicate authored operation IDs");
        return result.ToArray();
    }
}
