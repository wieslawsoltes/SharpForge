using System;
using System.Reflection;

public enum Mode : short { Fast = 2 }
public struct Marker { }
public static class Samples
{
    public static void Choose(int number = 7, char letter = '\u0104', Mode mode = Mode.Fast,
        string text = "hello", object value = null, bool enabled = true, long large = 9223372036854775807L) { }
    public static void Nullable(int? count = 5, Marker marker = default, int? absent = null) { }
    public static void Price(decimal value = -1.25m, decimal largest = 79228162514264337593543950335m,
        decimal scaled = 1.2300m) { }
    public static void Required(object value) { }
    public static int Count(params ReadOnlySpan<int> values) => values.Length;
}

public static class Program
{
    private static void Dump(MethodInfo method)
    {
        foreach (ParameterInfo parameter in method.GetParameters())
        {
            object value = parameter.RawDefaultValue;
            Console.Write(parameter.Name + ":" + parameter.IsOptional + ":" + parameter.HasDefaultValue + ":");
            Console.WriteLine(value == null ? "null" : value.ToString());
            foreach (CustomAttributeData attribute in parameter.GetCustomAttributesData())
            {
                string name = attribute.AttributeType.FullName;
                if (name == "System.ParamArrayAttribute" ||
                    name == "System.Runtime.CompilerServices.ParamCollectionAttribute" ||
                    name == "System.Runtime.CompilerServices.DecimalConstantAttribute")
                    Console.WriteLine(name);
            }
        }
    }

    public static void Main()
    {
        Dump(typeof(Samples).GetMethod("Choose"));
        Dump(typeof(Samples).GetMethod("Nullable"));
        Dump(typeof(Samples).GetMethod("Price"));
        Dump(typeof(Samples).GetMethod("Required"));
        Dump(typeof(Samples).GetMethod("Count"));
        var optional = (int value = 13) => value;
        var repeated = (params int[] values) => values.Length;
        Dump(optional.GetType().GetMethod("Invoke"));
        Dump(repeated.GetType().GetMethod("Invoke"));
        Console.WriteLine(optional() + repeated(1, 2));
    }
}
