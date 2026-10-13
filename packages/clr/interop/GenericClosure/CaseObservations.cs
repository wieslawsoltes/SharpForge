using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace GenericClosureOracle;

internal sealed class ClosureError
{
    public required string managedType { get; init; }
    public int hresult { get; init; }
    public required string message { get; init; }
    public string? paramName { get; init; }
    public string? fileName { get; init; }
    public string? stackTrace { get; init; }
    public ClosureError? inner { get; init; }

    public static ClosureError From(Exception error, int depth = 0)
    {
        if (depth > 16) throw new InvalidOperationException("Native inner exception chain exceeds the observation bound");
        var fileName = error switch
        {
            FileLoadException load => load.FileName,
            FileNotFoundException missing => missing.FileName,
            BadImageFormatException image => image.FileName,
            _ => null
        };
        return new ClosureError
        {
            managedType = error.GetType().FullName!, hresult = error.HResult, message = error.Message,
            paramName = (error as ArgumentException)?.ParamName, fileName = fileName, stackTrace = error.StackTrace,
            inner = error.InnerException is null ? null : From(error.InnerException, depth + 1)
        };
    }
}

internal sealed class OperationObservation(string operationId, object boundRequest)
{
    public string id { get; } = operationId;
    public object request { get; } = boundRequest;
    public string stage { get; set; } = "prepared";
    public bool nativeReturned { get; set; }
    public bool descriptionCompleted { get; set; }
    public object? result { get; set; }
    public ClosureError? error { get; set; }
}

internal sealed record IdentityEndpoint(object request, bool available, object? shape, string? unavailableBecause);

internal sealed class CaseObservations : IDisposable
{
    private readonly string id;
    private readonly FileStream journal;
    private readonly StreamWriter writer;
    private readonly NativeTypes types;
    private readonly Dictionary<string, Type> values = new(StringComparer.Ordinal);
    private readonly List<OperationObservation> operations = new();
    private OperationObservation? current;

    public CaseObservations(string id, string directory, IReadOnlyDictionary<string, ClosureImage> images, string journalPath)
    {
        this.id = id;
        journal = new FileStream(journalPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
        writer = new StreamWriter(journal);
        types = new NativeTypes(directory, images, Stage);
    }

    private void Event(string name, object observation)
    {
        writer.WriteLine(JsonSerializer.Serialize(new { caseId = id, @event = name, observation }));
        writer.Flush();
        journal.Flush(flushToDisk: true);
    }

    private void Stage(string stage)
    {
        current!.stage = stage;
        Event("native-operation-start", current);
    }

    private void Operation(string name, BoundRequest bound)
    {
        current = new OperationObservation(name, bound.request);
        operations.Add(current);
        Event("request-bound", current);
        Type value;
        try { value = bound.execute(types); }
        catch (NativeFailure failure)
        {
            current.stage = failure.Stage;
            current.error = ClosureError.From(failure.Native);
            Event("native-operation-exception", current);
            return;
        }
        current.nativeReturned = true;
        current.stage = "nativeReturned";
        Event("native-operation-returned", current);
        // Observation failures remain harness failures after the native result has been retained.
        types.RegisterImages();
        current.result = types.Observations.Describe(value);
        current.descriptionCompleted = true;
        current.stage = "complete";
        values.Add(name, value);
        Event("description-completed", current);
    }

    private (Type? value, IdentityEndpoint observation) Endpoint(JsonElement request)
    {
        var operation = request.GetProperty("operation").GetString()!;
        var source = operations.Single(item => item.id == operation);
        if (!values.TryGetValue(operation, out var value))
        {
            if (source.error is null) throw new InvalidOperationException("Identity endpoint lacks a completed native observation");
            return (null, new IdentityEndpoint(request.Clone(), false, null, "native-operation-exception"));
        }
        var selection = request.GetProperty("selection").GetString();
        if (selection == "genericArgument")
        {
            var index = request.GetProperty("index").GetInt32();
            var arguments = value.GetGenericArguments();
            if (index < 0 || index >= arguments.Length) throw new InvalidOperationException("Authored identity formal index is unavailable");
            value = arguments[index];
        }
        else if (selection != "type") throw new InvalidOperationException("Unknown authored identity selection");
        return (value, new IdentityEndpoint(request.Clone(), true, types.Observations.Shape(value), null));
    }

    private object Identity(JsonElement request)
    {
        Event("identity-start", request);
        var left = Endpoint(request.GetProperty("left"));
        var right = Endpoint(request.GetProperty("right"));
        bool? sameReference = left.value is null || right.value is null ? null : ReferenceEquals(left.value, right.value);
        var result = new { id = request.GetProperty("id").GetString(), left = left.observation, right = right.observation, sameReference };
        Event("identity-completed", result);
        return result;
    }

    public object Run(JsonElement item, RequestBindings bindings)
    {
        // Bind every request before executing a CLR call; malformed source cannot masquerade as native rejection.
        var bound = bindings.Operations(item);
        foreach (var operation in bound) Operation(operation.Key, operation.Value);
        var primaryRepeat = JsonSerializer.SerializeToElement(new { id = "primary-repeat",
            left = new { operation = "primary", selection = "type" }, right = new { operation = "repeat", selection = "type" } });
        var identities = new List<object> { Identity(primaryRepeat) };
        if (item.TryGetProperty("identities", out var authored)) identities.AddRange(authored.EnumerateArray().Select(Identity));
        var result = new { id, group = item.GetProperty("group").GetString(), comparison = item.GetProperty("comparison").GetString(),
            operations, identities };
        Event("case-completed", result);
        return result;
    }

    public void Dispose()
    {
        writer.Dispose();
        journal.Dispose();
    }
}
