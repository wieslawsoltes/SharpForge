using System;

// Constructed attribute classes (C# 11): the constructor is named on the construction, and fixed and named
// arguments are encoded as the types the construction gives them. Reflection reads them back.

class TagAttribute<T> : Attribute
{
    public TagAttribute() { }
    public TagAttribute(T value) { Value = value; }
    public T Value { get; set; }
}

[Tag<int>(7)]
class Tagged
{
    [Tag<string>(Value = "named")] public void Method() { }
    [Pair<int, string>, Derived<bool>(Value = true)] public int Field = 1;
}

class Pair<TFirst, TSecond> : Attribute { }
class Derived<T> : TagAttribute<T> { }

static class Program
{
    static void Main()
    {
        var onType = (TagAttribute<int>)typeof(Tagged).GetCustomAttributes(false)[0];
        var onMethod = (TagAttribute<string>)typeof(Tagged).GetMethod("Method").GetCustomAttributes(false)[0];
        Console.WriteLine(onType.Value + " " + onMethod.Value + " " + onType.GetType());
        var field = typeof(Tagged).GetField("Field");
        var derived = (Derived<bool>)field.GetCustomAttributes(typeof(Derived<bool>), false)[0];
        Console.WriteLine(field.GetCustomAttributes(typeof(Pair<int, string>), false).Length + " " + derived.Value + " " + new Tagged().Field);
    }
}
