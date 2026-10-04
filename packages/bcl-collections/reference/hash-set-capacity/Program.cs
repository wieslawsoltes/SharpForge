using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;

if (Environment.Version != new Version(10, 0, 5) || !OperatingSystem.IsLinux() ||
    RuntimeInformation.ProcessArchitecture != Architecture.X64)
{
    throw new InvalidOperationException("Capture requires .NET 10.0.5 on Linux x64.");
}

var result = new
{
    runtime = new
    {
        framework = RuntimeInformation.FrameworkDescription,
        version = Environment.Version.ToString(),
        os = RuntimeInformation.OSDescription,
        architecture = RuntimeInformation.ProcessArchitecture.ToString()
    },
    metadata = CaptureMetadata(),
    rows = ConstructorRows().Concat(CapacityRows()).Concat(OrderRows()).Concat(UnionRows()).Concat(BoundaryRows()).ToArray(),
    typedObservations = new object[]
    {
        ObserveTyped(new[] { 1, 2, 3, 1 }),
        ObserveTyped(new[] { 0.0, -0.0, 1.5, 2.5, 1.5 }),
        ObserveTyped(new[] { true, false, true, false }),
        ObserveTyped(new string?[] { null, "a", "b", null, "a" }),
        ObserveTyped(new object?[] { 1, 1.0, true, "1", null, 1, 1.0 })
    }
};
var options = new JsonSerializerOptions { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
Console.WriteLine(JsonSerializer.Serialize(result, options));

static IEnumerable<RowObservation> ConstructorRows()
{
    yield return ObserveRow("fresh-empty", Empty(),
        Call(Operation.EnsureCapacity, -1), Call(Operation.TrimExcess),
        Call(Operation.TrimExcessCapacity, 0), Call(Operation.TrimExcessCapacity, 12), Call(Operation.TrimExcessCapacity, -1));
    foreach (int capacity in new[] { 0, 1, 2, 3, 4, 7, 8, 11, 12, 17, 18, 23, 24, 29, 30, 37 })
    {
        yield return ObserveRow($"constructor-capacity-{capacity}", Capacity(capacity));
    }
    yield return ObserveRow("array-empty", Items());
    yield return ObserveRow("array-unique-eight", Items(1, 2, 3, 4, 5, 6, 7, 8));
    yield return ObserveRow("array-three-repeated-singleton", Items(1, 1, 1));
    yield return ObserveRow("array-four-repeated-singleton", Items(1, 1, 1, 1));
    yield return ObserveRow("array-seven-two-distinct", Items(1, 2, 1, 2, 1, 2, 1));
    yield return ObserveRow("array-eight-two-distinct", Items(1, 2, 1, 2, 1, 2, 1, 2));
    yield return ObserveRow("array-eleven-three-distinct", Items(1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2));
    yield return ObserveRow("array-twelve-four-distinct", Items(1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4));
    yield return ObserveRow("array-twelve-five-distinct", Items(1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2));
}

static IEnumerable<RowObservation> CapacityRows()
{
    yield return ObserveRow("capacity-zero-initialization", Capacity(0),
        Call(Operation.TrimExcessCapacity, 0), Call(Operation.EnsureCapacity, 1), Call(Operation.EnsureCapacity, 0),
        Call(Operation.TrimExcess), Call(Operation.TrimExcessCapacity, 0));
    yield return ObserveRow("allocated-empty-prime-floor", Capacity(7),
        Call(Operation.TrimExcessCapacity, 0), Call(Operation.EnsureCapacity, 4),
        Call(Operation.TrimExcess), Call(Operation.TrimExcess), Call(Operation.TrimExcessCapacity, 0));
    yield return ObserveRow("add-growth", Empty(),
        Call(Operation.Add, 1), Call(Operation.Add, 2), Call(Operation.Add, 3), Call(Operation.Add, 3),
        Call(Operation.Add, 4), Call(Operation.Add, 5), Call(Operation.Add, 6), Call(Operation.Add, 7),
        Call(Operation.Add, 8), Call(Operation.EnsureCapacity, 17), Call(Operation.EnsureCapacity, 18),
        Call(Operation.EnsureCapacity, 23), Call(Operation.TrimExcess), Call(Operation.TrimExcessCapacity, 8),
        Call(Operation.EnsureCapacity, 12), Call(Operation.TrimExcessCapacity, 12), Call(Operation.TrimExcessCapacity, 100));
    yield return ObserveRow("capacity-errors-preserve-state", Items(10, 20, 30),
        Call(Operation.EnsureCapacity, -1), Call(Operation.TrimExcessCapacity, -1), Call(Operation.TrimExcessCapacity, 0),
        Call(Operation.TrimExcessCapacity, 2), Call(Operation.TrimExcessCapacity, 3), Call(Operation.TrimExcessCapacity, 4),
        Call(Operation.EnsureCapacity, 18), Call(Operation.TrimExcessCapacity, 2), Call(Operation.TrimExcessCapacity, 3));
}

static IEnumerable<RowObservation> OrderRows()
{
    yield return ObserveRow("ensure-preserves-holes", Items(10, 20, 30, 40, 50, 60, 70),
        Call(Operation.Remove, 20), Call(Operation.Remove, 60), Call(Operation.EnsureCapacity, 7),
        Call(Operation.EnsureCapacity, 8), Call(Operation.Add, 80), Call(Operation.Add, 90),
        Call(Operation.Remove, 40), Call(Operation.EnsureCapacity, 24), Call(Operation.Add, 100), Call(Operation.TrimExcess));
    yield return ObserveRow("rounded-trim-preserves-holes", Items(10, 20, 30, 40, 50, 60, 70),
        Call(Operation.Remove, 20), Call(Operation.Remove, 40), Call(Operation.Remove, 60),
        Call(Operation.TrimExcessCapacity, 4), Call(Operation.Add, 80), Call(Operation.Add, 90), Call(Operation.TrimExcess));
    yield return ObserveRow("trim-compacts-survivors", Capacity(29),
        Call(Operation.Add, 10), Call(Operation.Add, 20), Call(Operation.Add, 30),
        Call(Operation.Add, 40), Call(Operation.Add, 50), Call(Operation.Add, 60),
        Call(Operation.Remove, 20), Call(Operation.Remove, 40), Call(Operation.TrimExcessCapacity, 4),
        Call(Operation.Add, 70), Call(Operation.Remove, 30), Call(Operation.TrimExcess), Call(Operation.Add, 80));
    yield return ObserveRow("empty-after-removes-and-clear", Items(1, 2, 3, 4, 5, 6, 7, 8),
        Call(Operation.Remove, 1), Call(Operation.Remove, 2), Call(Operation.Remove, 3), Call(Operation.Remove, 4),
        Call(Operation.Remove, 5), Call(Operation.Remove, 6), Call(Operation.Remove, 7), Call(Operation.Remove, 8),
        Call(Operation.TrimExcessCapacity, 0), Call(Operation.Add, 99), Call(Operation.EnsureCapacity, 12),
        Call(Operation.Clear), Call(Operation.TrimExcess), Call(Operation.Add, 100));
}

static IEnumerable<RowObservation> UnionRows()
{
    yield return ObserveRow("union-empty-input", Empty(), Call(Operation.UnionWith, Array.Empty<int>()));
    yield return ObserveRow("union-empty-distinct-eight", Empty(), Call(Operation.UnionWith, new[] { 1, 2, 3, 4, 5, 6, 7, 8 }));
    yield return ObserveRow("union-empty-duplicates", Empty(), Call(Operation.UnionWith, new[] { 1, 2, 1, 2, 1, 2, 1, 2 }));
    yield return ObserveRow("union-reuses-holes-and-grows", Items(10, 20, 30, 40, 50, 60, 70),
        Call(Operation.Remove, 20), Call(Operation.Remove, 60), Call(Operation.UnionWith, Array.Empty<int>()),
        Call(Operation.UnionWith, new[] { 80, 90, 80, 10 }),
        Call(Operation.Remove, 40), Call(Operation.UnionWith, new[] { 100, 110, 120, 130, 140 }), Call(Operation.TrimExcess));
    yield return ObserveRow("union-crosses-multiple-growth-boundaries", Empty(),
        Call(Operation.UnionWith, Enumerable.Range(0, 90).ToArray()), Call(Operation.UnionWith, new[] { 0, 44, 89 }),
        Call(Operation.UnionWith, Array.Empty<int>()), Call(Operation.TrimExcess));
}

static IEnumerable<RowObservation> BoundaryRows()
{
    yield return ObserveRow("native-prime-boundary-968897", Capacity(968897));
    yield return ObserveRow("native-prime-boundary-968898", Empty(),
        Call(Operation.EnsureCapacity, 968898), Call(Operation.TrimExcessCapacity, 0));
}

static RowObservation ObserveRow(string name, ConstructorSpec constructor, params StepInput[] inputs)
{
    HashSet<int> values = constructor.Kind switch
    {
        ConstructorKind.Empty => new HashSet<int>(),
        ConstructorKind.Capacity => new HashSet<int>(constructor.Capacity!.Value),
        ConstructorKind.Array => new HashSet<int>((IEnumerable<int>)constructor.Items!),
        _ => throw new InvalidOperationException("Unknown constructor kind.")
    };
    var steps = new List<StepObservation> { ObserveCapacity(values, Call(Operation.EnsureCapacity, 0), value => value) };
    foreach (StepInput input in inputs)
    {
        steps.Add(IsCapacity(input.Operation) ? ObserveCapacity(values, input, value => value) : ObserveMutation(values, input));
    }
    return new RowObservation(name, constructor, steps.ToArray());
}

static StepObservation ObserveMutation(HashSet<int> values, StepInput input)
{
    object? result = null;
    switch (input.Operation)
    {
        case Operation.Add:
            result = values.Add((int)input.Argument!);
            break;
        case Operation.Remove:
            result = values.Remove((int)input.Argument!);
            break;
        case Operation.Clear:
            values.Clear();
            break;
        case Operation.UnionWith:
            values.UnionWith((int[])input.Argument!);
            break;
        default:
            throw new InvalidOperationException("Unknown mutation operation.");
    }
    return new StepObservation(input.Operation.ToString(), input.Argument, result, null,
        values.Capacity, values.Count, values.Select(value => (object?)value).ToArray(), null);
}

static StepObservation ObserveCapacity<T>(HashSet<T> values, StepInput input, Func<T, object?> describe)
{
    // Public GetEnumerator returns the version-checking struct even when the set is empty.
    var iterator = values.GetEnumerator();
    object? result = null;
    string? fault = null;
    try
    {
        switch (input.Operation)
        {
            case Operation.EnsureCapacity:
                result = values.EnsureCapacity((int)input.Argument!);
                break;
            case Operation.TrimExcess:
                values.TrimExcess();
                break;
            case Operation.TrimExcessCapacity:
                values.TrimExcess((int)input.Argument!);
                break;
            default:
                throw new InvalidOperationException("Unknown capacity operation.");
        }
    }
    catch (ArgumentOutOfRangeException exception)
    {
        fault = exception.GetType().FullName;
    }
    IteratorObservation observation = ObserveIterator(ref iterator, describe);
    return new StepObservation(input.Operation.ToString(), input.Argument, result, fault,
        values.Capacity, values.Count, values.Select(describe).ToArray(), observation);
}

static IteratorObservation ObserveIterator<T>(ref HashSet<T>.Enumerator iterator, Func<T, object?> describe)
{
    try
    {
        bool moved = iterator.MoveNext();
        return new IteratorObservation(moved, moved ? describe(iterator.Current) : null, null);
    }
    catch (InvalidOperationException exception)
    {
        return new IteratorObservation(false, null, exception.GetType().FullName);
    }
    finally
    {
        iterator.Dispose();
    }
}

static object ObserveTyped<T>(T[] items)
{
    var values = new HashSet<T>((IEnumerable<T>)items);
    return new
    {
        elementType = TypeName(typeof(T)),
        constructor = new { kind = "array", items = items.Select(DescribeTypedValue).ToArray() },
        steps = new[]
        {
            ObserveCapacity(values, Call(Operation.EnsureCapacity, 0), DescribeTypedValue),
            ObserveCapacity(values, Call(Operation.EnsureCapacity, 18), DescribeTypedValue),
            ObserveCapacity(values, Call(Operation.TrimExcessCapacity, 8), DescribeTypedValue),
            ObserveCapacity(values, Call(Operation.TrimExcess), DescribeTypedValue),
            ObserveCapacity(values, Call(Operation.TrimExcess), DescribeTypedValue)
        }
    };
}

static object DescribeTypedValue<T>(T value) => new { type = value is null ? "null" : TypeName(value.GetType()), value };

static object[] CaptureMetadata()
{
    Type type = typeof(HashSet<int>);
    MethodInfo[] methods =
    {
        type.GetProperty(nameof(HashSet<int>.Capacity))!.GetMethod!,
        type.GetMethod(nameof(HashSet<int>.EnsureCapacity), new[] { typeof(int) })!,
        type.GetMethod(nameof(HashSet<int>.TrimExcess), Type.EmptyTypes)!,
        type.GetMethod(nameof(HashSet<int>.TrimExcess), new[] { typeof(int) })!
    };
    return methods.Select(method => (object)new
    {
        name = method.Name,
        returnType = TypeName(method.ReturnType),
        parameterTypes = method.GetParameters().Select(parameter => TypeName(parameter.ParameterType)).ToArray(),
        isStatic = method.IsStatic,
        declaringType = TypeName(method.DeclaringType!)
    }).ToArray();
}

static string TypeName(Type type)
{
    if (!type.IsGenericType)
    {
        return type.FullName ?? type.Name;
    }
    string name = type.GetGenericTypeDefinition().FullName!.Split('`')[0];
    return $"{name}<{string.Join(",", type.GetGenericArguments().Select(TypeName))}>";
}

static bool IsCapacity(Operation operation) =>
    operation is Operation.EnsureCapacity or Operation.TrimExcess or Operation.TrimExcessCapacity;

static ConstructorSpec Empty() => new(ConstructorKind.Empty);
static ConstructorSpec Capacity(int capacity) => new(ConstructorKind.Capacity, capacity);
static ConstructorSpec Items(params int[] items) => new(ConstructorKind.Array, Items: items);
static StepInput Call(Operation operation, object? argument = null) => new(operation, argument);

enum ConstructorKind { Empty, Capacity, Array }
enum Operation { Add, Remove, Clear, UnionWith, EnsureCapacity, TrimExcess, TrimExcessCapacity }

sealed record ConstructorSpec(
    ConstructorKind Kind,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Capacity = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int[]? Items = null);

sealed record StepInput(Operation Operation, object? Argument = null);
sealed record IteratorObservation(bool Moved, object? Current, string? Fault);
sealed record RowObservation(string Name, ConstructorSpec Constructor, StepObservation[] Steps);
sealed record StepObservation(
    string Operation,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] object? Argument,
    object? Result,
    string? Fault,
    int Capacity,
    int Count,
    object?[] Values,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IteratorObservation? Iterator);
