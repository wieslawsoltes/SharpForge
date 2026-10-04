using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection.Emit;
using System.Text.Json;

record ConversionCase(string id, string source, string input, string opcode, string target, int nativeIntBits);

static class Program
{
    static Type SourceType(string source) => source switch {
        "i4" => typeof(int), "i8" => typeof(long), "r4" => typeof(float),
        "r8" => typeof(double), "native" => typeof(nint), _ => throw new ArgumentException(source)
    };

    static Type TargetType(string target) => target switch {
        "sbyte" => typeof(sbyte), "byte" => typeof(byte), "short" => typeof(short), "ushort" => typeof(ushort),
        "int" => typeof(int), "uint" => typeof(uint), "long" => typeof(long), "ulong" => typeof(ulong),
        "float" => typeof(float), "double" => typeof(double), "nint" => typeof(nint), "nuint" => typeof(nuint),
        _ => throw new ArgumentException(target)
    };

    static object Input(ConversionCase item)
    {
        var culture = CultureInfo.InvariantCulture;
        // Each arm must box its declared source type before the switch computes a
        // common numeric type; reflection does not narrow a boxed Double to Int32.
        return item.source switch {
            "i4" => (object)int.Parse(item.input, culture), "i8" => (object)long.Parse(item.input, culture),
            "r4" => (object)float.Parse(item.input, culture), "r8" => (object)double.Parse(item.input, culture),
            "native" => (object)checked((nint)long.Parse(item.input, culture)), _ => throw new ArgumentException(item.source)
        };
    }

    static string Execute(ConversionCase item)
    {
        Type source = SourceType(item.source), target = TargetType(item.target);
        var method = new DynamicMethod("Convert", target, new[] {source}, typeof(Program).Module);
        var generator = method.GetILGenerator();
        var field = typeof(OpCodes).GetField(item.opcode.Replace('.', '_'),
            System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.IgnoreCase);
        if (field == null) throw new ArgumentException(item.opcode);
        generator.Emit(OpCodes.Ldarg_0);
        generator.Emit((OpCode)field.GetValue(null)!);
        generator.Emit(OpCodes.Ret);
        try {
            object value = method.Invoke(null, new[] {Input(item)})!;
            // Preserve observable bits, except NaN payloads are outside the VM contract.
            if (value is float single) return float.IsNaN(single) ? "NaN" : BitConverter.SingleToInt32Bits(single).ToString();
            if (value is double real) return double.IsNaN(real) ? "NaN" : BitConverter.DoubleToInt64Bits(real).ToString();
            return Convert.ToString(value, CultureInfo.InvariantCulture)!;
        } catch (System.Reflection.TargetInvocationException error) {
            return "!" + error.InnerException!.GetType().Name;
        }
    }

    static void Main(string[] arguments)
    {
        var cases = JsonSerializer.Deserialize<List<ConversionCase>>(File.ReadAllText(arguments[0]))!;
        foreach (var item in cases) Console.WriteLine(Execute(item));
    }
}
