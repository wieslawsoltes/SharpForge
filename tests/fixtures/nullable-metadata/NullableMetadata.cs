#nullable enable
using System;
using System.Collections.Generic;

namespace NullableMetadata;

public interface IContract<T> { }
public class Base<T> { }

public unsafe abstract class Surface<TNotNull, TClass, TMaybe, TAny, TValue, TConstraint>
    : Base<Dictionary<string, string?>>, IContract<(string? Name, string[]? Values)>
    where TNotNull : notnull
    where TClass : class
    where TMaybe : class?
    where TValue : struct
    where TConstraint : IContract<string?>
{
    public Dictionary<string, string?[]?>? Field;
    public int? Number;
    public (int Count, string? Name)? Pair;
    public TAny Value;
    public TValue ValueItem;
    public TClass ClassValue;
    public TClass? MaybeClassValue;
    public delegate*<string?, string> Pointer;
    public abstract string Name { get; set; }
    public abstract string? this[string key] { get; set; }
    public event Action<string?>? Changed;
    public abstract string? Read(string key, string? fallback, out string? value);
    public abstract U? Map<U, V>(U? value, V other) where U : class where V : IContract<U?>;
}

public abstract class Constraints<TClass, TNullable, TInterface, TAnother, TNew, TStruct>
    where TClass : Base<string?>
    where TNullable : Base<string?>?
    where TInterface : IContract<string?>
    where TAnother : TClass?
    where TNew : new()
    where TStruct : unmanaged
{
    public abstract TClass A(TClass value);
    public abstract TNullable B(TNullable value);
    public abstract TInterface C(TInterface value);
    public abstract TNew D(TNew value);
}

public class Outer<A>
{
    public class Middle<B>
    {
        public class Inner<C> { }
    }
}

public class NestedUses
{
    public Outer<string?>.Middle<string>.Inner<string?[]>? Nested;
    public List<(string? First, string Second)>[]? Tuples;
}

public record EnabledRecord(string Name, string? Optional);
public record struct ValueRecord(string Name, string? Optional);
public record GenericRecord<T>(T Value);

public abstract class OverrideBase
{
    public abstract T Echo<T>(T value) where T : IContract<string?>;
}
public class OverrideDerived : OverrideBase
{
    public override T Echo<T>(T value) => value;
}

public partial class Contexts
{
    public string Enabled = "";
    public string? Optional;
}

#nullable disable
public partial class Contexts
{
    public string Disabled;
    public string[] DisabledArray;
    public string DisabledMethod(string value) => value;
#nullable enable annotations
    public string AnnotatedMethod(string value) => value;
#nullable restore annotations
    public string RestoredMethod(string value) => value;
}

public class Disabled<T, TClass> where TClass : class
{
    public T Value;
    public TClass ClassValue;
}
public record DisabledRecord(string Name);
