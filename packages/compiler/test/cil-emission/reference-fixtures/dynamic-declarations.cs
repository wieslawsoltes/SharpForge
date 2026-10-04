using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;

// `dynamic` in declarations: it is `object` in every signature, values are stored and passed as objects, and the
// `[Dynamic]` attribute with its transform flags says which objects are dynamic. Reflection reads the flags back.

class Holder
{
    public dynamic Value;
    public dynamic[] Items = { 1, "two", null };
    public Dictionary<string, dynamic> Map = new Dictionary<string, dynamic>();
    public List<dynamic[]> Nested;
    public object Plain;
    public dynamic Other { get; set; }
    public Holder(dynamic value) { Value = value; }
    public dynamic Get() { return Value; }
    public List<dynamic> All(dynamic first, ref dynamic second, int count, params dynamic[] rest) { return new List<dynamic> { first, second, count, rest.Length }; }
    public static object Unwrap(dynamic value) { return value; }
}

static class Program
{
    static dynamic Pick(bool first, dynamic a, dynamic b) { return first ? a : b; }

    static string Flags(ICustomAttributeProvider provider)
    {
        var attribute = (DynamicAttribute)provider.GetCustomAttributes(typeof(DynamicAttribute), false).FirstOrDefault();
        return attribute == null ? "-" : string.Join("", attribute.TransformFlags.Select(flag => flag ? "1" : "0"));
    }

    static void Values()
    {
        dynamic text = "text";
        object asObject = text;
        var holder = new Holder(42);
        object value = holder.Get();
        holder.Other = 1.5;
        holder.Map["key"] = 'c';
        object second = holder.Items[1];
        dynamic copy = text;
        text = null;
        Console.WriteLine(asObject + " " + value + " " + (object)holder.Other + " " + (object)holder.Map["key"] + " " + second + " " + holder.Items.Length);
        Console.WriteLine((object)Pick(false, "a", 2) + " " + Holder.Unwrap(true) + " " + ((object)copy ?? "none") + " " + ((object)text ?? "none"));
        // An argument typed `dynamic` would make the call late bound; an `object` variable fits a `ref dynamic` slot.
        object reference = 7;
        var all = holder.All("f", ref reference, 3, 1, 2);
        Console.WriteLine(all.Count + " " + (object)all[1] + " " + (object)all[3]);
    }

    static void Declarations()
    {
        var type = typeof(Holder);
        foreach (var name in new[] { "Value", "Items", "Map", "Nested", "Plain" }) Console.WriteLine(name + " " + type.GetField(name).FieldType.Name + " " + Flags(type.GetField(name)));
        Console.WriteLine("Other " + Flags(type.GetProperty("Other")) + " " + Flags(type.GetMethod("Get").ReturnParameter));
        var all = type.GetMethod("All");
        Console.WriteLine("All " + Flags(all.ReturnParameter) + " " + string.Join(" ", all.GetParameters().Select(parameter => parameter.ParameterType.Name + ":" + Flags(parameter))));
        Console.WriteLine("ctor " + Flags(type.GetConstructors()[0].GetParameters()[0]) + " Unwrap " + Flags(type.GetMethod("Unwrap").ReturnParameter));
    }

    static void Main()
    {
        Values();
        Declarations();
    }
}
